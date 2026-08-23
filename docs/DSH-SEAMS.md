# DSH-SEAMS — verified runtime seams for `dsh-subagent-watchdog` v0.1

Status: findings document; §6 open items closed and §6a continue-once guard
verified against the installed runtime. v0.1 implemented
([../lib/index.js](../lib/index.js) + dynamic body
[../plugin/watchdog.host.js](../plugin/watchdog.host.js)) and acceptance-tested on
real cordis/dsh-subagent/dsh-session dispatch ([../test/watchdog.test.mjs](../test/watchdog.test.mjs)).
**§8 records the one live end-to-end recovery attempt: the guard logic matched the
harness exactly, but the official `followup()` seam rejected the continuation for a
reason the local harness cannot reproduce (lazy durable-log flush). v0.1 is live-blocked;
nothing was patched.**
**§9 records the post-§8 alternative-seam investigation: a synchronous live
`Agent.followup()` during `turn/end` dispatch was ruled out by installed-source chain
plus an instrumented live probe — the inbox splice is itself a session append, so the
runtime's reentrancy guard throws before anything is enqueued. The §8 blocker stands;
no product code was touched.**
**§10 records the `docs/NEXT.md` durability-checkpoint probe: one official
`ctx.sessions.flush(childSession)` started from the terminal `session/event`
observation, with the one official `subagents.followup()` deferred until after
settlement + checkpoint resolution, closed the §8 gap on a real cheap continuable
child — all six probe criteria passed (descriptor durable in the physical log,
cold resume accepted, same session id resumed in a second activation epoch). It also
surfaced a second, independent blocker for the sandboxed product code: the hand-rolled
never-abort signal stub is rejected by `AbortSignal.any` inside the cold-resume path.
v0.1 product code remains untouched; the checkpoint-before-followup redesign is now
evidence-backed.**
**§11 records the redesigned implementation: the product now runs
checkpoint-before-followup with a per-attempt real `AbortController` signal (stub
deleted), green over 38 scenarios on both artifacts; only the final live
max-tokens acceptance run remains before publish.**

Runtime under inspection: `@deepseek-ai/dsh` **0.1.1-rc.2** (the process serving this
session), running the **`standard`** agent preset (confirmed from this session's own
durable log header: `"agentPreset":"standard"`).

---

## 0. Method and its limits

The built-in **`cordis-plugin-development`** skill (shipped at
`config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md`) mandates:
query the real interface first, never infer an API from a name, and take provider
names/methods only from a current inspection result.

This session runs on the `standard` preset, which does **not** mount the
`cordis_inspect_*` model tools (only the `cordis` preset mounts `tool-cordis`).
The skill's methodology was therefore executed against the same sources of truth those
tools serve, plus live behavioral probes:

1. **Generated API catalog** — `@deepseek-ai/dsh-tool-cordis/lib/index.js` embeds
   `SERVICE_API` / `EVENT_API` / `TYPE_API`, produced by the same AST walk as the
   catalog that `cordis_inspect_list` / `cordis_inspect_query` serve for this exact
   version ("Produced by the same AST walk as docs/cordis-catalog, so this data and the
   rendered docs cannot diverge"). All event/service signatures quoted below come from
   there or from the shipped `.d.ts` type surfaces of the same installed packages.
2. **Installed implementation source** — compiled `lib/*.js` + `lib/types/*.d.ts` of the
   exact packages loaded by this process (`dsh-subagent`, `dsh-subagent-in-process-driver`,
   `dsh-subagent-spawn-in-process`, `dsh-tool-subagent`, `dsh-tool-subagent-control`,
   `dsh-tool-subagent-report`, `dsh-agent-loop`, `dsh-session`, `dsh-llm`,
   `dsh-llm-retry`, `dsh-jobs`).
3. **Live probes through official tools only**:
   - started one continuable background child via the `subagent` tool
     (id `d2dfbdee-4476-42a0-9c97-2aef2261f000`);
   - received its settlement notices verbatim in-conversation, twice (after natural
     completion and after a cold-resumed second turn);
   - observed `list_agents` reporting it `[ready]`;
   - delivered a follow-up to the settled child via `send_message` (accepted; the child
     cold-resumed and answered again);
   - read the persisted artifacts: the child session directory under
     `~/.dsh/sessions/<workspace>/` with durable header fields, and
     `~/.dsh/storages/session_projcache.json` with the folded `subagent` projection row.

Not directly observable from this preset: a raw `cordis_inspect_list` dump and the
child's flushed JSONL *events* (this deployment flushes event payloads lazily; the
child directory contained the validated header immediately and projection rows in the
projection cache). Event-level structures are cited from the installed code and the
generated catalog instead. No undocumented API is used or assumed anywhere in this
document; anything that could not be verified is listed in §8.

---

## 1. Where the runtime keeps subagents (composition map)

Two planes (per the `standard`/`cordis` preset composition comments):

- **Host plane**: the `subagents` registry service itself (`ctx.subagents`,
  `SubagentRuntime` from `@deepseek-ai/dsh-subagent`), its providers
  (`spawn` / `fork` via `dsh-subagent-spawn-in-process` / `-fork-in-process`),
  the continuable manager (`SubagentContinuationManager`), sessions store,
  persistence, jobs registry, LLM route/retry.
- **Agent-preset plane** (what one session contributes): the model-facing tools —
  `subagent` / `subagent_fork` (`tool-subagent`, configured `backgroundMode: continuable`
  in both `standard` and `cordis` presets), `send_message` / `interrupt_agent`
  (`tool-subagent-control`), `list_agents` (`…/list-agents`), `report`
  (`tool-subagent-report`, installed into continuable children only).

A watchdog plugin belongs on the **host plane**: every seam it needs
(`subagent/*` events, `session/event`, `ctx.subagents`, `ctx.agents`, `ctx.sessions`)
lives there, and host-plane listeners observe delegations made by any session.

---

## 2. Seam catalog (verified)

### 2.1 Service `subagents` (`SubagentRuntime`)

| Member | Signature (condensed) | Notes |
| --- | --- | --- |
| `start` | `start(name, request: SubagentStartRequest): Promise<SubagentRun>` | ONE-SHOT only. Fulfillment = publication boundary; later failures settle through `run.result`. |
| `startContinuable` | `(spec: ContinuableStartSpec): Promise<ContinuableStart>` | Durable child id + accepted initial prompt message id. Continuable children never become a `SubagentRun`. |
| `followup` | `(parent: Agent, childId, content, options): Promise<MessageId>` | Continuable only. Resident → enqueue/wake; absent → **cold resume** from persisted Session. Parent authority required. |
| `interrupt` | `(targetSessionId, authority): void` | Continuable only. Fire-and-return cancel with `{keepInbox:true}` semantics. Absent target (incl. one-shot ids) = accepted no-op. Throws `SubagentError('UNAUTHORIZED')` on wrong authority. |
| `reportFrom` | `(child: Agent, content, options): Promise<MessageId>` | Child→its durable direct parent. The child object is the credential. |
| `registerContinuableSetup` | `(contribution): () => disposer` | Compose a capability into every continuable child's creation context (this is how `report` gets installed). |
| `listChildren` / `listDescendants` | `(parentSessionId \| rootSessionId, signal?): Promise<SubagentListEntry[]>` | Live-store + persistence merge, no Agent loading. Entries: `mode: 'one-shot' \| 'continuable'`, `activity: 'running' \| 'inactive'`, `hasChildren`, diagnostics. |
| `drainContinuableChildren` / `drainContinuableDescendants` | teardown APIs | Host-teardown oriented; not parent recovery actions. |

### 2.2 Events (all `mode: emit` unless noted)

