# NEXT — verify an explicit durability checkpoint before cold resume

Status: v0.1 product code is unchanged and live-blocked on `@deepseek-ai/dsh` 0.1.1-rc.2. Two recovery paths are now ruled out by live evidence:

1. `subagent/end` → immediate official `subagents.followup()` fails with `NOT_RESUMABLE` because the freshly settled child is no longer live and its physical log has not yet caught up (`DSH-SEAMS.md` §8).
2. `session/event: turn/end` → synchronous live `Agent.followup()` cannot enqueue because inbox mutation performs a nested session append and hits the session reentrancy guard (`DSH-SEAMS.md` §9).

Do not modify product code yet. Do not add timers, polling, custom persistence, private runtime APIs, or another LLM.

## One remaining clean seam to test

Test whether an explicit **official durability checkpoint** can close the §8 gap without changing the product contract.

Relevant public runtime facts to verify on the installed host before probing:

- `session/event` receives the live `Session` object after the event is committed.
- `ctx.sessions.flush(session)` is the public awaited durability checkpoint.
- the first-party persistence backend treats a requested `session/flush` as an immediate quiescence barrier for buffered writes.

Hypothesis:

> When a continuable child reaches its terminal turn while its Session is still live, start exactly one `ctx.sessions.flush(childSession)` checkpoint. Do **not** enqueue work inside the `session/event` callback. After the child settles and the checkpoint has resolved, call the existing official `subagents.followup()` seam. If the checkpoint made the descriptor durable, cold resume should now succeed using the same durable child id.

This is intentionally different from the ruled-out §9 path: `flush()` is a durability barrier, not an inbox/session append, and the actual follow-up happens only after the append dispatch has finished.

## Probe first; no product patch

Use a disposable dynamic probe on the `cordis` preset. Prefer a cheap continuable child that completes quickly if the persistence/cold-resume mechanics are independent of stop reason; only burn another 32,768-token max-tokens child if needed to disambiguate behavior.

The probe must establish all of the following:

1. calling `ctx.sessions.flush(session)` from the terminal `session/event` observation is admitted and does not hit the append reentrancy guard;
2. the flush promise resolves;
3. after settlement, `sessionPersistence.inspect(childId)` / the physical log contains the continuable descriptor needed by `coldResume`;
4. one official `subagents.followup(parent, childId, …)` after that flush succeeds;
5. the child resumes under the **same durable session id** in a new activation epoch;
6. no timer, polling loop, custom storage, or private API is required.

If any of these fail, stop and document the discrepancy. Do not patch around it.

If all pass, record the evidence in `DSH-SEAMS.md`, commit/push, and only then redesign the v0.1 implementation around the checkpoint-before-followup sequence and run one final real max-tokens end-to-end acceptance test.

## Kill condition

If the explicit official flush barrier cannot make immediate cold resume reliable, stop pursuing automatic max-token recovery for v0.1 on this runtime. Do not degrade into a notification-only plugin: native DSH already reports these terminal outcomes. At that point document the upstream runtime limitation and reconsider the product rather than adding timing heuristics.
