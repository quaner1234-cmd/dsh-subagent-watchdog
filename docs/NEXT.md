# NEXT — distribution only

Status: Steps 1–3 of the previous plan are **complete** at the packaging +
live-acceptance milestone. The smallest local-installable package exists
([package.json](../package.json) with `dsh.bundle.patch` +
[cordis.patch.yml](../cordis.patch.yml); entry remains `lib/index.js`, no build
step), it installs through the ordinary `dsh plugin --profile <name> add` path,
and the one final real max-tokens end-to-end acceptance run **passed all seven
criteria on a production-shaped headless mount** — including a same-session-id
cold resume 68 ms after settlement under a fresh runId, exactly one durable
watchdog continuation marker across both inspections, and a healthy recovered
activation with zero further interventions. Full evidence and the live-found
`inject: ['subagents']` fix are recorded in docs/DSH-SEAMS.md §12.

Feature development is STOPPED. The next phase is distribution only:
README + package metadata polish + local install recheck + npm publication +
GitHub description/topics (`dsh-plugin`) + ecosystem submission/discovery work.
Do not publish to npm or submit to an awesome list as part of a feature step.
Do not add product features.

## Step 1 — create the smallest local-installable package — DONE (see §12.1 of DSH-SEAMS.md)

Before writing metadata, inspect the installed DSH plugin-development guidance/runtime and verify the current official bundle/composition format. Do not infer stale package fields or install commands.

Create only the metadata/files required to mount `lib/index.js` as an ordinary local DSH plugin in the full host process. Prefer the smallest package shape. At minimum verify whether the current runtime requires `package.json`, `dsh.bundle`, and/or `cordis.patch.yml`, and use the verified format.

Requirements:

1. The production entry remains `lib/index.js`; do not move or rewrite working product logic merely for packaging.
2. No build step should be necessary for a local install if the runtime accepts the existing JS artifact.
3. Do not add README/discovery/marketing work yet.
4. Run the existing 38-scenario suite after packaging; packaging must not change behavior.
5. Install/mount the plugin locally through the same ordinary plugin path a real user would use (local path/package is fine; do not publish).

## Step 2 — cheap host-shape verification — DONE (probe recorded genuine `AbortController`/`AbortSignal` + `AbortSignal.any` fusion; normal continuable child completed untouched)

Before the final max-token recovery run, prove on the packaged composition mount that:

- the Watchdog is actually loaded in the ordinary host process;
- the recovery code sees a genuine standard `AbortController` / `AbortSignal` environment, not the dynamic Cordis sandbox;
- loading the plugin causes no behavior change for a normal completed continuable child.

Use a cheap probe or observable diagnostic only if needed. Do not add a permanent product UI/tool solely for this verification.

If the packaged mount still lacks a genuine `AbortController`, STOP and document the discrepancy. Do not add a fake signal or private workaround.

## Step 3 — one final real max-tokens end-to-end acceptance — DONE, ALL SEVEN CRITERIA PASS (trace in §12.4)

Only after Steps 1–2 pass, run exactly one final native continuable-child recovery test through the packaged mount.

Before burning a default 32,768-token output, inspect whether the official native continuable start path lets the test child use a deliberately small `maxTokens` through a supported public option while preserving the same `stopReason: 'max-tokens'` lifecycle. If yes, use that cheaper deterministic ceiling. If not, run one default real ceiling test. Do not alter product code to make the test easier.

Acceptance criteria:

1. A real native continuable child ends its first activation with explicit `max-tokens`.
2. Watchdog starts exactly one official `ctx.sessions.flush(childSession)` checkpoint while the Session is live.
3. After settlement + checkpoint resolution, one official `subagents.followup()` is accepted with a genuine `AbortSignal`.
4. The **same durable child session id** resumes in a new activation epoch (new runId).
5. Exactly one automatic continuation is ever delivered for the chain.
6. If the resumed activation completes normally, Watchdog emits no recovery-failed notice. If it fails again, it emits at most one notice and performs no second continuation.
7. No timer, polling, custom persistence, private runtime API, or model-based recovery judgment is introduced.

Record the exact live evidence in `docs/DSH-SEAMS.md`, update `AGENTS.md` status, run the full local suite once more, commit and push.

If the final live acceptance passes, STOP feature development. The next phase is distribution only: README + package metadata polish + local install recheck + npm publication + GitHub description/topics (`dsh-plugin`) + ecosystem submission/discovery work.

If it fails, stop and document the discrepancy rather than patching around it.