| Event | Payload | Fired when |
| --- | --- | --- |
| `subagent/start` | `SubagentRunInfo { runId, provider, id (child SessionId), local }` | Provider published a child; also once per continuable Activation epoch (fresh create, wake, or cold resume). Scope-filtered dispatch keys the carrier by the **delegating parent**, so a root/host listener sees all pairs; agent-scoped listeners see only their own delegations. For in-process children `ctx.agents.get(info.id)` resolves during the notification. |
| `subagent/end` | `SubagentRunEndInfo { …identity, stopReason: SubagentStopReason, lastAssistantMessage? }` | Run settled / Activation epoch ended. Pairwise with `start` by `runId`. A run whose result promise *rejects* (infrastructure fault) emits `stopReason:'error'`. |
| `subagent/provider-added` / `-removed` | `SubagentProvider` / `string` | Registry membership. Tool instances mount/unmount on these. |
| `agent/request-error` | waterfall `{ agent, turn, step, provider, failure: LlmFailure, retryPolicy, signal }` | **Every failed model-request attempt**, before the loop retries or closes the step. A listener may return `{kind:'retry'}` to own recovery; default leaves it terminal. This is the earliest structured provider-error seam. |
| `agent/error` | `{ agent, turn, step, error: unknown }` | Step/turn errored; failure verbatim. |
| `session/event` | `(session, event: SessionEvent)` | Post-commit append feed for **every session**, including child sessions — carries each child's durable `turn/end` record. |
| `agent/status`, `agent/created`, `agent/disposed` | status transitions / lifecycle | Supporting signals (`running ⇄ idle`). |
| `agent-loop/config-start-failed` | `{ sessionId, error }` | Declarative agent failed before publication. |
| `llm/adapters-updated` | payload-free | Provider topology changed. |

### 2.3 Durable records (what survives restart)

- **`SessionHeader`** (verified live on the probe child):
  `parentSession` (= my session id), `origin: 'subagent'`, `delegationDepth: 1`,
  `cwd`, `createdAt`, `agentPreset`. This is the durable parent/child edge;
  `listChildren/listDescendants` are built on it.
- **`subagent/descriptor` session event** (v2, model-hidden, turn-enclosed in the
  child's first turn, survives compaction): `{ version, mode: 'one-shot'|'continuable',
  provider, label?, agentProvider?, agentModel?, persona?, toolFilter? }`.
  Single classification authority for "what kind of child is this".
- **Projection units** (verified live in `session_projcache.json`):
  `subagent` → `{ mode:'continuable', label, seq }`; `subagentTiming` → settled/open-turn
  durations. Served through the three-rung ladder (watermark → projection cache →
  persistence inspection).
- **`turn/end` session event** — `{ turn, reason: TurnEndReason }` where:

  ```ts
  TurnEndReasonMap = {
    completed: {kind:'completed'},
    aborted:   {kind:'aborted', reason: TurnEndCancelCause}, // user|parent|hook|disposed|legacy
    blocked:   {kind:'blocked'},
    error:     {kind:'error', error: LlmFailure | {message, code:'UNKNOWN'}},
    'max-tokens': {kind:'max-tokens'},
    interrupted: {kind:'interrupted'},   // crash-orphan marker written by persistence, never by the loop
  }
  ```

- **`LlmFailure`** (provider-neutral, serializable):
  `{ message, code, status?, providerRetryAfterMs?, requestId? }`.
- **Durable retry events** (`dsh-llm-retry`): `llm/retry` (`{retryId, turn, step,
  provider, mode:'normal'|'always', policyKey, retry, maxRetries?, delayMs, failure}`)
  and `llm/retry-started`. Retry policy itself is **provider-owned**
  (`ResolvedRetryPolicy = normal(bounded, retryableCodes, backoff) | always`),
  executed by the optional `dsh-llm-retry` plugin.

### 2.4 Terminal vocabulary mapping (where `stopReason` comes from)

Verified chain, one-shot in-process children (`dsh-subagent-in-process-driver`):

```
adapter finish "length"            → FinishReason {kind:'max-tokens'}      (both llm adapters)
step ends                          → stepEnd {kind:'max-tokens'}
turn close                         → sticky: once ANY step hit max-tokens, the turn ends 'max-tokens'
                                     even if a later step completed  (dsh-agent-loop)
child session                      → durable turn/end event
driver readResult()                → SubagentResult.stopReason via toStopReason():
                                       completed→completed, max-tokens→max-tokens,
                                       aborted→aborted, blocked→refusal, else→error
subagent/end event                 → same stopReason (+ lastAssistantMessage)
foreground tool                    → isError tool-result text:
                                       "subagent run hit its token limit before finishing"
                                       / "subagent run failed" / "subagent declined the task"
                                       / "subagent run was cancelled"
background job (one-shot)          → JobOutcome {status:'failed', detail:"max-tokens(; diagnostic)"}
continuable epoch                  → epochStopReason(child log suffix): max-tokens→max-tokens,
                                       aborted|interrupted→aborted, error→error, blocked→refusal;
                                       recorded failure wins over cancellation
parent notice (continuable)        → user-role message, source {kind:'subagent-settled', form:'notice'}:
                                       completed → "Background subagent <id> finished and will do no further work unless you send it more."
                                       max-tokens → "Background subagent <id> ran out of room before it finished."
                                       error      → "Background subagent <id> failed before it finished."
                                       aborted    → "Background subagent <id> was stopped before it finished."
                                       refusal    → "Background subagent <id> declined the task."
                                     delivery: parent.followup if idle, parent.steer if running,
                                     parent.inject if the parent's lineage is closing.
