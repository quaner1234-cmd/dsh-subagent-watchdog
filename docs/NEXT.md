# NEXT — close the single blocking guard, then implement v0.1

Read [../AGENTS.md](../AGENTS.md) and [DSH-SEAMS.md](DSH-SEAMS.md) first.

## Current product decision

v0.1 has one user-visible job:

> When a native **continuable** DSH subagent ends with explicit `max-tokens`, automatically continue that same child conversation once. If recovery does not succeed, stop and tell the parent.

Use only verified official DSH seams. Do not broaden scope.

## Blocking question — verify this first

A continuable child gets a new activation epoch and new `runId` after `subagents.followup()` cold-resumes/wakes it. Before writing plugin code, determine the smallest reliable identity/guard that answers:

> Has this child task/recovery chain already received its one watchdog continuation?

The guard must prevent a second automatic continuation when any of these occur:

- the resumed activation also ends in `max-tokens`;
- duplicate/repeated `subagent/end` delivery;
- settlement/report duplication;
- cold resume creates a new activation `runId`;
- process/plugin restart or re-mount, if the runtime exposes a durable official way to recover the guard state.

Inspect only the minimum live runtime surfaces needed to answer this. Prefer existing durable child/session metadata or session events over inventing storage. If restart-safe idempotence cannot be achieved with an official seam in v0.1, document the exact limitation and choose the safest fail-closed behavior rather than adding custom persistence.

Record the verified answer in `DSH-SEAMS.md` under a short new section named `v0.1 continue-once guard`.

## Then implement the smallest v0.1

Only after the guard is verified:

1. Listen for native continuable child termination.
2. Ignore everything except explicit `stopReason: 'max-tokens'`.
3. If the guard says this child task has not been auto-continued, call the verified official `subagents.followup()` seam with one short continuation instruction that asks the child to continue the unfinished task from its existing conversation state.
4. Mark/record the one recovery before or atomically with the action so duplicate events cannot trigger another continuation.
5. If the recovery activation ends again in `max-tokens` or in an explicit provider/runtime error, do not intervene again; notify the parent once.
6. Normal completion, clean abort, refusal, one-shot children, and unknown stop reasons remain untouched.

## Acceptance criteria

- One continuable child ending in `max-tokens` is automatically continued exactly once.
- The same child cannot be auto-continued twice because of a second `max-tokens` epoch or duplicate end event.
- A successful resumed child completes normally with no extra watchdog action.
- A resumed child that fails again causes one parent notice and no further recovery.
- Provider/runtime errors are never auto-retried in v0.1.
- One-shot subagents are never recovered in v0.1.
- No UI, dashboard, DAG, team manager, heuristic timeout/stuck detector, custom orchestration layer, or extra LLM is added.

## Distribution is not part of this step

Do not spend time on README polish, npm publication, awesome-list submission, screenshots, branding, or discovery metadata until the v0.1 behavior passes the acceptance criteria locally.
