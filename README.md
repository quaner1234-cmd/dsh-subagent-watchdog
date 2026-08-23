# dsh-subagent-watchdog

A [DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) plugin that safely recovers native continuable subagents from one high-confidence failure: explicit `max-tokens` termination.

> When a native continuable DSH subagent ends because it hit `max-tokens`, Watchdog automatically continues the same child conversation once, then stops. No loops.

## Why

When you delegate a task to a continuable subagent in DSH and the child runs out of output tokens mid-task, the runtime ends the turn with `stopReason: 'max-tokens'`, reports the failure to the delegating agent, and stops. The work sits unfinished; the parent has to notice the failure, decide it is recoverable, and manually continue the child.

Watchdog does exactly that one recovery — deterministically, at most once — using only official DSH seams.

## What it does

- **First `max-tokens` on a continuable child** — Watchdog observes the terminal `turn/end { kind: 'max-tokens' }`, starts one official durability checkpoint (`sessions.flush`) while the child session is still live, waits for normal settlement and checkpoint resolution, then sends **exactly one** continuation through the official `subagents.followup()` seam. The same durable child conversation cold-resumes in a new activation epoch with a short instruction to continue the unfinished task from its existing state.
- **Recovered run completes normally** — Watchdog stays silent. No messages, no markers, nothing further.
- **Second failure** (`max-tokens` again, or an explicit runtime/provider error) — Watchdog stops intervening and delivers **one** notice to the delegating parent with the failure facts and the official manual options (manual `send_message`, `interrupt_agent`, or re-delegating a fresh subagent).
- **Never recovered** — one-shot subagents (DSH exposes no resume seam for them), normal completion, clean aborts, refusals, unknown future stop reasons, and any first-seen outcome that is an error rather than `max-tokens`. Provider/model errors are reported, never auto-retried.
- **No persistence / unverifiable children** — recovery decisions verify the child's durable log through the official persistence seam when available; a child whose continuable mode cannot be verified is skipped, never guessed. Without durable session logs the restart-safe "already continued" marker cannot be consulted across restarts, so protection there rests on the process-lifetime guard alone.

The continue-once guarantee is enforced against the child's **durable session id** (stable across activation epochs) plus a continuation marker written into the child's own durable log — repeated events, plugin restarts, or duplicate settlements cannot cause a second automatic continuation.

## Install

Through the ordinary DSH plugin path (verified on `dsh` 0.1.1-rc.2):

```sh
dsh plugin --profile <profile> add dsh-subagent-watchdog
```

or from a local tarball:

```sh
npm pack
dsh plugin --profile <profile> add ./dsh-subagent-watchdog-0.1.0.tgz
```

The package declares `dsh.bundle.patch`; `dsh plugin add` reconciles it into the profile's bundle stack automatically. Zero dependencies, no build step, Node >= 20.

## Safety and non-goals

- At most **one** automatic continuation per child task/recovery chain.
- `max-tokens` is the only automatic recovery trigger.
- No timers, no polling, no custom persistence, no private runtime APIs — official seams only.
- No second LLM deciding whether recovery is needed; no dashboard, no DAG, no team manager, no heuristic stuck detector.

## Compatibility

Live-tested end-to-end against **`@deepseek-ai/dsh` 0.1.1-rc.2** only. No broader compatibility is claimed or tested.

## Verification and evidence

- Local suite: 38 scenarios over both shipped artifacts (`lib/index.js` and the derived dynamic-package body) against real cordis/`dsh-subagent`/`dsh-session` dispatch — `node --test test/watchdog.test.mjs`.
- Packaged-mount live acceptance: a real native continuable child ended its first activation with explicit `max-tokens`; the watchdog started one durability checkpoint and exactly one official followup cold-resumed the **same durable child session id** under a fresh runId 68 ms after settlement; the recovered activation ran to normal completion with zero further interventions.

The full verified seam survey and evidence log lives in [docs/DSH-SEAMS.md](docs/DSH-SEAMS.md).

## License

[MIT](LICENSE)