```

All five summary strings and both probe notices were matched verbatim
(`finished…` for the natural completion, again after `send_message` cold-resume).

### 2.5 Model-facing control tools (verified implementations)

- `send_message(subagent_id, message)` → `ctx.subagents.followup(parent, id, [text],
  {source:{kind:'coordinator',form:'relay',senderSessionId}})` — continuable children
  only. Accepted for `ready` (cold resume), `idle`, and `running` (queued FIFO) children.
- `interrupt_agent(agent_id)` → `ctx.subagents.interrupt(id, {kind:'ancestor', agent})` —
  direct children **and deeper descendants**; no-op for finished/one-shot ids.
- `list_agents({scope:'children'|'descendants'})` → projects **continuable children only**
  (one-shot rows deliberately omitted: they cannot be continued), status
  `running | idle | ready` from the live registry, `parent`+`depth` for descendants.
- `report(content)` — installed into continuable children only
  (`registerContinuableSetup`); delivers to the durable direct parent
  (`delivery: 'next-step' wakes the parent | 'quiet' parks it`).
- Background one-shot tasks surface through `jobs` (`job_output` / `job_kill`):
  terminal `JobOutcome {status:'completed'|'killed'|'failed', detail?, output?}`.

---

## 3. Answers to the five questions

### Q1 — Which events/services expose start, end, terminal reason, parent/child, result?

- **Start**: `subagent/start` (one-shot publication and every continuable epoch).
- **End**: `subagent/end`, paired by `runId`, carrying `stopReason`.
- **Terminal reason**: `SubagentRunEndInfo.stopReason` (event), `SubagentResult.stopReason`
  (run), durable `turn/end.reason` (child log), `JobOutcome.status/detail` (background
  one-shot task), `settlementSummary` wording (continuable parent notice).
- **Parent/child**: durable `SessionHeader.parentSession` + `origin:'subagent'` +
  `delegationDepth`; runtime-side `ctx.agents.get(id)` during `subagent/start`;
  enumeration via `ctx.subagents.listChildren/listDescendants`.
- **Result delivery**: foreground tool output / `isError` tool result (one-shot),
  `JobOutcome.output` (background one-shot), automatic `subagent-settled` notice +
  optional child `report` messages (continuable).

### Q2 — Is max-token termination distinguishable from normal completion?

**Yes, unambiguously, at every layer.** `'max-tokens'` is a distinct variant in
`FinishReasonMap`, `TurnEndReasonMap`, `SubagentStopReasonMap`, and it is *sticky* for
the turn ("At least one step reached its output-token ceiling, even if a plugin
continued the turn"). It maps to `failed/max-tokens` job outcome detail and to the
distinct parent notice "ran out of room before it finished."

Caveats a watchdog must respect:

- The in-process spawn/fork drivers populate **no `diagnostic`** on the result today;
  the ≤4096-byte `diagnostic` field exists in the seam contract but is only filled by
  providers that collect one (e.g., the out-of-process path via `settleRunResult`).
  Do not promise diagnostic text for spawn/fork children.
- `subagent/end` does **not** carry the child's `LlmFailure`. If structural failure
  facts are wanted for `stopReason:'error'`, fold them from the child's own
  `turn/end` event (via `session/event` or `ctx.sessions`) — see v0.1 design.

### Q3 — Are provider/runtime errors exposed structurally?

**Yes, at three layers**, all verified:

1. **Per request attempt**: `agent/request-error` waterfall with
   `failure: LlmFailure {message, code, status?, providerRetryAfterMs?, requestId?}`
   and the resolved `retryPolicy`; a listener may claim recovery with `{kind:'retry'}`.
   When `dsh-llm-retry` is mounted, each scheduled retry is durably recorded as
   `llm/retry` before its cancellable wait.
2. **Turn terminal**: durable `turn/end` with `{kind:'error', error: LlmFailure}`
   ("the `LlmError` facts verbatim"), flattened to
   `{message: errorChain(error), code:'UNKNOWN'}` for non-LLM errors.
3. **Seam terminal**: `stopReason:'error'` on `subagent/end` and in the run result
   (including infrastructure rejections of the result promise), plus optional
   `diagnostic`, `JobOutcome {status:'failed', detail}`, and the parent notice
   "failed before it finished."

`code` is a stable provider-neutral machine-routing string — the right join key for
high-confidence classification (auth/quota/rate-limit vs transport vs unknown).

### Q4 — Which official APIs can safely continue / retry / interrupt / message a child?

| Action | API | One-shot | Continuable |
| --- | --- | --- | --- |
| Continue conversation | `send_message` → `subagents.followup()` (cold-resumes absent children) | ✗ (no handle after settle; not listed by `list_agents` by design) | ✓ |
| Interrupt current turn | `interrupt_agent` → `subagents.interrupt()` (ancestor authority; queued work preserved) | accepted **no-op** | ✓ (live targets) |
| Message a deeper descendant | `interrupt_agent` yes; `send_message` depth-1 only | – | partial |
| Child → parent mid-run | `report` tool / `subagents.reportFrom` | ✗ (never registered) | ✓ |
| Cancel remaining work | `SubagentRun.dispose()` (caller-owned), `job_kill` (background one-shot Task), signal abort | ✓ | via drain/teardown APIs (host-owned) |
| Request-level recovery | `agent/request-error` waterfall returning `{kind:'retry'}` | ✓ (any agent incl. children) | ✓ |
| Whole-run retry | none — re-delegate a fresh `subagent` call from the parent | ✓ (new child) | ✓ (new child) |

There is **no** API to raise a child's token budget mid-flight, to resume a one-shot
child, or to rewrite a settled turn. Any "recovery" beyond the table would be custom
orchestration, which v0.1 excludes.

### Q5 — One-shot vs continuable support matrix

See the table in Q4 plus: `subagent/start|end` fire for **both** shapes (continuable =
once per Activation epoch); `startContinuable` requires a provider with
`prepareContinuable` (spawn/fork have it); Jobs/Task machinery applies **only** to
one-shot background; settlement notices apply **only** to continuable; `outputSchema`
is a per-activation contract and deliberately excluded from the continuable descriptor.

---

## 4. Known gaps / cautions found while verifying

- `list_agents` hides one-shot children (deliberate). A watchdog must not rely on it
  for one-shot discovery; use `subagent/start|end` pairs or `listChildren`.
- Event dispatch for `subagent/start|end` is scope-keyed by the delegating parent;
  listener placement decides visibility. Mount the watchdog listener where the
  `subagents` service can reach it (root/host context) to see all sessions.
- JSONL event flushing is lazy in this deployment (header appears immediately; events
  follow checkpoint policy). Real-time detection must be event-driven, never log-tail.
- Dynamic Cordis plugins are temporary and process-local (skill, §Settings pages);
  persistence of watchdog state must not be assumed across restarts for v0.1.

---

## 5. Proposed minimal v0.1 implementation (no code yet)

**Form**: one dynamic Cordis **host-plane plugin** authored through the
`cordis-plugin-development` workflow (`cordis_define` → approval → `cordis_run`),
packaged later as a composition row for distribution. No client half, no UI, no slots.

**Inputs (listeners, all registered inside `apply(ctx)` so Cordis owns disposal):**

1. `subagent/start` / `subagent/end` — build run records keyed by `info.runId`
   (scalars only: `id`, `provider`, `local`, timestamps).
2. `session/event` filtered to `type === 'turn/end'` for child session ids seen in
   `start` — captures the **structured** `reason` (`LlmFailure` for errors,
   `max-tokens`, abort causes) exactly once, post-commit.
3. Nothing else. No timers needed for detection (edge-driven).

**Classification (high-confidence only, per v0.1 goal):**

| Detection | Source of truth | Confidence basis |
| --- | --- | --- |
| Max-token termination | `subagent/end.stopReason === 'max-tokens'` corroborated by the child's last `turn/end.kind` | distinct enum variant end-to-end |
| Explicit model/provider/runtime error | `stopReason === 'error'` + folded `turn/end.error` (`LlmFailure.code/status/message`) | structured failure facts |
| Infrastructure rejection | `subagent/end` emitted with `stopReason:'error'` from a rejected result promise | seam contract |
| Declined task | `stopReason === 'refusal'` | distinct enum variant |

Normal completion, clean aborts, and unknown future variants (merge-extensible enums!)
are **not** reported — consumers branch on known cases and fall through `default`.

**Notification to parent (official channels only):**

- Continuable children: the runtime already delivers the `subagent-settled` notice.
  v0.1 stays **silent** unless it has additive facts (it does: the structured
  `LlmFailure` code and the suggested official next action). Delivery mirrors the
  runtime's own `notifySettlement` pattern — `parent.followup` when idle,
  `steer` when running — as a single short user-role context tagged `[watchdog]`,
  e.g.: *"child `<id>` ended: max-tokens. Official options: send_message to continue
  in the same conversation; interrupt_agent to stop a running turn."*
- One-shot children: deliver the same shape to the parent agent resolved via
  `ctx.agents.get(parentSessionId)`; recommend re-delegation for `max-tokens` /
  `error` since one-shot runs cannot be resumed.
- Message construction follows the internal-live-data rules: extract scalars, never
  stringify payloads, cap text (≤4096 bytes like the seam's own `diagnostic`).

**Explicitly out of scope (v0.1 non-goals, matching the project brief):** dashboards,
team management, DAGs, stuck-detection heuristics, custom orchestration, auto-retry,
auto-interrupt, auto-redelegate. v0.1 notifies; it never acts on a child by itself.

---

## 6. Open items — CLOSED at implementation time (verified against the installed runtime)

All four items were closed by source inspection of the exact packages loaded by
this deployment's process (`@deepseek-ai/dsh` **0.1.1-rc.2**), using §0's method.

1. **Listener visibility for a root-mounted dynamic plugin on `subagent/start|end`
   — CONFIRMED: a root-mounted dynamic plugin sees every pair.**
   `DynamicCordisRunnerService` is a host-plane Service (`this.rootCtx = ctx`);
   `requireGroup()` mounts the `cordis-dynamic` group under that root context and
   `startHostHalf()` mounts every dynamic host half as its child
   (`dsh-cordis-host-runner/lib/index.js`). Root/host contexts carry no scope tag,
   and `scopeTarget()`'s carrier filter "admits untagged listeners globally"
   (`dsh-scope/lib/index.js`); cordis core `dispatch()` keeps a listener when
   `hook.global || !filter || filter.call(thisArg, hook.ctx)`. Listener callbacks
   receive `(info)` only — the carrier is the dispatch `thisArg`.
2. **Notice source kind — dedicated merge-extensible kinds are safe.**
   The client conversation UI classifies any non-`user` source as a generic context
   row; its `contextProvenance()` switch renders unknown kinds as
   `{role:'inject', label:<kind>}` (never dropped), and `'notice'`/`'relay'` are
   known forms (`dsh-client-runtime/lib/client.js`). v0.1 therefore tags
   continuations `{kind:'subagent-watchdog', form:'relay'}` and parent notices
   `{kind:'subagent-watchdog', form:'notice'}`.
3. **`dsh-llm-retry` IS mounted in production host compositions.**
   `@deepseek-ai/dsh-base/cordis.patch.yml` inserts row `llm-retry →
   '@deepseek-ai/dsh-llm-retry'` unconditionally ("the shared core of every dsh
   profile"); neither the web-app bundle patch nor this deployment's profile patch
   touches it. A durable `turn/end {kind:'error'}` is therefore post-retry-
   exhaustion or non-retryable — high-confidence terminal.
4. **Cold-resume ordering is safe: `subagent/start` strictly precedes the resumed
   turn's events.** `followup()` on an absent child → `coldResume()` →
   `materializeTracked()`: `agents.resume()` restores without running a turn, then
   `observer.start(handle.agent)` emits synchronously, and only afterwards does
   `submitMaterialized()` accept the prompt; `session/event` dispatch happens
   synchronously inside `Session.append()`. Residual race (child events appended in
   the provider's start window) is covered by lazy admission of unknown
   `origin:'subagent'` sessions in the plugin's `session/event` listener.

Additional implementation-time verifications feeding the guard design:

5. **`followup` options flow**: `SubagentContinuationManager.followup(parent,
   childId, content, options)` forwards `options.source` verbatim into
   `createUserMessage({content, source})` and requires a signal with
   `throwIfAborted` (`options.signal`); the persistence layer consumes only
   `aborted` / `throwIfAborted` / `addEventListener('abort')` /
   `removeEventListener` from it.
6. **Dynamic-package sandbox constraints** (`dsh-cordis-host-runner`):
   globals are `ctx`, `harness`, `console`, `btoa`, `atob`, `TextEncoder`,
   `TextDecoder` + ECMAScript intrinsics; timers/`require`/`fetch` are traps and
   **there is no `AbortController`**; `ctx.get(name)` works undeclared and returns
   services whose methods forward to the real instance (non-Context return values
   pass through, so live Agents/Sessions are reachable). Property access outside
   the whitelist throws, so the plugin logs through `console` only.
7. **Settlement ordering**: the manager deletes the Activation, releases ownership
   and delivers its own settlement notice BEFORE `observer.settle()` emits
   `subagent/end` — so a watchdog continuation initiated from the end event always
   cold-resumes (or queues behind disposal) exactly like the verified
   `send_message`-to-ready-child path, and never races admission state.

## 6a. v0.1 continue-once guard (verified)

The blocking question from `docs/NEXT.md`: *what is the smallest reliable
identity/guard answering "has this child task/recovery chain already received its
one watchdog continuation?"*

**Answer: guard key = the child's durable session id; guard state = (a)
process-lifetime sets in the plugin plus (b) the child's own durable session log.**

- **Identity.** Each activation epoch mints a fresh `runId`
  (`randomUUID()` in `observeRun` / per-epoch observers), so runId cannot key the
  guard. The child session id is stable across epochs, cold resumes, and restarts
  (it names the persisted log) — it is the chain identity.
- **Process-lifetime layer.** One scalar state map plus one set inside the plugin
  instance (revised after the duplicate-end review finding in `docs/NEXT.md`):
  - `chains` (`'pending' | 'delivered'`) — `'pending'` is entered SYNCHRONOUSLY in
    the `subagent/end` handler before any async work, so duplicate deliveries,
    repeated settlements, or sibling events can never initiate two continuations
    (single-threaded handlers make this atomic). End events observed while
    `'pending'` are duplicates of the original settlement epoch: they neither
    continue nor notify. The state flips to `'delivered'` only when the one
    `followup()` attempt has been made (including its marked failure) or a prior
    delivery was proven from the durable log; from `'delivered'`, a genuinely
    later failing activation notifies once. The entry is deleted — releasing the
    chain — only when recovery was never actually spent (unverifiable mode, no
    live parent), because then no budget was consumed.
  - `notified` — caps the "recovery failed" parent notice at one per chain per
    process; combined with `'delivered'` this makes the third phase (recovery
    failed again → notify once) unreachable for duplicate original-end events.
- **Restart-safe layer (official durable seams only).**
  - The continuation itself is delivered via `subagents.followup(...,
    {source:{kind:'subagent-watchdog', form:'relay', …}})`; `options.source`
    becomes the delivered message's source verbatim
    (`createUserMessage({content, source})`), and an accepted inbox message is
    appended to the child's session as a `user/message` event — i.e. **the marker
    IS a durable session event of the child's own official log**, written by the
    runtime, not by us.
  - Before initiating a continuation, the plugin reads the child's log through the
    official `sessionPersistence.inspect(childId, signal?)` seam (live-preferred;
    the same seam `coldResume` uses to classify restored children). If any event
    matches `type === 'user/message' && data.source.kind === 'subagent-watchdog'`,
    recovery is skipped and the still-failing chain notifies the parent once.
    This also supplies durable mode classification after remount (the restored
    descriptor never replays through `session/event`).
  - No custom storage, no projection writes, no settings writes.
- **Fail-closed behavior.** Unverifiable mode (no descriptor live or durable) →
  no recovery, silent. One-shot mode → never recovered (no official resume seam).
  Errors as first observed outcome → never recovered (runtime settlement notice
  already informs continuable parents). Parent not live → skip (warn only).
- **Documented limitation.** A crash between followup acceptance and the message
  becoming durable loses the marker. In that window the child never received the
  first continuation, so a later attempt still leaves "at most one RECEIVED
  continuation per chain" intact — the guarantee is stated about received
  continuations, not attempts.

## 7. Evidence index (primary sources quoted in this doc)

- Generated catalog: `node_modules/@deepseek-ai/dsh-tool-cordis/lib/index.js`
  (`SERVICE_API` key `subagents`; `EVENT_API` entries `subagent/start`, `subagent/end`,
  `agent/request-error`, `session/event`, `agent/error`, `agent/status`).
- Types: `dsh-subagent/lib/types/{index,types,continuation,lifecycle,list-children,
  descriptor,error}.d.ts`; `dsh-session/lib/types/types.d.ts` (`TurnEndReasonMap`,
  `SessionHeader`); `dsh-llm/lib/types/{types,retry-policy,index}.d.ts`
  (`LlmFailure`, `FinishReasonMap`, `ResolvedRetryPolicy`); `dsh-jobs/lib/types/types.d.ts`
  (`JobOutcome`); `dsh-tool-subagent/lib/types/index.d.ts` (Config/backgroundMode).
- Implementations: `dsh-subagent/lib/index.js` (`observeRun`, `createActivationObserver`,
  `epochStopReason`, `settlementSummary`, `notifySettlement`, `settleRunResult`,
  `runOutcome`); `dsh-agent-loop/lib/index.js` (sticky `max-tokens`, `agent/request-error`
  waterfall, `turn/end` append); `dsh-subagent-in-process-driver/lib/index.js`
  (`toStopReason`, `readResult`); `dsh-tool-subagent/lib/index.js`
  (`stopReasonError`, `withDiagnosticAndPartialText`, background/continuable routes);
  `dsh-tool-subagent-control/lib/{index.js,types/list-agents.js}`;
  `dsh-tool-subagent-report/lib/index.js`.
- Skill: `dsh/config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md`;
  presets: `…/standard/agent.cordis.yml`, `…/cordis/agent.cordis.yml`.
- Live probes (this session): continuable child `d2dfbdee-4476-42a0-9c97-2aef2261f000`
  — two verbatim settlement notices; `list_agents` → `[ready]`; `send_message`
  cold-resume accepted and answered; child session header showing `parentSession`,
  `origin:'subagent'`, `delegationDepth:1`; projection-cache row
  `{"mode":"continuable","label":"Echo one word for seam test","seq":0}`.

## 8. Live end-to-end recovery attempt — DISCREPANCY (v0.1 live-blocked, not patched)

Executed 2026-08-23 on the `cordis`-preset host serving this session
(`@deepseek-ai/dsh` **0.1.1-rc.2**, same version as §0). The dynamic package was
defined byte-faithfully from [../plugin/watchdog.host.js](../plugin/watchdog.host.js)
(`watch-1/pkg-1`, run `run-1`, host half running, no client half) after
`cordis_inspect_list/query` re-confirmed every seam of §2 against the live host:
`subagents.followup(parent, childId, content, options) → Promise<MessageId>`,
`sessionPersistence.inspect(id, signal?) → Promise<SessionInspection>`,
`agents.get(id)`, emit-mode `subagent/start|end` with `SubagentRunInfo/EndInfo`,
emit-mode `session/event(session, event)`, and the dynamic-host builtin set
(`ctx/harness/console/btoa/atob/TextEncoder/TextDecoder`, **no `AbortController`**
— exactly what the artifact's `neverAbortSignal()` fallback anticipates).

### 8.1 Probe

One genuine native continuable child spawned via the official `subagent` tool:

- child id `3fc27f70-3912-4ad9-a95c-a18f5dd53638`, parent = this session
  (`session-6a77ae90-20a8-4567-9afb-0ae823468d05`);
- task: enumerate positive integers spelled out in English words until physically
  unable to continue — designed to hit the output-token ceiling;
- it decoded exactly **32,768 output tokens in one turn** (`sessionStats` row in
  `~/.dsh/storages/session_projcache.json`) and settled with the runtime's own
  verbatim §2.4 notice: *"ran out of room before it finished."*

### 8.2 What matched the tested harness exactly

1. Detection: the plugin's `subagent/end` listener fired on the real max-tokens
   settlement; the live descriptor fold had classified the child continuable.
2. Guard sequencing: chain entered `'pending'` synchronously; durable verification
   ran off-thread; the one-shot budget was spent mark-before-act on the failed
   attempt (AC10 path); no retry, no loop, no second notice.
3. Parent notification: exactly ONE `[watchdog]` parent notice, delivered through
   the official `parent.followup(message)` channel while this agent was idle,
   with the exact `buildRecoveryFailedNotice({outcome:'delivery-failed'})` wording:
   > `[watchdog] Subagent 3fc27f70-3912-4ad9-a95c-a18f5dd53638 ended with max-tokens; its one automatic continuation could not be delivered (max-tokens). No further automatic recovery will be attempted. …`
4. Containment: every warn() stayed inside its try/catch; no listener exception escaped.
5. Runtime settlement wording matched §2.4 verbatim.

So: **the entire v0.1 state machine behaved as acceptance-tested.** What failed is
one step further down: the official seam rejected the continuation itself.

### 8.3 The divergence

`subagents.followup(parent, childId, content, options)` **threw** for the freshly
settled child. The child never received any message (`list_agents` stayed
`[ready]`; no second activation epoch; no second settlement notice), so the v0.1
product outcome "child automatically continued once" did NOT occur.

Root cause, pinned by direct artifact evidence plus installed source reading
(method of §0):

1. At settlement the manager deletes the Activation and releases ownership before
   emitting `subagent/end` (§6 item 7) — so a watchdog-initiated continuation must
   go through `coldResume`.
2. `SubagentContinuationManager.followup` → activation absent → `coldResume`
   (`dsh-subagent/lib/index.js` ~L862): `persistence.inspect(childId)` →
   `authorizeLineage` → `foldSubagentDescriptor(loaded.events.slice(seedLength))`;
   if no descriptor folds, it throws `SubagentError(…, 'NOT_RESUMABLE')`:
   *"subagent … has no supported continuation state and cannot be resumed."*
3. `PersistenceCoordinator.inspect` is live-preferred
   (`dsh-session-persistence/lib/index.js` ~L897: `const live = this.ctx.sessions.get(id);
   if (live !== void 0) return this.inspectLive(live)`), but the settled child's
   Session is no longer live-published — so inspect reads the PHYSICAL log.
4. The physical log provably lags: decompressing
   `~/.dsh/sessions/--Users-jinronghuan-Desktop-vibe~0020coding-dsh-subagent-watchdog--/3fc27f70-…/session.jsonl.zstd`
   yields **only the validated header line**, immediately after settlement AND
   again minutes later (mtime 2026-08-23T05:33:36Z, still 1 line). This
   deployment flushes events lazily per checkpoint policy (§0/§4 already noted
   lazy flushing; here it is unbounded on the observed timescale).
5. Therefore `loaded.events` contained no `subagent/descriptor` at followup time,
   `foldSubagentDescriptor` returned `undefined`, and cold-resume rejected the
   delivery — while the SAME descriptor fact WAS visible through the live
   `session/event` stream and in the projection cache
   (`{"identity":{"mode":"continuable","label":"Mechanical enumeration stress child","seq":0}}`,
   `descriptorSeen: true`). The plugin correctly proceeded because its guard
   accepts live OR durable mode evidence (`durable.mode !== 'continuable' && mode !== 'continuable'`),
   but the seam itself only accepts DURABLE evidence.

The local harness cannot catch this: its persistence stand-in serves all events
synchronously, so `followup` always sees the descriptor. §6 item 4's ordering
analysis ("cold-resume ordering is safe") verified event ORDERING but assumed the
durable log was query-complete at decision time; the deployment's flush policy
breaks that assumption for the watchdog's specific timing (seconds after settlement).
The earlier successful probe (`send_message` to a ready child, §0) worked because
minutes had passed and that child's events had been flushed.

### 8.4 Observability gap found alongside

The exact thrown error text is unreachable from every channel available to the
plugin and this session: the sandboxed `warn()` logs via `console.warn`, but
`Builtin.listBuiltins` documents only `console.log`/`console.error` for the
dynamic host realm, and no file under `~/.dsh` carries the plugin tag. Either
`console.warn` is outside the sandbox whitelist (its throw would be swallowed by
the containment catch) or its output has no reachable sink. Diagnostics of any
future seam rejection will need an explicit sink decision (e.g. route through
`console.error`) — recorded here as a finding, not changed.

### 8.5 Consequences and open questions

- v0.1's core promise ("automatically continue once") is **not achievable as
  coded** on this deployment for freshly settled children: the recovery window
  closes before the child's durable log can satisfy `coldResume`'s classification
  requirement. The guard/notice machinery around it works end-to-end.
- Open question A: even MANUAL recovery hits the same wall while the log is
  unflushed — `send_message` to this very child should fail with `NOT_RESUMABLE`
  until a checkpoint flushes events (untested at write time; child left untouched).
- Open question B: what legitimately closes the gap without violating v0.1's
  boundaries — waiting/re-checking durability (needs a timer, currently excluded),
  a runtime-side flush hook, or relaxing the product contract. That is a product
  decision for AGENTS.md/NEXT.md, deliberately not made by patching code here.
- Plugin state at documentation time: `watch-1/pkg-1` still running (run-1);
  probe child untouched (`[ready]`, never received anything); no repo source
  file was modified for this test.

---

## 9. Alternative live seam investigated: synchronous `Agent.followup()` during `turn/end` — RULED OUT

Question asked (post-§8, product code explicitly frozen): while a native continuable
child Agent is still registered, can ONE ordinary follow-up enqueued through the public
live `Agent.followup()` API synchronously during the `session/event` dispatch of
`turn/end {kind:'max-tokens'}` — i.e., before the agent loop performs its post-turn
`inbox.hasPending` check — keep the same Activation alive and start its next turn
without reaching `coldResume`/persistence?

### 9.1 Source chain (installed `@deepseek-ai/dsh` 0.1.1-rc.2)

- Loop tail (`dsh-agent-loop/lib/index.js` ~L592→600): inside `finally`,
  `this.session.append("turn/end", …)`; immediately after the `finally`,
  `if (!this.inbox.hasPending) return false;` — same activation continues only if
  the check sees pending input.
- `Inbox.hasPending` counts BOTH queues (`dsh-agent/lib/index.js` L40–42:
  `nextTurn.length > 0 || nextStep.length > 0`), so a `"next-turn"` splice WOULD
  satisfy it — inbox semantics are not the obstacle.
- `Agent.followup(input)` (`dsh-agent-loop/lib/index.js` L396) delegates to the inbox
  splice path. `Inbox.mutate()` FIRST publishes
  `this.session.append("agent/inbox/spliced", splice)` (`dsh-agent/lib/index.js` L148)
  and only THEN mutates the real array (L149) — **the enqueue is itself a session append**.
- `Session.append()` rejects reentrancy while another append is being published
  (`dsh-session/lib/index.js` L1456):
  `if (entry?.appending) throw new Error("session append cannot reenter while another append is being published")`.
- Emission to root listeners is synchronous: `append()` collects listeners via
  `ctx.events.dispatch("emit", …)` and invokes them inline before returning
  (`dsh-session/lib/index.js` L1471–1476), with per-listener error containment into
  an unreachable logger (§8.4).

Together these predict: any `followup()` executed from inside the `turn/end` dispatch
attempts a nested append while `entry.appending === true`, throws at L1456 BEFORE the
array mutation (line order in `mutate()` makes the failure atomic), and leaves the
inbox empty for the post-turn check.

### 9.2 Live verification (disposable probe — honest iteration log)

Disposable dynamic plugin `maxtokens-probe` (plugin id `probe-2`): a root-level
`ctx.on('session/event')` listener with per-branch decision recording, exposed through
dynamically registered model tools (the reachable diagnostics channel §8.4 lacked).
Three package iterations, reported as they happened:

1. **pkg-2 (uninstrumented)** — stress child `cb99fe14…` hit the 32,768-token
   ceiling and settled after exactly one turn; the probe produced no visible effect.
   **Inconclusive, not negative**: with no observable channel, "seam failed" and
   "probe could not act" are indistinguishable.
2. **pkg-3 (instrumented)** — added ring-buffer recording of every decision branch
   plus a readable tool. First read failed (`execute result … must be lossless JSON`:
   optional `kind` fields serialized as `undefined`, rejected by the cross-realm
   clone), leaving that run's buffers unreadable. That child also never reached
   max-tokens — it stopped voluntarily amid progressive generation degradation
   (CJK-character corruption self-repair loop, ~3,161 of the intended open-ended
   count). No data.
3. **pkg-4 (fixed + discriminating)** — JSON round-trip fix, plus a one-shot armable
   test granting the SAME synchronous-followup treatment to the next OWNER child whose
   `turn/end` carries `kind:'completed'`. Rationale: delivery of max-tokens `turn/end`
   to a root listener was already proven live by the watchdog fold (§7/§8), so the
   remaining unknowns were purely mechanical (listener firing during the loop tail,
   `agents.get()` mid-dispatch, `followup` callability/enqueue) — answerable with a
   seconds-long completed child instead of another ~8-minute ceiling burn.

Armed test on cheap child `010df521…` (settled normally afterwards; closing message
`ok`; projection stats `turns:1 steps:1 decodeTokens:22 llmMs:9906`):

```json
{"kind":"armed-completed-test-start","id":"010df521-3a09-4bd0-9708-634f6f0e4c8e"}
{"kind":"followup-threw","label":"completed-armed","id":"010df521-…","status":"running",
 "followupType":"function",
 "error":"Error: session append cannot reenter while another append is being published"}
