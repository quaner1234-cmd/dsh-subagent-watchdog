# AGENTS.md — dsh-subagent-watchdog

A public DSH plugin that safely recovers native continuable subagents from one high-confidence failure: explicit `max-tokens` termination.

## v0.1 product behavior

When a native **continuable** subagent ends with `stopReason: 'max-tokens'`, automatically continue that same child conversation **once** using official DSH seams.

The verified live sequence is: observe the child's terminal `turn/end`, start one official `ctx.sessions.flush(childSession)` durability checkpoint while the Session is still live, allow normal settlement, then call official `subagents.followup()` only after that checkpoint has resolved.

If that automatic continuation also ends in `max-tokens`, or ends in an explicit runtime/provider error, stop intervening and notify the parent. Never loop.

## v0.1 boundaries

- Continuable subagents only.
- `max-tokens` is the only automatic recovery trigger.
- At most one watchdog continuation for the same child task/recovery chain.
- Provider/model/runtime errors may be reported but are not auto-retried.
- One-shot subagents are not recovered in v0.1 because DSH exposes no official resume seam for them.
- Normal completion, clean abort, refusal, and unknown future stop reasons are untouched.
- No timers, polling, custom persistence, or private runtime APIs.

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

The original local implementation and duplicate-end guard are covered by the existing 30-scenario suite, but the product code has **not yet been redesigned** around the live-verified checkpoint-before-followup sequence and must not be published as-is.

Live findings:

- §8: immediate `subagents.followup()` after settlement failed because the freshly settled child's physical log lagged and cold resume could not fold its continuable descriptor.
- §9: trying to enqueue a live `Agent.followup()` from the terminal `session/event` callback is impossible because inbox mutation performs a nested session append and hits the session reentrancy guard.
- §10: one official `ctx.sessions.flush(childSession)` started from the terminal session event closes the durability gap. After settlement + checkpoint resolution, official `subagents.followup()` successfully cold-resumed the **same durable child session id** in a new activation epoch. No timers, polling, custom storage, or private APIs were required.

One implementation blocker remains before redesigning the product code: `subagents.followup(..., { signal })` must receive a **real `AbortSignal`**. The current sandbox fallback in `neverAbortSignal()` is only a duck-typed stub and is rejected by `AbortSignal.any()` once cold resume reaches `agents.resume()`. The next step is defined in [docs/NEXT.md](docs/NEXT.md).
