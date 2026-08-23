# NEXT — fix duplicate-end guard, then run one live recovery

Status: the duplicate-end review finding below is FIXED — the guard now keeps a
per-chain `pending`/`delivered` state (`lib/index.js`), and AC9b delivers two
genuine `subagent/end` events for the same child while the first recovery
decision is parked in-flight, asserting all three required outcomes. Suite: 30
scenarios over both artifacts, all passing. Remaining before distribution: the
live end-to-end recovery in "Then" below.

Read [../AGENTS.md](../AGENTS.md) and [DSH-SEAMS.md](DSH-SEAMS.md) first. Do not broaden product scope.

## Blocking review finding

The current `engaged` set conflates two states:

1. the first `max-tokens` end event has been accepted and the async durable check / `followup()` decision is still in flight;
2. the one watchdog continuation has actually been delivered/spent and a later activation has failed again.

In `lib/index.js`, once `engaged.has(childId)` is true, another `subagent/end` with `max-tokens` or `error` immediately calls `notifyOnce(...)`. Therefore a true duplicate delivery of the *original* end event, arriving while the first recovery decision is still pending, can produce a false "recovery failed" parent notice before any recovery activation has happened.

The current AC9 test does not actually exercise duplicate `subagent/end` delivery: it calls `resolve()` twice on the same Promise (`child.settle('max-tokens')` twice). A Promise resolves only once, so the lifecycle emitter only produces one real end event. The test proves duplicate Promise settlement is harmless, not duplicate event delivery.

## Required fix

Keep the minimal product behavior unchanged:

> A native continuable child ending in explicit `max-tokens` is automatically continued once. Only if the recovery activation later ends in `max-tokens` or explicit error does the watchdog notify the parent and stop.

Implement the smallest state model that distinguishes at least:

- first failure / recovery decision in flight;
- continuation successfully delivered (recovery spent);
- recovery activation failed again / notify once.

Do not add timers, persistence of our own, UI, heuristics, or another LLM. Preserve the durable `subagent-watchdog` marker for restart safety.

## Test requirement

Replace or supplement AC9 with a test that causes the watchdog listener to receive two genuine `subagent/end` events for the same child/original epoch while the first async recovery decision is still pending.

Assert all three:

1. exactly one child `followup()` is attempted;
2. no parent failure notice is emitted merely because of the duplicate original end event;
3. a genuinely later recovery activation that ends in `max-tokens` or `error` still emits exactly one parent notice and never triggers a second continuation.

Run the complete suite against both artifacts again.

## Then: one live end-to-end recovery

Only after the duplicate-end test passes:

1. define/run the dynamic package once on an interactive `cordis`-preset host;
2. create a real native continuable child that reliably terminates with `max-tokens`;
3. observe the watchdog deliver exactly one official `subagents.followup()` continuation;
4. verify the child resumes in the same durable conversation;
5. verify no loop/duplicate notice occurs;
6. record the observed evidence in `DSH-SEAMS.md` and commit/push.

If the live result differs from the local harness, stop and document the discrepancy rather than patching around it.

## Distribution after the live test

Do not publish yet. The repository still lacks the installable bundle metadata (`package.json` with `dsh.bundle`, `cordis.patch.yml`) and README/discovery metadata. After the live recovery passes, the next phase is packaging + npm/GitHub install verification + `dsh-plugin` topic + awesome-list submission.
