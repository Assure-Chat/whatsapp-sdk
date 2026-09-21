#!/usr/bin/env node
/**
 * Inspect what each package would publish, without publishing anything.
 *
 * Runs `npm pack --dry-run --json` per workspace and fails when a tarball
 * contains a file it should not. The deny list is the point: a `.env` or a
 * fixture that slipped into `files` would otherwise be discovered by whoever
 * downloads the package.
 *
 * This makes no network request and produces no tarball on disk.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES_DIR = 'packages';

/** Patterns that must never appear in a published tarball. */
const FORBIDDEN = [
  { pattern: /(^|\/)\.env($|\.)/, why: 'environment file' },
  { pattern: /(^|\/)test\//, why: 'test source' },
  { pattern: /(^|\/)fixtures?\//, why: 'fixtures' },
  { pattern: /\.test\.(ts|js|cts|mts)$/, why: 'test file' },
  { pattern: /(^|\/)coverage\//, why: 'coverage artifact' },
  { pattern: /(^|\/)src\//, why: 'unbuilt source' },
  { pattern: /\.tsbuildinfo$/, why: 'build metadata' },
  { pattern: /(^|\/)node_modules\//, why: 'vendored dependency' },
  { pattern: /\.(pem|key|p12|pfx)$/, why: 'key material' },
  { pattern: /(^|\/)\.npmrc$/, why: 'npm credentials file' },
];

/** Files every package must ship. */
const REQUIRED = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'];

let failed = false;

const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(PACKAGES_DIR, entry.name));

for (const directory of packages) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const [report] = JSON.parse(output);
  const files = report.files.map((file) => file.path);

  console.log(
    `\n${manifest.name}@${manifest.version} — ${files.length} files, ${report.size} bytes packed`,
  );

  for (const file of files) {
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(file)) {
        console.error(`  ✗ ships ${why}: ${file}`);
        failed = true;
      }
    }
  }

  for (const required of REQUIRED) {
    if (!files.includes(required)) {
      console.error(`  ✗ missing required file: ${required}`);
      failed = true;
    }
  }

  if (manifest.scripts?.postinstall !== undefined) {
    console.error('  ✗ declares a postinstall script');
    failed = true;
  }

  if (!failed) console.log('  ✓ contents look right');
}

if (failed) {
  console.error('\nTarball inspection failed.');
  process.exit(1);
}
console.log('\nAll tarballs contain only intended files.');
