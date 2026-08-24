# NEXT — ecosystem submission authorized

Status: `dsh-subagent-watchdog@0.1.0` is live on npm, the public install path is verified, GitHub discovery metadata is applied, and public tag/release `v0.1.0` points exactly to the npm-published commit `feacda5594a276cbdd9fb2ba8262eaf1585865fb`. Feature development remains stopped.

The user explicitly approved the `awesome-dsh-plugin` ecosystem submission on 2026-08-24 at ~10:39 UTC+8, after the repository-age gate opened.

## Fixed published artifact

- npm: `dsh-subagent-watchdog@0.1.0`
- npm `gitHead`: `feacda5594a276cbdd9fb2ba8262eaf1585865fb`
- GitHub tag: `v0.1.0` -> exactly that commit
- GitHub Release: `https://github.com/quaner1234-cmd/dsh-subagent-watchdog/releases/tag/v0.1.0`
- Repository topics currently include exactly: `cordis`, `dsh`, `dsh-plugin`, `max-tokens`, `subagent`, `watchdog`
- Repository created: `2026-08-23T02:38:54Z`; age gate >=1 day opened at `2026-08-24T02:38:54Z` (10:38:54 UTC+8)
- Commit-count requirement >=10 is satisfied.

## Current upstream rules verified before authorization

Current `awesome-dsh-plugin/awesome-dsh-plugin` `contributing.md` says submissions:

- add one source entry at `data/plugins/<owner>__<repo>.yml`;
- require a real working plugin with `dsh.bundle` in `package.json`;
- require repo age >=1 day and >=10 commits;
- require the `dsh-plugin` topic;
- require factual, non-marketing descriptions;
- regenerate both generated READMEs with `npm ci` + `node scripts/generate-readme.mjs`;
- must not hand-edit generated READMEs or modify unrelated existing entries.

Maintainers review whether the code actually matches the description, whether the category is reasonable, whether the entry duplicates an existing plugin, and whether the source contains alarming behavior.

## Authorized action — awesome-dsh-plugin submission only

Execute exactly this submission workflow, then STOP:

1. Pull latest `origin/main` of this repo and read `AGENTS.md`, this file, `README.md`, `package.json`, and `cordis.patch.yml`.
2. Re-read the latest upstream `awesome-dsh-plugin/awesome-dsh-plugin` `contributing.md` from `main`. If its requirements have materially changed from the rules summarized above, STOP and report before mutating anything.
3. Re-verify submission gates against the public repository: public/active, created >=1 day ago, >=10 commits, `dsh.bundle` present, `dsh-plugin` topic present, npm `0.1.0` live, and no existing entry for `quaner1234-cmd/dsh-subagent-watchdog`. Search the current list for an already-listed plugin that claims the same narrow behavior; if there is an obvious duplicate whose entry fully covers this behavior, STOP and report rather than arguing around the rule.
4. GitHub API operations may run **unsandboxed** because sandboxed shells cannot read the macOS keychain-held `gh` credential. Never print or persist the token. Git operations may continue to use SSH.
5. Fork `awesome-dsh-plugin/awesome-dsh-plugin` to the authenticated GitHub account if no fork exists. Sync the fork from fresh upstream `main`, create a clean submission branch, and make no unrelated changes.
6. Add exactly this source entry as `data/plugins/quaner1234-cmd__dsh-subagent-watchdog.yml`:

```yaml
url: https://github.com/quaner1234-cmd/dsh-subagent-watchdog
name: quaner1234-cmd/dsh-subagent-watchdog
category: workflow
description:
  en: Automatically continues a native continuable DSH subagent once when it ends with explicit max-tokens termination, then stops.
  zh: 当原生可续接 DSH 子代理因明确的 max-tokens 终止时自动续接一次，然后停止介入。
```

`workflow` is chosen for the user-facing behavior (automatic recovery flow), not for the internal durable-session mechanism. If the current upstream taxonomy has materially changed, STOP instead of inventing a new category.

7. Run the upstream-required generation/checks from the fork checkout. At minimum: `npm ci`, `node scripts/generate-readme.mjs`, and the repository's current submission/check scripts documented by upstream. Inspect the final diff carefully. The only intentional source-entry change must be the new YAML; generated README changes are allowed only as generator output. If unrelated plugin entries are modified, STOP and report.
8. Commit the clean submission branch, push it to the fork, and open one PR to `awesome-dsh-plugin/awesome-dsh-plugin:main`.

Suggested PR title:

`Add quaner1234-cmd/dsh-subagent-watchdog (workflow)`

