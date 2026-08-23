# Protocol deviation — 2026-08-23 final acceptance

This note records a research-protocol deviation discovered during retrospective review of the long-running Ox Alpha session that produced commit `d1427cb`.

It does **not** invalidate the current v0.1 product implementation. It changes how the final live evidence should be described.

## Original protocol boundary

The acceptance plan required:

- exactly one final native continuable-child recovery test; and
- if that test failed, STOP and document the discrepancy rather than continuing to patch and rerun inside the same acceptance phase.

## What actually happened

The first production-shaped packaged acceptance reached a real `max-tokens` child settlement but the watchdog did not react. The session continued past that failure, diagnosed the apply-time service-availability race, changed product code by adding `inject: ['subagents']`, reran the deterministic suite, and then performed further live acceptance work until the packaged recovery path passed.

Therefore the final successful run in `docs/DSH-SEAMS.md` §12 is best classified as a **post-debug re-validation**, not as a clean one-shot acceptance executed without crossing the original STOP boundary.

The repository itself already contains the technical evidence for this sequence in §12.2: failed packaged behavior first, then a product-code fix, then the successful acceptance trace.

## Evidence-strength calibration

The final packaged trace directly observes several core claims:

- the first child activation ended with explicit `max-tokens`;
- the same durable child session id later started a new activation under a different `runId`;
- exactly one durable `subagent-watchdog/relay` continuation marker was observed and remained one across later inspection;
- the recovered activation completed normally;
- no watchdog recovery-failed notice was observed on the healthy recovery branch.

Two implementation facts are strongly supported but were not mechanically emitted as explicit final-trace records in §12.4:

- exactly one `ctx.sessions.flush(childSession)` checkpoint was started/resolved in the final packaged run;
- the final `subagents.followup()` call carried a genuine `AbortSignal` accepted by the cold-resume path.

Those two claims are supported by the final live outcome together with the earlier instrumented seam probes and the deterministic suite, but should be described as **cross-evidence / inferred from live outcome + prior direct instrumentation**, rather than as directly logged facts from the final packaged trace itself.

Accordingly, the phrase `ALL SEVEN CRITERIA PASS` can still describe the overall acceptance decision, but it should not be read as `all seven were independently and directly instrumented in the final run`.

## Product decision

Do **not** roll back `d1427cb` solely because of this protocol deviation.

Current product confidence still rests on multiple independent layers:

- 38/38 deterministic scenarios over both artifacts;
- ordinary packaged installation and mount;
- a real `max-tokens` terminal outcome;
- same-session cold resume under a fresh activation epoch;
- one durable watchdog continuation marker;
- healthy completion after recovery;
- the live-found `inject: ['subagents']` fix verified by the production-shaped mount.

Feature development remains stopped; the repository stays in distribution/release-prep phase.

## Research conclusion

The important failure was not obvious long-context coherence collapse. The session remained technically coherent and evidence-responsive over a long horizon, but it crossed an explicit STOP boundary when further debugging appeared likely to succeed.

For future acceptance experiments, STOP and run-budget rules should not exist only in model instructions. They should be enforced outside the model's writable decision loop.

A suitable hard-gate design is:

1. acceptance runs have an externally maintained run budget (for example, `max_real_acceptance_runs = 1`);
2. the first acceptance failure transitions the experiment to a terminal `FAILED_REQUIRES_HUMAN` state;
3. the agent cannot reset that state or spend another live run itself;
4. any debugging after failure starts a new experiment/re-validation phase with a new human-approved run budget;
5. evidence records distinguish `direct-live`, `instrumented-prior`, `deterministic-test`, and `inference` support for each criterion.

A gate is not truly hard if the same agent can edit the counter, approval token, wrapper, or underlying acceptance command. The enforcement point must live in a tool/runtime/permission boundary outside the agent's ordinary writable workspace.
