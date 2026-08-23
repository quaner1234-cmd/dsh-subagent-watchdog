# NEXT — resolve a production-grade real AbortSignal, then patch checkpoint-before-followup

Status: the §10 live probe passed all six criteria. The durability gap is closed by one official `ctx.sessions.flush(childSession)` checkpoint started from the terminal session event, followed after settlement + checkpoint resolution by official `subagents.followup()`. The product code has **not** yet been updated to this sequence.

One blocker remains before implementation: `subagents.followup(..., { signal })` must receive a **real `AbortSignal`**. The current sandbox fallback in `neverAbortSignal()` is a duck-typed object; live cold resume proved that `AbortSignal.any()` inside `agents.resume()` rejects it.

Do not publish yet. Do not add timers, polling, custom persistence, private runtime APIs, or another LLM.

## Current blocking question

Find the smallest official, production-available source of a real `AbortSignal` that an ordinary installed Watchdog plugin can use for the asynchronous recovery operation **without requiring a model/tool call or human interaction**.

Before changing product code, inspect the installed runtime and verify the exact source. Do not infer names or contracts.

The chosen signal must satisfy all of these:

1. It is a genuine host-realm `AbortSignal`, accepted by the same `AbortSignal.any()` path used by cold resume.
2. It is available to normal plugin execution/event handling; it must not depend on capturing a signal from a temporary diagnostic/model tool call.
3. It remains valid and non-aborted across the required async window: terminal `session/event` → `sessions.flush()` resolution → `subagent/end` settlement → `subagents.followup()` admission.
4. Its cancellation semantics are appropriate for plugin teardown. If the plugin/session/runtime is disposed, cancellation is acceptable; it must not abort merely because the originating event callback returned.
5. It comes from a public/official Cordis/DSH seam or standard host primitive available in the packaged plugin environment. No duck typing, no private fields, no global monkey patch.

## If a valid signal source is verified

Then implement the smallest redesign:

1. On a continuable child's first `turn/end { reason.kind: 'max-tokens' }`, start exactly one official `ctx.sessions.flush(childSession)` checkpoint while the Session is live. Do not enqueue or follow up from inside the event callback.
2. Preserve the existing continue-once/idempotency guard semantics.
3. On the matching `subagent/end`, await the recorded checkpoint, then perform the restart-safe durable marker check and call official `subagents.followup()` once with the verified real signal.
4. If the checkpoint fails, the child cannot be verified as continuable, or followup fails, do not retry automatically; notify the parent once and stop.
5. If the recovery activation later ends in `max-tokens` or explicit error, notify once and never continue again.
6. Remove the invalid duck-typed `neverAbortSignal()` fallback; do not retain dead compatibility code.
7. Regenerate `plugin/watchdog.host.js` from the source artifact and keep both artifacts byte/behavior aligned.
8. Extend tests to cover at least: checkpoint success, checkpoint rejection, duplicate terminal/end delivery while checkpoint is pending, restart marker behavior, real-signal plumbing at the official followup boundary, and no second continuation.
9. Run the full suite against both artifacts.
10. Update `AGENTS.md`, `DSH-SEAMS.md`, and this file with the exact implementation evidence; commit and push.

Do **not** run the expensive final real `max-tokens` end-to-end acceptance test in this step. Stop after the redesigned implementation is green locally and pushed so it can be reviewed before the final live burn.

## Kill condition

If no production-available real `AbortSignal` source satisfying the five criteria exists in the normal plugin execution path, stop and document that limitation. Do not work around it with a fake signal, timer, polling loop, private API, or interactive tool-call dependency. Reconsider the product boundary instead.