Suggested PR body:

```markdown
Adds `quaner1234-cmd/dsh-subagent-watchdog` under the `workflow` category.

The plugin automatically continues the same native continuable DSH subagent exactly once when it ends with explicit `max-tokens` termination, then stops intervening. It is zero-configuration and published on npm as `dsh-subagent-watchdog@0.1.0`.

Validation:
- [x] `dsh.bundle` declared in `package.json`
- [x] real working code; repository is older than 1 day and has >=10 commits
- [x] `dsh-plugin` topic present
- [x] public npm package and fresh-profile DSH install verified
- [x] description is factual and matches the code
- [x] both generated READMEs regenerated from the YAML source entry
- [x] no unrelated plugin entry modified
```

9. Verify the PR exists and inspect its changed-file list. If CI starts promptly, read its result; do not bypass failed checks. If CI or a maintainer requests changes, STOP and report the exact request rather than changing product code or widening claims autonomously.
10. Record the PR URL, branch/commit, changed-file scope, and current CI status in this file, commit/push that documentation update to this repository, then STOP.

## Completed ecosystem submission record (2026-08-24)

The authorized `awesome-dsh-plugin` submission was executed per the steps above and is complete. No product code, npm metadata, tags, or releases changed.

- Upstream rules re-read from `awesome-dsh-plugin/awesome-dsh-plugin@main` (`ca57824`): no material change vs. the summary above — one YAML entry, same gates, same regeneration commands, `workflow` still a valid category. New clarifications (max 3 entries/PR; accuracy review) are satisfied.
- Gates re-verified live: public/not archived; created `2026-08-23T02:38:54Z`; 26 commits; remote `package.json` declares `dsh.bundle.patch`; topics include `dsh-plugin`; npm latest = `0.1.0` with matching `gitHead` and repository backlink; no pre-existing entry for this repo.
- Duplicate scan over all 2016 existing entries: closest entries (`Frog755/dsh-client-auto-retry`, `haochi72/dsh-auto-continue-429`, `HsiangNianian/dsh-auto-continue`, `shengyvself/dsh-autoresume`) target client/web turns or rate-limit/restart triggers with capped retry loops — none fully covers "native continuable subagent + max-tokens trigger + exactly once". Proceeded per rule 3.
- Fork: `https://github.com/quaner1234-cmd/awesome-dsh-plugin` (created and synced to upstream `main` `ca578248deeaaab94393cf4b9f20bbd5fc97c118`). Branch: `add-quaner1234-cmd__dsh-subagent-watchdog`; head commit `a1a731fcfe34283b3ea648fb9fb944dbeea79a2f` (single commit).
- Entry added byte-for-byte as specified in step 6: `data/plugins/quaner1234-cmd__dsh-subagent-watchdog.yml`.
- Local checks from the fork checkout: `npm ci` clean; `node scripts/generate-readme.mjs` regenerated both READMEs (2017 entries); upstream's own gate `node scripts/check-submission.mjs --base ca57824` → all checked entries pass.
- PR: **https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/2964** (`OPEN`, base `main`, title `Add quaner1234-cmd/dsh-subagent-watchdog (workflow)`).
- Changed-file scope verified via the API: exactly 3 files, `+8/-0` — `data/plugins/quaner1234-cmd__dsh-subagent-watchdog.yml` (added, +6), `README.md` (+1), `README.zh.md` (+1), the two README lines being pure generator output. Zero modifications to existing entries.
- CI status observed 2026-08-24T03:25Z on head `a1a731f`: `check` (pr-check.yml) = success; `Submission gate` (pr-gate.yml) = success.

## Hard stop conditions

- Upstream contribution rules materially changed => STOP.
- Eligibility gate fails => STOP.
- Existing list entry already fully covers this exact plugin => STOP.
- Fork/branch/PR authentication or permission failure => STOP; do not expose credentials or improvise around permissions.
- Generator/checks modify unrelated plugin entries or required checks fail => STOP.
- No product-code changes, npm republish/version changes, tag movement, or GitHub Release rewrites in this step.
- No marketing claims, inflated compatibility claims, or stronger acceptance-evidence claims than the public README supports.

## Completed publication record

- npm publication + public fresh-profile install verification completed 2026-08-23.
- GitHub description/topics + exact `v0.1.0` tag/release completed 2026-08-23.
- `v0.1.0` remains anchored to npm `gitHead feacda5594a276cbdd9fb2ba8262eaf1585865fb`, even though `main` advanced afterward with documentation-only publication records.