```

The same listener recorded all 27 subagent-origin events of that child in order
(`agent/inbox/spliced`, `turn/start`, `step/start`, `user/message` ×4, `session/title`,
`request/header`, `request/context`, `assistant/chunk` ×12, `assistant/message`,
`step/end`, `turn/end{completed}`), proving in one run: synchronous root-listener
delivery during the loop tail, successful `agents.get(childId)` resolution mid-dispatch
(`status:"running"` — the agent IS still registered), and
`typeof agent.followup === "function"`. The ONLY failure is the nested-append guard.

### 9.3 Verdict

**The alternative live seam does not exist on this runtime.** A synchronous
`Agent.followup()` during `turn/end` dispatch can NEVER enqueue: the inbox splice is
itself a session append, and the runtime forbids nested appends by design. The call
throws before touching the inbox (atomic per L148→149 ordering), the post-turn
`hasPending` check sees an empty queue, and the activation exits after its current
turn. This retroactively explains pkg-2's silent null on the max-tokens child:
identical throw, sink unreachable.

Corollary for the recovery window: the only moment an enqueue could beat the loop's
own check is exactly the moment the runtime makes impossible. Any deferred enqueue
(timer/microtask after the tail) runs after `hasPending` was already consulted —
synchronous code — and therefore cannot continue the SAME activation; it can only
start a new activation cycle, i.e. back through the `coldResume` path already blocked
in §8 (or race the teardown window; deliberately not tested — out of the asked scope,
and §8's flush latency makes the race unattractive).

### 9.4 Consequences

- v0.1's blocking discrepancy stands unchanged: the official `subagents.followup()`
  at `subagent/end` remains the only public continuation seam, and §8 documents why
  it currently fails for freshly settled children. The decision space from §8.5 is
  narrowed: "detect earlier and enqueue live" is not an escape hatch.
- No product code was modified for any part of this investigation. The probe plugin
  was stopped after the experiment (definition retained; zero side effects observed
  on any child; the armed followup attempt threw atomically).
- §8.4 observability note, amended: reachable diagnostics ARE possible from dynamic
  plugins via dynamically registered model tools (used here); `console.warn/error`
  sinks remain unreachable.

---

## 10. Official durability-checkpoint probe — ALL SIX CRITERIA PASS (§8 gap closed)

Executed against the same live host (`@deepseek-ai/dsh` **0.1.1-rc.2**), testing
exactly the `docs/NEXT.md` hypothesis: *one* `ctx.sessions.flush(childSession)`
checkpoint started from the terminal `session/event` observation, with NO enqueue
work inside the callback, and the single official `subagents.followup()` deferred
until after settlement + checkpoint resolution.

### 10.1 Pre-probe source verification (installed runtime, method of §0)

- `SessionStore.flush(session)` (`dsh-session/lib/index.js` ~L1791): requires a LIVE
  session (`liveEntryFor` throws otherwise — satisfied during the child's own
  terminal append dispatch), collects the awaited parallel `session/flush`
  listeners, awaits all, returns whether any participated, and performs **no
  append** — it cannot hit the §9 reentrancy guard.
- First-party persistence backend subscribes `session/flush → this.flush(session)`
  (`dsh-session-persistence/lib/index.js` ~L1158); its coordinator `flush()`
  cancels the automatic write wait, awaits `init`, then drains the write-behind
  queue through `appendCore` → backend append ("append resolves only after
  durability") — the immediate quiescence barrier NEXT.md described.
- `coldResume` (`dsh-subagent/lib/index.js` ~L1136–1181) wraps exactly two failure
  sites as `NOT_RESUMABLE "subagent … is unavailable"`: a throwing
  `persistence.inspect()` (~L1151) and a non-SubagentError from `materialize()`
  (~L1177); the descriptor-fold rejection (~L1157) has the distinct §8 wording.
- `agentLoop.resumeWith` (`dsh-agent-loop/lib/index.js` ~L1292) fuses the caller
  signal via `AbortSignal.any([options.signal, ownerAbort.signal,
  ownership.signal])` — `options.signal` must be a REAL `AbortSignal`.

### 10.2 Probe mechanics

Disposable dynamic host plugin (`fprobe-3`, packages pkg-5 → pkg-7, honest
iteration log as in §9.2). Root-level `subagent/start|end` + `session/event`
listeners; evidence ring buffer read through one dynamically registered model tool
(`flushprobe_control`: arm-next-start / arm / read). Sequence per armed cheap
continuable child ("reply ok"): on first target `turn/end` → synchronously kick
`sessions.flush(childSession)` (record admitted/threw; no await inside dispatch);
on `subagent/end` → microtask chain: await flush promise →
`sessionPersistence.inspect()` + `readRaw()` → fold descriptor → ONE official
`subagents.followup(parent, childId, …)`. Event-driven throughout: no timers, no
polling, no custom storage, no private APIs.

Iterations:
1. **pkg-5**: criteria 1–3 passed on child `52405d4c…`; `followup` threw
   `NOT_RESUMABLE` with the NEW wording *"is unavailable"* (not §8's wording).
2. **pkg-6** (cause-chain instrumentation), child `5815ec0b…`: criteria 1–3
   replicated; cause chain captured — `SubagentError NOT_RESUMABLE "is
   unavailable"` caused by `TypeError ERR_INVALID_ARG_TYPE: "signals[0] is not of
   type AbortSignal."`. The probe's sandbox stub signal (the §6.5-minimal shape
   used by [../plugin/watchdog.host.js](../plugin/watchdog.host.js)) satisfies the
   persistence consumer but is rejected by `AbortSignal.any` inside
   `agents.resume()`. §8 never reached this layer because it failed earlier at
   descriptor folding. Probe artifact, not a runtime discrepancy.
