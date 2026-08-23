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

Runtime seam survey complete. Product scope narrowed to a single recovery action. Before implementation, close the one blocking question in [docs/NEXT.md](docs/NEXT.md): how to identify and persist/guard the single allowed automatic continuation safely across activation epochs.
