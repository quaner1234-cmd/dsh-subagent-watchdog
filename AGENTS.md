# AGENTS.md — dsh-subagent-watchdog

A public DSH plugin that safely recovers native continuable subagents from one high-confidence failure: explicit `max-tokens` termination.

## v0.1 product behavior

When a native **continuable** subagent ends with `stopReason: 'max-tokens'`, automatically continue that same child conversation **once** using the verified official DSH `subagents.followup()` seam.

If that automatic continuation also ends in `max-tokens`, or ends in an explicit runtime/provider error, stop intervening and notify the parent. Never loop.

## v0.1 boundaries

- Continuable subagents only.
- `max-tokens` is the only automatic recovery trigger.
- At most one watchdog continuation for the same child task/recovery chain.
- Provider/model/runtime errors may be reported but are not auto-retried.
- One-shot subagents are not recovered in v0.1 because DSH exposes no official resume seam for them.
- Normal completion, clean abort, refusal, and unknown future stop reasons are untouched.

## Hard non-goals

No dashboard, no team manager, no DAG, no heuristic stuck detector, no custom orchestration layer, no second LLM deciding whether recovery is needed.

## Working rules

- Every runtime/API claim must be verified against the installed DSH runtime first.
- The verified seam survey lives in [docs/DSH-SEAMS.md](docs/DSH-SEAMS.md). Treat its verified runtime facts as the source of truth; product decisions may evolve in `AGENTS.md` and [docs/NEXT.md](docs/NEXT.md).
- Never infer undocumented APIs. Before writing or changing plugin code, load the built-in `cordis-plugin-development` skill and inspect the live runtime (`cordis_inspect_list` → `cordis_inspect_query`) on the `cordis` preset.
- Prefer deterministic enum/state signals over heuristics.
- Recovery must be idempotent: repeated events, cold resume, restart, or duplicate settlement must not cause a second automatic continuation.
- Keep the implementation as small as possible. Do not add infrastructure until a concrete acceptance criterion requires it.

## Status

v0.1 implemented; the blocking guard question is answered in
[docs/DSH-SEAMS.md](docs/DSH-SEAMS.md) §6a, the duplicate-end review finding is
fixed (per-chain `pending`/`delivered` guard state + AC9b), and all acceptance
criteria pass locally (`node --test test/watchdog.test.mjs`; 30 scenarios over
both artifacts against real cordis/dsh-subagent/dsh-session dispatch, recovery
seam spied at the official call boundary). Sources: [lib/index.js](lib/index.js),
[plugin/watchdog.host.js](plugin/watchdog.host.js), [test/watchdog.test.mjs](test/watchdog.test.mjs).
The live end-to-end step was executed on a real `cordis`-preset host and
**diverged**: guard behavior matched the harness exactly, but the official
`followup()` seam rejected the continuation (`NOT_RESUMABLE`) because the
freshly settled child's durable log had not yet been flushed — see
[docs/DSH-SEAMS.md](docs/DSH-SEAMS.md) §8. The alternative synchronous live
seam (enqueue via `Agent.followup()` during `turn/end` dispatch, before the
loop's post-turn inbox check) was then investigated and **ruled out**: the
inbox splice is itself a session append, so the runtime's reentrancy guard
throws before anything is enqueued — see [docs/DSH-SEAMS.md](docs/DSH-SEAMS.md)
§9. v0.1 is live-blocked pending a product decision; nothing was patched
around either discrepancy.
