# Release readiness

**Nothing in this repository has been published.** No npm package, no dist-tag, no git tag,
no GitHub release. No Meta setting was changed, no webhook was configured, no phone number
was registered, no OAuth code was exchanged, and no message was sent.

This document is the remaining human checklist.

## Current state

| Package                        | Version | On npm today        |
| ------------------------------ | ------- | ------------------- |
| `@assure-ai/whatsapp-types`    | 0.1.0   | Not published (404) |
| `@assure-ai/whatsapp-api`      | 0.1.0   | Not published (404) |
| `@assure-ai/whatsapp-webhooks` | 0.1.0   | Not published (404) |

All three names were checked against the public registry and are unclaimed. The
`@assure-ai` scope is owned by this account — `@assure-ai/infobip-types@0.1.0` is published
under it with `jtjessup <jon@1440.io>` as maintainer — so there is no ownership conflict.

Because these are new names, `0.1.0` is a first publish rather than a version reset. There
is no existing version history to preserve. **Once published, the names and the semver
line are permanent**: a later change must be compatible or a major.

A changeset for the initial release is staged in `.changeset/initial-release.md`. Running
`npm run version-packages` would move all three to `0.2.0` in lockstep (they are `fixed`
in the changesets config). Decide before releasing whether the first public version should
be `0.1.0` or `0.2.0`; if `0.1.0`, publish from the current manifests and treat the
changeset as the changelog entry.

## Before a human releases

### 1. Review

- [ ] Read the full diff with an eye for secrets. The automated checks are in CI, but the
      guarantee worth having is that a person looked.
- [ ] Confirm the license decision. Currently **MIT**, matching the sibling
      `assure-infobip-sdk` repo, with `Copyright (c) 2026 Assure, Inc.` If Assure wants
      these private instead, set `"private": true` and `"license": "UNLICENSED"` on each
      package before doing anything else.
- [ ] Confirm the repository URL. The manifests point at
      `github.com/assure-chat/whatsapp-sdk`, which follows the sibling repo's convention
      but **does not exist yet**. Create it, or change the URLs.
- [ ] Confirm the Graph API version the docs and examples pin (`v24.0`) is the one Assure
      intends to run.

### 2. Put it in version control

This working tree is **not a git repository**. Before anything else:

```bash
cd /Users/jtjessup/WhatsApp-API
git init
git add .
git commit -m "Initial Assure WhatsApp SDK"
```

`.gitignore` already excludes `node_modules/`, `dist/`, coverage, and every `.env` form.

### 3. Verify locally

```bash
npm ci --ignore-scripts
npm run build
npm test
npm run typecheck
npm run format:check
npm run pack:check
deno run --allow-read scripts/deno-smoke.ts
```

### 4. Set up publishing

The release workflow is written but **gated off**: it runs only when the repository
variable `NPM_PUBLISH_ENABLED` is set to `true`.

It uses npm **trusted publishing via OIDC** with provenance (`id-token: write`,
`NPM_CONFIG_PROVENANCE: true`) and **no long-lived automation token**. To enable:

- [ ] On npmjs.com, configure a trusted publisher for each of the three package names,
      pointing at `assure-chat/whatsapp-sdk` and the `release.yml` workflow.
- [ ] Set the repository variable `NPM_PUBLISH_ENABLED=true`.
- [ ] Do **not** add an `NPM_TOKEN` secret. If trusted publishing cannot be used, that is
      a decision to make explicitly, not to work around by adding a token.

The sibling `assure-infobip-sdk` repo currently uses an `NPM_TOKEN` secret. This repo
deliberately does not follow that part of its convention; if the two should match,
converting the sibling to OIDC is the better direction.

### 5. First publish

```bash
npm run changeset        # if the staged one needs adjusting
npm run version-packages # updates versions and CHANGELOGs
# review the diff, commit, push
```

Merging the resulting "Version Packages" PR publishes. Then:

- [ ] Confirm all three appear on npm with provenance attestations.
- [ ] Confirm the tarball contents match what `npm run pack:check` reported.

### 6. First consumption from Assure

- [ ] Install into Assure's platform and run its own test suite against the real types.
- [ ] Point a **sandbox** WABA's webhook at a staging endpoint and confirm signature
      verification passes on real Meta traffic. This is the single most valuable
      end-to-end check, and it cannot be done offline — the fixtures prove the algorithm,
      not the byte-for-byte behaviour of your ingress.
- [ ] Send one template to a test number and confirm the `sent`/`delivered` webhooks
      arrive with the `callbackData` you attached.
- [ ] Confirm no destination, token, or message body appears in staging logs.

## Deliberately not done

These need separate, explicit approval after review, and none was performed:

- Publishing any package, creating a dist-tag, a git tag, or a GitHub release.
- Any Meta setting change: app configuration, webhook callback URL, verify token,
  subscription, phone-number registration, or template submission.
- Exchanging a real OAuth authorization code.
- Sending a message to any real recipient.
- Any remote MCP mutation.

## Credential findings

No access token, app secret, verify token, authorization code, PIN, real phone number, or
other credential was found in this repository, and none was written into source, fixtures,
documentation, examples, test output, or package metadata. Fixtures use reserved-style
placeholder numbers and literal non-secret strings such as
`test_app_secret_not_a_real_value`.

One observation outside this repository, recorded without values:

- **`/Users/jtjessup/assure-infobip-sdk/.env.local`** — a local environment file in the
  sibling repository. It is correctly covered by that repo's `.gitignore` (`.env.*` with a
  `!.env.example` exception) and its contents were not read. Category: provider
  credentials for Infobip. Worth confirming it was never committed in that repo's history
  and rotating on the normal schedule.

Separately, and independent of this repository: **any access token that was previously
pasted into a chat must be treated as exposed and rotated outside this task.** It must not
be reused for these packages.
