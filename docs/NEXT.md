# NEXT — release prep only; stop before external publication

Status: **release candidate ready** (2026-08-23). v0.1 feature development is complete at commit `d1427cb`. The production-shaped packaged mount passed the final live acceptance: a real continuable child ended with explicit `max-tokens`, the watchdog checkpointed durability, cold-resumed the same durable child session id under a fresh runId 68 ms after settlement, delivered exactly one durable watchdog continuation marker, and the recovered activation completed normally. Local suite: 38/38 scenarios over both artifacts. See `docs/DSH-SEAMS.md` §12.

Release-candidate record (all Step-2 checks pass):

1. `npm test` — 38/38 green, re-confirmed on a fresh `/tmp` clone.
2. `npm pack` tarball `dsh-subagent-watchdog-0.1.0.tgz` — 11.0 kB packed / 31.4 kB unpacked, exactly 5 files: `LICENSE`, `README.md`, `cordis.patch.yml`, `lib/index.js`, `package.json`. No tests, probes, logs, or local artifacts.
3. Installed that real tarball through the ordinary path into an isolated scratch profile (`DSH_HOME=.local-run/rc-home2 dsh plugin --profile headless add <tarball>`): bundle-stack reconciliation appended the package, installed files are byte-identical to the repo artifacts, loader-shape import OK (`exports.default ?? exports` → `{name, inject:['subagents'], apply}`), and `--dump-config` shows the composed boot tree mounting the inserted row (`id: subagent-watchdog`). Runtime behavior is byte-identical to the §12 live acceptance, so no burn was repeated.
4. Fresh clone runs the full suite green; the shipped tarball installs standalone (single `file:` tarball dependency, no workspace links, zero runtime deps).
5. `git status` clean of generated/runtime artifacts (`.local-run/`, `.pnpm-store/`, `.DS_Store` ignored).

Publication copy staged in [docs/RELEASE-COPY.md](docs/RELEASE-COPY.md). Nothing external has been mutated: no npm publish, no GitHub description/topics change, no tag/release, no awesome-list PR.

Do not add product features. Do not publish to npm, create a GitHub release, or submit to an ecosystem/awesome list in this step. The release candidate now stops for user review; any external publication requires explicit user approval in a later step.

## Step 1 — README and package metadata

Create the smallest useful public README. The first screen must state the user problem and exact behavior in plain language:

> When a native continuable DSH subagent ends because it hit `max-tokens`, Watchdog automatically continues the same child conversation once, then stops. No loops.

README should include only what a user needs:

1. What problem it solves and the exact v0.1 scope.
2. Installation through the verified ordinary DSH plugin path.
3. What happens on first `max-tokens`, second failure, normal completion, one-shot children, and unsupported/no-persistence environments.
4. Safety/non-goals: one automatic continuation maximum; no timers, polling, private APIs, extra LLM, dashboard, DAG, or team manager.
5. Compatibility: explicitly name the DSH runtime version actually live-tested (`@deepseek-ai/dsh 0.1.1-rc.2`) without claiming broader compatibility that has not been tested.
6. A short verification/evidence section linking to `docs/DSH-SEAMS.md` rather than copying the research log into the README.

Polish `package.json` only as needed for npm/public discovery. Preserve `name`, `version: 0.1.0`, `main`, `exports`, `files`, `dsh.bundle.patch`, zero dependencies, and no build step unless a verified publishing requirement demands otherwise. Add conventional discovery fields only when accurate (for example `keywords`, `homepage`, `bugs`). Do not make marketing claims unsupported by the live evidence.

## Step 2 — release-candidate checks

Run all of these before publication:

1. `npm test` / full 38-scenario suite remains green.
2. `npm pack --dry-run` and inspect the exact files that would ship. The tarball must contain only the intended runtime/package files plus README/license metadata; no tests, probes, local-run artifacts, session logs, or private experiment files.
3. Build a real local tarball with `npm pack`, install that tarball through the ordinary `dsh plugin --profile <scratch> add <tarball>` path in an isolated scratch profile, and verify the plugin mounts successfully. A cheap normal-child smoke test is enough; do not repeat the max-token burn unless packaging changes runtime behavior.
4. Verify a fresh clone/install does not depend on undeclared local files or workspace state.
5. Re-run `git status` and ensure no generated/runtime artifacts are accidentally tracked.

If any release-candidate check exposes a runtime defect, stop and document it before changing product logic. Packaging/documentation defects may be fixed normally, followed by the checks again.

## Step 3 — discovery copy, but no external mutation yet

Prepare the exact metadata/copy for later publication:

- GitHub description: concise, concrete, searchable; include `DSH`, `subagent`, `max-tokens`, and `auto-continue once` semantics.
- GitHub topics: at minimum `dsh-plugin`; add only directly relevant topics.
- npm package description/keywords consistent with the README.
- one-line awesome-list description focused on the user-visible benefit, not implementation internals.
- verified install command for the eventual npm package.

Do not actually change repository description/topics, publish npm, create a release/tag, or submit a PR to an awesome list in this step unless the user explicitly approves external publication.

## Stop condition

When README + metadata are ready and every release-candidate check passes, update `AGENTS.md` and this file to `release candidate ready`, commit and push. Report the exact tarball contents, install command, package size, test result, and the proposed GitHub/npm/awesome-list copy. Then stop for user approval before any public publication or ecosystem submission.
