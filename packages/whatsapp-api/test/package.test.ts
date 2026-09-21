import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Packaging and runtime-compatibility checks.
 *
 * These exercise the built `dist/`, not `src/`. A package can typecheck and
 * pass every unit test and still be unusable once published — a missing export
 * map entry, a stray Node-only import, an `.d.ts` that does not resolve. That
 * is what these catch.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const packages = ['whatsapp-types', 'whatsapp-api', 'whatsapp-webhooks'] as const;

function manifestOf(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
}

describe('package manifests', () => {
  it.each(packages)('%s declares deliberate exports and types', (name) => {
    const manifest = manifestOf(name);
    expect(manifest['type']).toBe('module');
    expect(manifest['sideEffects']).toBe(false);
    expect(manifest['types']).toBe('./dist/index.d.ts');

    const exports = manifest['exports'] as Record<string, Record<string, string>>;
    expect(exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
      require: './dist/index.cjs',
    });
    // Consumers legitimately read this; leaving it out breaks tooling.
    expect(exports['./package.json']).toBe('./package.json');
  });

  it.each(packages)('%s targets Node 20+', (name) => {
    expect((manifestOf(name)['engines'] as Record<string, string>)['node']).toBe('>=20.10');
  });

  it.each(packages)('%s has no install-time script', (name) => {
    const scripts = manifestOf(name)['scripts'] as Record<string, string>;
    for (const hook of ['postinstall', 'preinstall', 'install', 'prepublish']) {
      expect(scripts[hook]).toBeUndefined();
    }
  });

  it.each(packages)('%s pins its workspace dependency exactly', (name) => {
    const dependencies = (manifestOf(name)['dependencies'] ?? {}) as Record<string, string>;
    for (const [dependency, range] of Object.entries(dependencies)) {
      expect(dependency.startsWith('@assure-ai/')).toBe(true);
      // An exact pin, not a range: these three ship as one unit.
      expect(range).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('depends on nothing outside the @assure-ai scope at runtime', () => {
    for (const name of packages) {
      const dependencies = Object.keys((manifestOf(name)['dependencies'] ?? {}) as object);
      const external = dependencies.filter((entry) => !entry.startsWith('@assure-ai/'));
      expect(external).toEqual([]);
    }
  });

  it('keeps all three versions in lockstep', () => {
    const versions = packages.map((name) => manifestOf(name)['version']);
    expect(new Set(versions).size).toBe(1);
  });
});

describe('built output', () => {
  it.each(packages)('%s ESM entry imports and exposes its API', async (name) => {
    const entry = join(root, 'packages', name, 'dist', 'index.js');
    const module_ = (await import(entry)) as Record<string, unknown>;
    expect(Object.keys(module_).length).toBeGreaterThan(0);
    expect(module_['default']).toBeUndefined();
  });

  it.each(packages)('%s CJS entry loads under require', (name) => {
    const require_ = createRequire(import.meta.url);
    const entry = join(root, 'packages', name, 'dist', 'index.cjs');
    const module_ = require_(entry) as Record<string, unknown>;
    expect(Object.keys(module_).length).toBeGreaterThan(0);
  });

  it('exposes the documented entry points of each package', async () => {
    const api = (await import(join(root, 'packages/whatsapp-api/dist/index.js'))) as Record<
      string,
      unknown
    >;
    expect(typeof api['createWhatsAppClient']).toBe('function');
    expect(typeof api['createLocaleMap']).toBe('function');
    expect(typeof api['WhatsAppAmbiguousOutcomeError']).toBe('function');

    const webhooks = (await import(
      join(root, 'packages/whatsapp-webhooks/dist/index.js')
    )) as Record<string, unknown>;
    expect(typeof webhooks['verifyWebhookSignature']).toBe('function');
    expect(typeof webhooks['verifySubscriptionChallenge']).toBe('function');
    expect(typeof webhooks['receiveWebhook']).toBe('function');

    const types = (await import(join(root, 'packages/whatsapp-types/dist/index.js'))) as Record<
      string,
      unknown
    >;
    expect(typeof types['asGraphApiVersion']).toBe('function');
  });

  it('ships no Node-only import in the runtime bundles', () => {
    // These packages must run on Deno and Supabase Edge, where `node:` and the
    // CommonJS builtins are not reliably available.
    for (const name of packages) {
      const source = readFileSync(join(root, 'packages', name, 'dist', 'index.js'), 'utf8');
      expect(source).not.toMatch(/from ['"]node:/);
      expect(source).not.toMatch(/require\(['"](crypto|fs|path|http|https|buffer)['"]\)/);
      expect(source).not.toMatch(/\bprocess\.env\b/);
    }
  });

  it('performs no network call or environment read at import time', async () => {
    // A module that phoned home on import would already have done so by the
    // time any test ran; this asserts the absence in the emitted source.
    for (const name of packages) {
      const source = readFileSync(join(root, 'packages', name, 'dist', 'index.js'), 'utf8');
      expect(source).not.toMatch(/^\s*(await\s+)?fetch\(/m);
      expect(source).not.toMatch(/\beval\(/);
      expect(source).not.toMatch(/new Function\(/);
    }
  });

  it('emits declaration files consumers can resolve', () => {
    for (const name of packages) {
      const declaration = readFileSync(join(root, 'packages', name, 'dist', 'index.d.ts'), 'utf8');
      expect(declaration).toMatch(/export\s+(declare|type|\{)/);
    }
  });
});

describe('published surface', () => {
  it('ships only intended files in every tarball', () => {
    // Runs the same inspection CI does. Fails the suite on a stray file
    // rather than leaving it to a reviewer to notice.
    const output = execFileSync('node', ['scripts/check-tarballs.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(output).toContain('All tarballs contain only intended files.');
  });
});
