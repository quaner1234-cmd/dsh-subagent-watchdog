# NEXT — npm publication authorized

Status: **v0.1.0 release candidate ready and npm publication explicitly approved by the user on 2026-08-23 at ~20:40 UTC+8.** Feature development remains stopped.

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
