# AGENTS.md — dsh-subagent-watchdog

A public DSH plugin that detects high-confidence failures in native DSH subagents and
notifies the parent agent.

## v0.1 scope

Detect exactly two failure classes:

1. max/output-token termination (`stopReason: 'max-tokens'`);
2. explicit model/provider/runtime errors (`stopReason: 'error'` with structured
   `LlmFailure` facts folded from the child's durable log).

On detection, notify the parent and suggest only recovery actions supported by the
current official DSH runtime (`send_message`, `interrupt_agent`, parent-side
re-delegation). v0.1 **notifies only** — it never retries, interrupts, or re-delegates
on its own.

## Hard non-goals

No dashboard, no team manager, no DAG, no heuristic stuck detector, no custom
orchestration layer. If a feature needs any of these, it is out of this project.

## Working rules

- Every runtime/API claim must be verified against the installed DSH runtime first.
  The verified seam survey lives in [docs/DSH-SEAMS.md](docs/DSH-SEAMS.md) — treat it
  as the single source of truth for what exists and what does not.
- Never infer undocumented APIs. Before writing or changing plugin code, load the
  built-in `cordis-plugin-development` skill and inspect the live runtime
  (`cordis_inspect_list` → `cordis_inspect_query`) on the `cordis` preset.
- Keep detection high-confidence only. Subagent stop reasons are merge-extensible
  enums: branch on known cases, fall through `default` silently.

## Status

Findings phase complete (`docs/DSH-SEAMS.md`). Plugin implementation not started;
next steps in [docs/NEXT.md](docs/NEXT.md).
