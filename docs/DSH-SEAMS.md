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
