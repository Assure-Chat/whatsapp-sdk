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

## Decisions taken

| Decision                               | Value                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| Repository                             | `Assure-Chat/whatsapp-sdk`, **public**, matching the sibling `Assure-Chat/infobip-sdk` |
| License                                | MIT, `Copyright (c) 2026 Assure, Inc.`                                                 |
| First version                          | **0.1.0**, published from the current manifests                                        |
| Publish method                         | **Manual**, from a maintainer's terminal                                               |
| Graph API version in docs and examples | `v24.0`                                                                                |

The staged changeset in `.changeset/initial-release.md` is the changelog entry for 0.1.0.
Do **not** run `npm run version-packages` before this first publish — it would bump all
three to 0.2.0. Run it for the _next_ release.

## Publishing 0.1.0 manually

Publishing is irreversible: the names and the semver line are permanent from that moment,
and an unpublish is only possible within 72 hours and only under npm's policy.

### 1. Build and verify from a clean tree

```bash
cd /Users/jtjessup/WhatsApp-API
npm ci --ignore-scripts
npm run build
npm test
npm run typecheck
npm run format:check
npm run pack:check
deno run --allow-read scripts/deno-smoke.ts
```

`pack:check` is the one that matters most here — it fails if a tarball would ship a
`.env`, sources, fixtures, coverage, key material, or an `.npmrc`.

### 2. Authenticate

```bash
npm login
npm whoami   # expect: jtjessup
```

Confirm the `@assure-ai` scope is visible to this account:

```bash
npm access list packages @assure-ai 2>/dev/null || npm view @assure-ai/infobip-types maintainers
```

### 3. Publish, types first

The other two declare an exact dependency on `@assure-ai/whatsapp-types@0.1.0`, so it has
to exist on the registry before they do.

```bash
npm publish -w @assure-ai/whatsapp-types    --access public
npm publish -w @assure-ai/whatsapp-webhooks --access public
npm publish -w @assure-ai/whatsapp-api      --access public
```

With 2FA enabled, append `--otp=<code>` to each. Add `--dry-run` first to any command you
want to see the effect of without publishing.

### 4. Confirm

```bash
npm view @assure-ai/whatsapp-types version
npm view @assure-ai/whatsapp-api version
npm view @assure-ai/whatsapp-webhooks version

# In a scratch directory, prove a real consumer install works:
mkdir -p /tmp/wa-consumer && cd /tmp/wa-consumer && npm init -y >/dev/null
npm install @assure-ai/whatsapp-api
node --input-type=module -e "import {createWhatsAppClient} from '@assure-ai/whatsapp-api'; console.log(typeof createWhatsAppClient)"
```

### 5. Tag the release

```bash
cd /Users/jtjessup/WhatsApp-API
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

## Switching to trusted publishing later

`.github/workflows/release.yml` is written and **gated off** — it runs only when the
repository variable `NPM_PUBLISH_ENABLED` is `true`. It uses npm trusted publishing via
OIDC with provenance and **no long-lived token**. To move to it for a later release:

- [ ] On npmjs.com, configure a trusted publisher for each of the three package names,
      pointing at `Assure-Chat/whatsapp-sdk` and `release.yml`.
- [ ] Set the repository variable `NPM_PUBLISH_ENABLED=true`.
- [ ] Do **not** add an `NPM_TOKEN` secret. If trusted publishing cannot be used, that is a
      decision to make explicitly, not to work around by adding a token.

The sibling `assure-infobip-sdk` repo uses an `NPM_TOKEN` secret. This repo deliberately
does not follow that part of its convention; converting the sibling to OIDC is the better
direction if the two should match.

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