3. **pkg-7** (real caller signal captured from the control tool's own dispatch —
   `fuseToolSignals` proves a fused dispatch signal stays non-aborted after the
   call completes; dispose only removes listeners), child `8d9da322…`: full pass.

### 10.3 Evidence vs the six criteria (child `8d9da322-6831-44e4-bd98-8b14135c4613`)

1. **Flush admitted from the terminal observation, no reentrancy guard** —
   `flush-kicked {admitted:true}` recorded synchronously inside the `turn/end`
   dispatch; no throw. (3/3 children)
2. **Flush promise resolves** — `flush-resolved {participated:true}` and
   `pre-followup-flush-state {resolved}`. (3/3 children)
3. **Durable descriptor present after settlement** — decision-time
   `sessions.get(childId)` was already undefined (`liveAtInspect:false`), so
   `inspect()` read the PHYSICAL log — the exact path `coldResume` takes — and
   folded `descriptorMode:"continuable"` over 30 events; `readRaw()` confirmed the
   physical artifact byte-level (87,013 bytes / 30 lines /
   contains `subagent/descriptor`). §8's empty-log window is closed by the
   checkpoint. (3/3 children; 35/32/30 events respectively)
4. **One official followup after settlement + flush succeeds** —
   `followup-signal {real:true, aborted:false}`, then `followup-delivered
   {messageId:"09867be0-3ea3-48ea-884b-2af4dcc6562e"}`.
