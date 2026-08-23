# NEXT — resolve a production-grade real AbortSignal, then patch checkpoint-before-followup

Status: **resolved and implemented.** The §10 live probe passed all six criteria; the real-`AbortSignal` blocker was resolved against the installed runtime (see "Resolution record" below); the product code has been redesigned around checkpoint-before-followup and is green locally — `node --test test/watchdog.test.mjs`, 38 scenarios over both artifacts (`lib/index.js` + regenerated `plugin/watchdog.host.js`). The expensive final real `max-tokens` end-to-end acceptance has **not** been run yet and is the only remaining pre-publish step.

One blocker remained before implementation: `subagents.followup(..., { signal })` must receive a **real `AbortSignal`**. The previous sandbox fallback in `neverAbortSignal()` is removed.

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

## Resolution record (this step)

**Signal source — verified against the installed runtime (`@deepseek-ai/dsh` 0.1.1-rc.2):**

- The five criteria are satisfied by a fresh `new AbortController().signal` created inside the plugin's own recovery attempt. (1) It is a genuine host-realm `AbortSignal` accepted by the `AbortSignal.any()` fusion in `agentLoop.resumeWith` (`dsh-agent-loop/lib/index.js` ~L1292). (2) It needs no model/tool call: first-party plugins construct controllers in normal execution — `dsh-tool-subagent/lib/index.js` L257 wraps its background one-shot run exactly this way. (3) The watchdog never aborts it, so it stays valid and non-aborted across the whole terminal-event → flush → settlement → admission window (§10's probe observed a captured signal still non-aborted minutes later). (4) It does not abort because an event callback returned; teardown-cancellation is acceptable-but-not-required for a sub-second attempt. (5) `AbortController` is a standard host primitive of the packaged plugin environment.
- Environment boundary, verified not assumed: the dynamic-package dev sandbox (`dsh-cordis-host-runner` `createSandbox`) provides only `ctx/harness/console/btoa/atob/TextEncoder/TextDecoder` plus Node-API traps; VM contexts carry no platform globals, so `AbortController` is unavailable there. No capture-free official signal source exists in that realm (cordis core exposes no fiber signal; no DSH service returns one). Consequence: a dynamically mounted dev package fails recovery contained at signal construction; the final live acceptance must run on the packaged composition shape, which is the honest production mount anyway.
- Per NEXT instruction, the duck-typed `neverAbortSignal()` fallback was deleted outright — no compatibility shim remains (`grep neverAbortSignal` over both artifacts: 0 hits).

**Implementation (smallest redesign, all ten steps done):**

1. Terminal `turn/end { kind: 'max-tokens' }` starts exactly one `ctx.sessions.flush(childSession)` via `startDurabilityCheckpoint`, gated on chain-not-engaged + mode ≠ one-shot + no checkpoint yet; nothing is enqueued or followed up inside the callback.
2. Continue-once/idempotency guard semantics unchanged (`pending`/`delivered`/`notified`, durable-marker scan).
3. On the matching `subagent/end`, the decision awaits the recorded checkpoint before the restart-safe durable verification, then calls `subagents.followup()` once with the attempt-scoped real signal (shared by the persistence inspection and the followup).
4–5. Checkpoint failure → `checkpoint-failed` notice once, chain spent, no retry; followup failure → existing mark-before-act `delivery-failed`; recovered-epoch failures → one notice, never continued again. Unverifiable mode stays fail-closed silent (AC7a preserved).
6–7. Stub removed; `plugin/watchdog.host.js` regenerated via `scripts/sync-dynamic.mjs` (byte-derived test enforces alignment).
8–9. Suite extended to 38 scenarios: AC11 (one checkpoint on the live child session, strictly before followup), AC12 (rejected checkpoint → one `checkpoint-failed` notice, no followup, never retried), AC12b (synchronous admission throw contained), AC13 (duplicate genuine end while the checkpoint is pending → one continuation, no false notice), real-signal assertions at the followup boundary (AC1) and the inspection boundary (AC8). All green over both artifacts.
10. This file, `AGENTS.md`, and `DSH-SEAMS.md` §11 carry the evidence; committed and pushed.

**Still open:** only the final real `max-tokens` end-to-end acceptance run on a production-shaped (packaged) mount.
