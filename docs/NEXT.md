# NEXT — v0.1.0 published to npm; public-install verified; STOPPED at the authorized scope

Status: **v0.1.0 release candidate ready and npm publication explicitly approved by the user on 2026-08-23 at ~20:40 UTC+8.** The authorized Step-2 publication was executed and verified on 2026-08-23 (~20:53–20:57 UTC+8); see "Step 2 execution record" below. Feature development remains stopped.

The release candidate passed 38/38 deterministic scenarios, fresh-clone verification, clean `npm pack`, real tarball installation through `dsh plugin --profile <profile> add`, byte-identity checks, and packaged-mount composition smoke checks. The public README calibrates the final live evidence against the recorded protocol deviation.

## Gate status

Pre-publish identity/name checks are now satisfied:

- `npm whoami --registry=https://registry.npmjs.org/ --cache ./.local-run/.npm-cache` returned **`quaner1234`**.
- The public npm registry check for `dsh-subagent-watchdog` returned **404 / unregistered** before approval.
- Latest affected-package checks remained green: `npm pack --dry-run` shipped exactly `LICENSE`, `README.md`, `cordis.patch.yml`, `lib/index.js`, `package.json`; `npm test` remained **38/38**.
- Continue using the workspace-local npm cache; do not change global npm cache ownership for this release.

## Authorized action — Step 2 only

The user has explicitly approved publishing **`dsh-subagent-watchdog@0.1.0` to npm**.

Execute only this publication step:

1. Pull latest `origin/main` and confirm the intended release commit/files are unchanged except for this publication-gate documentation.
2. Recheck package-name availability immediately before publish. If the name is no longer available, **STOP** and report.
3. Confirm `npm whoami` still returns `quaner1234` using the workspace-local cache. If authentication fails, **STOP** and report.
4. Publish `dsh-subagent-watchdog@0.1.0` to the public npm registry using the reviewed package contents. Do not change product code or metadata merely to make publish succeed.
5. Immediately verify the public registry exposes version `0.1.0` and the expected package metadata.
6. In a fresh isolated DSH profile, install from the public npm registry using:

```sh
dsh plugin --profile <scratch> add dsh-subagent-watchdog
```

7. Verify bundle reconciliation/mount succeeds from the public package. A packaging/install smoke check is sufficient; do **not** repeat the max-tokens live acceptance burn.
8. Record the publication/version/public-install evidence in this file (or a small release record), commit and push.
9. **STOP and report.** Do not apply GitHub description/topics, create a tag/release, or submit to an awesome list in this step.

## Hard stop conditions

- npm auth failure => STOP.
- package name/version conflict => STOP.
- publish failure => STOP; report the exact npm error, do not improvise around it.
- public registry verification failure => STOP.
- public DSH install/mount failure => STOP before any GitHub release/discovery work.
- No more product behavior changes in v0.1.0 unless a reproducible release-blocking defect is found and separately approved.

## Later steps — not yet authorized

After npm publication and public-install verification pass, wait for a new explicit approval before:

1. applying GitHub description/topics;
2. tagging the exact published commit as `v0.1.0` and creating a GitHub Release;
3. submitting to `awesome-dsh-plugin` after its repository-age gate is satisfied (repo created `2026-08-23T02:38:54Z`, so >=1 day at `2026-08-24T02:38:54Z`, i.e. 10:38:54 UTC+8; commit-count gate is already satisfied).

## Step 2 execution record (2026-08-23, ~20:43–20:57 UTC+8)

All nine authorized items executed; every hard-stop condition avoided. Evidence:

### Pre-publish gates

- Pulled `origin/main`: `9ef3945` → `feacda5` (fast-forward, `docs/NEXT.md` only; release files untouched). Published from exactly `feacda5594a276cbdd9fb2ba8262eaf1585865fb` (registry `gitHead` confirms).
- `npm whoami` (public registry, workspace-local cache `.local-run/.npm-cache`) → `quaner1234`.
- Name-availability recheck immediately before publish → `404 Not Found` (unregistered, available).
- `npm pack --dry-run`: 5 files, 11.2 kB (`LICENSE`, `README.md`, `cordis.patch.yml`, `lib/index.js`, `package.json`); `npm test` → **38/38 pass**.

### Publication

- First `npm publish` attempt (20:44 UTC+8) was rejected by `registry.npmjs.org` with `403 Forbidden — "Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages."` No ambient OTP was configured.
- The user supplied npm recovery codes (file outside the repo, left untouched). Retry with the **first recovery code** as the publish OTP succeeded at **20:53:22 UTC+8**: `+ dsh-subagent-watchdog@0.1.0`. That recovery code is now consumed — mark it used in your own records.
- Published tarball identity (matches the reviewed pack byte-for-byte): shasum `8e3183bce63badcaf113ca247d15ccca1bd7c83b`, integrity `sha512-+FQx0Ox5AGlkt…qCOsHWhkKv6fg==`, 5 files, 31,926 B unpacked, registry-signed (`keyid SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`).

### Public registry verification (immediately after publish)

- `npm view dsh-subagent-watchdog@0.1.0` → version `0.1.0`, `dist-tags.latest = 0.1.0`, created `2026-08-23T12:53:22.475Z`, maintainer `quaner1234`, MIT, `gitHead feacda5594…`, full metadata (`description`, keywords, repository, `exports`, `engines >=20`, `dsh.bundle.patch`) identical to the repo manifest.

### Public install into a fresh isolated DSH profile

- Fresh `DSH_HOME` at `.local-run/npm-verify-home/` (gitignored; nothing reused from earlier scratch homes). Official path only:
  `dsh plugin --profile headless add dsh-subagent-watchdog` → pnpm resolved + **downloaded 1** package from the public registry, `+ dsh-subagent-watchdog ^0.1.0`, exit 0.
- Bundle reconciliation: profile manifest `dsh.profile.bundles` = `[@deepseek-ai/dsh-base, @deepseek-ai/dsh-headless, dsh-subagent-watchdog]`.
- Byte-identity: all 5 installed files sha256-**identical** to a fresh registry tarball (`LICENSE`, `README.md`, `cordis.patch.yml`, `lib/index.js`, `package.json`).
- Loader shape: `import … from …/lib/index.js` → `exports.default` = `{ name: 'dsh-subagent-watchdog', inject: ['subagents'], apply: function }`.
- Composed-mount smoke check: `dsh --profile headless --dump-config` (exit 0) composes the inserted row at the end of the boot tree:
  `# == dsh-subagent-watchdog` → `- id: subagent-watchdog / name: dsh-subagent-watchdog`.
- No max-tokens live-acceptance burn was repeated, per the authorized scope.

### Scope discipline

Executed **only** Step 2 items 1–9: publish, verify, public-install, record, commit, push, **STOP**. No GitHub description/topics change, no tag/release, no awesome-list submission — all remain gated on new explicit approval (repository-age gate opens 2026-08-24 10:38:54 UTC+8).