5. **Same durable session id, new activation epoch** — two `subagent/start`
   events for the SAME id with distinct runIds
   (`e137fde0…` → `8dde67b6…`); the resumed epoch ran its turn to `completed`
   (`epoch-end {stopReason:"completed", runId:"8dde67b6…"}`) and delivered the
   second verbatim settlement notice to this session.
6. **No timer/polling/custom storage/private API** — listeners + promise
   microtasks + official services only (`sessions.flush`,
   `sessionPersistence.inspect/readRaw`, `subagents.followup`).

### 10.4 Consequences and constraints for the v0.1 redesign

- The §8 blocker mechanism is CONFIRMED and CLOSED: checkpoint-before-followup
  makes freshly settled continuable children cold-resumable through the official
  seam, deterministically, inside the existing event-driven shape. No timers, no
  polling, no custom persistence.
- NEW hard constraint surfaced: the recovery path requires a REAL `AbortSignal`
  for `followup(options.signal)`. Inside the dynamic-package sandbox there is no
  `AbortController` global, and the hand-rolled stub throws
  `TypeError … "signals[0] is not of type AbortSignal"` once cold resume reaches
  `agents.resume()`. Official sources exist (a dynamic tool's own dispatch signal
  was proven sufficient here); the product must adopt one deliberately rather
  than shipping the stub.
