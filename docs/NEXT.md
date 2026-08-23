# NEXT — publication gate

Status: **v0.1.0 release candidate ready**. Feature development is stopped. The release candidate passed 38/38 deterministic scenarios, fresh-clone verification, clean `npm pack`, real tarball installation through `dsh plugin --profile <profile> add`, byte-identity checks, and packaged-mount composition smoke checks. The public README calibrates the final live evidence against the recorded protocol deviation.

Nothing external has been published yet.

## Current gate status — npm authentication blocked

Publication Step 1 was executed on 2026-08-23 using only the workspace-local npm cache (`--cache ./.local-run/.npm-cache`). Results:

- `npm whoami` → **FAILED with `ENEEDAUTH`**. This machine is not authenticated to the npm public registry. `~/.npmrc` contains no auth token, there is no repo `.npmrc`, and no `NPM_CONFIG*` environment credential was present. No login flow was attempted.
- `npm view dsh-subagent-watchdog` → public registry **404**, so the unscoped package name is still unregistered at the time of the check.
- Because the pulled commit changed packaged README bytes, `npm pack --dry-run` and `npm test` were rerun: pack succeeded with exactly five intended files (`LICENSE`, `README.md`, `cordis.patch.yml`, `lib/index.js`, `package.json`) and the suite remained **38/38 green**.

**Human action required:** authenticate this machine to the intended npm publisher account, then rerun only `npm whoami` (and recheck package-name availability immediately before publish). Do not publish until the identity check succeeds.

Use the workspace-local npm cache; do not change ownership of the global npm cache merely to unblock this release.

Suggested interactive login from the repo:

```sh
npm login --registry=https://registry.npmjs.org/ --auth-type=web --cache ./.local-run/.npm-cache
```

Then verify:

```sh
npm whoami --registry=https://registry.npmjs.org/ --cache ./.local-run/.npm-cache
```

If there is no npm account yet, create/verify one first. npm requires a verified email address to publish, and current npm publishing requires either account 2FA or an eligible granular token configuration.

## Publication order

Do not add product features. External publication requires explicit user approval.

1. **Pre-publish npm identity/name check**
   - From the repo, use a workspace-local npm cache rather than changing the global root-owned cache, e.g. `--cache ./.local-run/.npm-cache`.
   - Verify `npm whoami` succeeds for the intended publisher account.
   - Verify `dsh-subagent-watchdog` is still available on the npm registry immediately before publication.
   - Run one final `npm pack --dry-run` / `npm test` only if packaged files changed since the release-candidate check.

2. **Publish npm first**
   - Publish `dsh-subagent-watchdog@0.1.0` from the reviewed commit.
   - Immediately verify the registry page/version and test the public install command in a fresh isolated profile:
     `dsh plugin --profile <scratch> add dsh-subagent-watchdog`.
   - If public install fails, STOP before creating a release or ecosystem submission.

3. **Apply GitHub discovery metadata**
   - Description: `DSH plugin that auto-continues a native continuable subagent once when it ends with explicit max-tokens termination — then stops. No loops, no timers, official seams only.`
   - Topics: `dsh-plugin`, `dsh`, `cordis`, `subagent`, `max-tokens`, `watchdog`.
   - Repository currently has no description/topics; apply only after npm publication succeeds.

4. **Tag / GitHub Release**
   - Tag the exact published commit as `v0.1.0` and create a concise release from the reviewed README/release copy.
   - Do not retag a different commit under the same version.

5. **Awesome-list submission — WAIT FOR ELIGIBILITY**
   - Current `awesome-dsh-plugin` rules require a real working plugin, `dsh.bundle`, `dsh-plugin` topic, accurate description, repository age **>= 1 day**, and **>= 10 commits**.
   - This repository was created at `2026-08-23T02:38:54Z`; the one-day age gate is not satisfied until **2026-08-24T02:38:54Z** (10:38:54 at UTC+8). Commit count is already above 10.
   - After the age gate and after npm/public-install verification, submit one plugin YAML entry only, following the current contributing guide; do not hand-edit the generated awesome-list READMEs.

## Stop conditions

- Any npm auth/name/public-install failure => STOP and report; do not improvise around it.
- Any release metadata discrepancy => fix docs/metadata, then re-run only the checks affected by that change.
- No more product behavior changes in v0.1.0 unless a reproducible release-blocking defect is found.