- Probe state: `fprobe-3` stopped after the experiment (pkg-5/6/7 retained);
  children `52405d4c…` and `5815ec0b…` were never touched after their natural
  completion; `8d9da322…` received exactly the probe's one continuation and
  completed it. No repo product file was modified for any probe iteration.

---

## 11. Redesigned v0.1 implementation — checkpoint-before-followup with a real attempt signal

The product code now implements the §10 sequence. Sources:
[../lib/index.js](../lib/index.js) (packaged module, source of truth) and
[../plugin/watchdog.host.js](../plugin/watchdog.host.js) (byte-derived dynamic
body, regenerated by `scripts/sync-dynamic.mjs`). Local suite:
38 scenarios over both artifacts against real cordis / dsh-subagent / dsh-session
dispatch; `subagents.followup` spied at the official call boundary.

### 11.1 Real AbortSignal resolution (NEXT.md blocker)

- Chosen source: one fresh `new AbortController().signal` per recovery attempt,
  never aborted by the watchdog. Satisfies all five NEXT criteria: genuine host
  signal accepted by the `AbortSignal.any()` fusion in `agentLoop.resumeWith`
  (`dsh-agent-loop/lib/index.js` ~L1292); available without any model/tool call
  — first-party precedent `dsh-tool-subagent/lib/index.js` L257 constructs its
  own controller in normal execution; valid across the whole decision window;
  not aborted by callback return; standard packaged-environment primitive.
- Environment boundary verified in source: `createSandbox`
  (`dsh-cordis-host-runner/lib/index.js`) exposes only
  `ctx/harness/console/btoa/atob/TextEncoder/TextDecoder` + Node-API traps, and
  VM contexts carry no platform globals — so the dynamic dev realm has no
  `AbortController`, and no official capture-free signal source exists there
  (cordis core has no fiber-signal API; no DSH service returns one). A dynamic
  mount therefore fails recovery contained at construction (existing catch →
  `delivery-failed` notice path). The production shape is a composition row in
  the full host process, where the global exists.
- The duck-typed `neverAbortSignal()` stub is deleted from both artifacts.

### 11.2 Checkpoint wiring

- `session/event` handler: on `turn/end { reason.kind: 'max-tokens' }` for an
  admitted child with no engaged chain and mode ≠ `'one-shot'`,
  `startDurabilityCheckpoint(ctx, session, warn)` runs synchronously inside the
  child's own append dispatch — the one window where the Session is still live
  (`SessionStore.flush` throws for non-live sessions otherwise). It performs no
  enqueue work. The returned promise is normalized to `{ ok, … }` so the
  settlement-time decision needs no try/catch around await.
- Listener-order note: the persistence coordinator's own `session/event`
  listener enqueues the terminal event before the watchdog listener runs (host
  composition mounts first), so the flush barrier drains it together with all
  prior buffered events — matching §10's live evidence.
- `subagent/end` decision: enter `'pending'` synchronously (unchanged), then
  await the checkpoint before the restart-safe durable verification; create the
  attempt signal; share it between `sessionPersistence.inspect()` and the single
  `subagents.followup()`. Failure branches: checkpoint rejected/threw → chain
  spent + one `checkpoint-failed` notice; unverifiable mode → silent release
  (AC7a unchanged); marker present → chain spent + one notice; followup throw →
  mark-before-act `delivery-failed`; later failing epochs of a delivered chain →
  one capped notice. No new timers, polling, storage, or private APIs.

### 11.3 Test evidence (38 scenarios, both artifacts)

New coverage required by NEXT step 8: AC11 (exactly one checkpoint on the live
child session, trace-ordered strictly before the followup); AC12 (rejected
checkpoint → one notice naming the failed stage, zero followups, later epoch
neither retries nor re-notifies); AC12b (synchronously throwing admission is
contained); AC13 (duplicate genuine `subagent/end` while the checkpoint is
pending → one continuation, no false notice, later real failure notifies once).
Real-signal plumbing asserted at both official boundaries: followup options
(`instanceof AbortSignal`, non-aborted, AC1) and persistence inspection (AC8).
Pre-existing guard suite (AC1–AC10, AC9b, absent-parent, steer-vs-followup)
passes unchanged.

---

## 12. Local packaging + final live acceptance — ALL SEVEN CRITERIA PASS

Executed 2026-08-23 against `@deepseek-ai/dsh` **0.1.1-rc.2** (same process
family as §0–§11), on a production-shaped **packaged composition mount**, not a
dynamic dev package.

### 12.1 Verified official packaging format (source-verified before writing metadata)

- A profile is `$DSH_HOME/profiles/<name>/` holding `package.json` (manifest
  with the ordered `dsh.profile.bundles` list), a user patch layer
  `cordis.patch.yml`, and `pnpm-workspace.yaml`
  (`dsh-app-boot/lib/index.js`, "Profile discovery…").
- The ordinary install path is `dsh plugin --profile <name> add <package|path>`:
  it initializes the profile on first use, forwards to pnpm with relative path
  specs anchored to the invoking directory, then **reconciles** — any installed
  dependency whose manifest declares `"dsh": { "bundle": { "patch": … } }`
  joins the bundle stack automatically; bundle-less dependencies are installed
  as plain dependencies with a warning (`dsh/lib/plugin-9h8shc4d.js`).
- The loader uses `exports.default ?? exports` of each row module, so the
  existing `lib/index.js` default export `{ name, apply }` mounted unchanged.
- Shipped third-party precedent confirmed the minimal shape
  (`dsh-better-sidebar@0.13.0`): package.json with `dsh.bundle.patch` plus one
  root `cordis.patch.yml` containing a single `- insert:` row.
- This repo now ships exactly that: [package.json](../package.json) +
  [cordis.patch.yml](../cordis.patch.yml) (row id `subagent-watchdog`). No
  build step, no dependencies (`lib/index.js` imports nothing).

### 12.2 Live defect found by the packaged mount — apply-time optional read of `subagents`

The first instrumented acceptance attempt recorded the terminal
`turn/end {kind:'max-tokens'}` and `subagent/end` but NO watchdog reaction at
all: no warn line, no notice, no followup — the decision path never entered.
Cause chain:

1. Composition rows activate in service-availability order ("Row order carries
   no load semantics"); the freshly added bundle row activated before the
   `subagents` service was registered.
2. `apply()` used an optional `ctx.get('subagents')` and returned permanently
   on `undefined` — a silent no-op for the plugin's whole lifetime.
3. The local harness could never catch this: `makeHost` pre-mounts
   `SubagentRuntime` before mounting the artifact, so all 38 scenarios passed
   on both sides of the defect.

Fix (product change): declare the one true hard dependency —
`export const inject = ['subagents']` — so Cordis defers/re-runs `apply` until
the registry exists ([lib/index.js](../lib/index.js)); every other service
stays an optional in-handler read. Suite re-run green (38/38). The dynamic
body regenerator ([scripts/sync-dynamic.mjs](../scripts/sync-dynamic.mjs)) now
carries the `inject` export into `plugin/watchdog.host.js`.

### 12.3 Acceptance environment (scratch profile, ordinary path only)

- Isolated `DSH_HOME` under the workspace (official override,
  `dsh-home-paths`): profile `headless` auto-initialized from the shipped
  template `[dsh-base, dsh-headless]`, then two `dsh plugin add` invocations
  appended `dsh-subagent-watchdog` and two throwaway probe bundles (an
  AbortController-environment prober and a scalar evidence recorder — test
  harness only, never shipped).
- Model route pinned via launcher `--patch` overlays (test-only): the pi-ai
  route must be declared in the ROW CONFIG because headless fires its first
  model request before the settings document finishes loading (registration is
  synchronous from row config; the settings section lands later via
  `installSettingsSection`). The chosen route honors `max_tokens` verbatim
  (`finish_reason: length` at the exact cap); the opencode-go route ignores it
  (7503 completion tokens on a 32 cap — measured directly).
- Cheap deterministic ceiling per NEXT step 3: YES through a supported public
  option — `tool-subagent` config `agentOptions.maxTokens` flows
  `resolveChildAgentOptions` → child loop request → finish `length` →
  sticky `max-tokens`. Overlay set 300; no product code touched for the test.
- Headless driving notes (test harness, not product): the runner's `whenIdle`
  resolves if the parent goes idle before a background settlement arrives, so
  the parent held itself alive by polling `list_agents`; bash-based sleeps are
  unavailable under headless sandbox policy (no approval answerer).

### 12.4 Acceptance trace (evidence recorder, scalar facts; times in ms from boot)

Child id `3b24d537-3f60-42c1-beb9-fd27c302dbca`, parent = the headless root
session; route openrouter-newest/stealth/ox-alpha; ceiling 300 tokens.

```
  702  boot { abortController: "function" }                    ← genuine host primitives (Step-2 gate)
59010  subagent/start  runId 28c158b4… id 3b24d537…            ← epoch 1 (continuable)
81236  turn/end        id 3b24d537… reasonKind max-tokens      ← AC1
81265  subagent/end    runId 28c158b4… stopReason max-tokens
81333  subagent/start  runId 69d72121… id 3b24d537…            ← AC3+AC4: same durable session id,
                                                                new activation epoch, 68 ms after
                                                                settlement ⇒ checkpoint-before-followup
                                                                closed the §8 gap and the real signal
                                                                passed AbortSignal.any fusion
81433  user/message    id 3b24d537… source subagent-watchdog/relay  ← the ONE continuation (AC5)
84267  inspect @3s     descriptor continuable, markers 1, turnEnds [max-tokens]
87825  parent notice   "ran out of room…" (runtime's own wording, §2.4)
126269 inspect @45s    markers STILL 1                         ← no duplicate delivery (AC5)
408782 report          child reports task complete (epoch 2)
419849 turn/end        id 3b24d537… reasonKind completed       ← resumed activation healthy
419874 subagent/end    runId 69d72121… stopReason completed
419937 parent notice   "finished and will do no further work…"
—      NO message containing "[watchdog]" anywhere              ← AC6 normal-completion branch:
                                                                silent on success (AC7 by code+suite)
```

Parent's own summary agreed: three messages received (two settlements + the
child's `report` relay), "no message containing [watchdog] appeared."

### 12.5 Constraints learned (runtime facts, no action required by v0.1)

- `coldResume` reconstructs children with ONLY `{provider, model}` from the
  descriptor (`dsh-subagent/lib/index.js` ~L1160) — a caller-set
  `maxTokens` does NOT survive cold resume, so a recovered epoch runs uncapped
  by runtime design. v0.1 neither relies on nor alters this.
- The fresh-child `subagent/descriptor` seed does not dispatch through
  `session/event` (bulk seed write); mode classification therefore comes from
  the post-flush durable inspection — exactly what §6a/§11 designed for.
- `opencode-go` (openai-completions at `opencode.ai/zen/go/v1`) disregards
  client `max_tokens`; OpenRouter honored it exactly. Route choice matters for
  token-ceiling tests only; the watchdog is agnostic.

**v0.1 feature development is complete.** Next phase per docs/NEXT.md:
distribution only.
