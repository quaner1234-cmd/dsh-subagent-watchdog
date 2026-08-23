/**
 * GENERATED FILE — do not edit by hand; run `node scripts/sync-dynamic.mjs`.
 * Source of truth: ../lib/index.js (behavioral equivalence is test-enforced).
 *
 * dsh-subagent-watchdog — dynamic Cordis host plugin body for `cordis_define`.
 * Paste as the `code.host` field (plain JavaScript function body returning the
 * plugin object). See docs/DSH-SEAMS.md for the verified runtime seams and
 * docs/NEXT.md for the v0.1 behavior contract.
 */
/**
 * dsh-subagent-watchdog — auto-continue-once recovery for native continuable
 * DSH subagents that end with explicit `max-tokens` termination (v0.1).
 *
 * Product behavior (AGENTS.md): when a CONTINUABLE subagent ends with
 * `stopReason: 'max-tokens'`, automatically continue that same child
 * conversation exactly ONCE via the official `subagents.followup()` seam,
 * asking it to continue the unfinished task from its existing conversation
 * state. If the recovered activation ends again in `max-tokens` or in an
 * explicit runtime/provider error, stop intervening and notify the parent once.
 * Never loop.
 *
 * Verified live sequence (docs/DSH-SEAMS.md §10): the terminal
 * `turn/end { kind: 'max-tokens' }` observation starts exactly ONE official
 * `ctx.sessions.flush(childSession)` durability checkpoint while the child
 * Session is still live — no enqueue and no followup happen inside that event
 * callback. After normal settlement and checkpoint resolution, the single
 * official `subagents.followup()` cold-resumes the same durable child session
 * id in a new activation epoch. Without the checkpoint, the freshly settled
 * child's physical log lags behind lazy flushing and cold resume rejects the
 * continuation (`NOT_RESUMABLE`, §8); with it, recovery succeeds (§10).
 *
 * v0.1 boundaries:
 * - Continuable children only (confirmed via the durable `subagent/descriptor`
 *   mode); unknown-shape and one-shot children are never recovered.
 * - `max-tokens` is the only automatic recovery trigger.
 * - Errors are never auto-retried; they are reported only as a recovery-chain
 *   failure (once).
 * - Normal completion, clean abort, refusal, and unknown future stop reasons
 *   (merge-extensible enums) are untouched.
 * - No UI, no dashboard, no persistence of the plugin's own, no second LLM,
 *   no timers, no polling.
 *
 * Cancellation signal (verified — §10 iteration 2): `subagents.followup()`
 * requires a GENUINE host `AbortSignal`; the cold-resume path fuses it through
 * `AbortSignal.any`, which rejects duck-typed stand-ins. Each recovery attempt
 * therefore owns one fresh `new AbortController()` — the standard host
 * primitive first-party plugins use in normal execution (dsh-tool-subagent) —
 * and never aborts it, so the signal stays valid across the entire
 * terminal-event → flush → settlement → followup-admission window.
 *
 * Continue-once guard (verified design — docs/DSH-SEAMS.md § "v0.1
 * continue-once guard"):
 * - Identity: the child's DURABLE session id (stable across activation epochs;
 *   each epoch mints a fresh runId, so runId cannot key the guard).
 * - Process-lifetime state: a per-chain map distinguishes 'pending' (the first
 *   max-tokens end was accepted; the durable verification / followup decision
 *   is still in flight) from 'delivered' (the one continuation was handed to
 *   followup, or a prior delivery was proven from the durable log); a
 *   `notified` set caps parent notices at one per chain per process. All are
 *   consulted synchronously inside event handlers, so duplicate or repeated
 *   end deliveries of the original settlement epoch can neither initiate a
 *   second continuation nor fake a parent notice while the decision is in
 *   flight. Only a genuinely later failing activation after 'delivered'
 *   reaches the parent.
 * - Restart safety: before initiating a continuation the plugin reads the
 *   child's own durable log through the official `sessionPersistence.inspect()`
 *   seam and skips recovery when a prior watchdog continuation message is
 *   already present (`data.source.kind === 'subagent-watchdog'`). Continuation
 *   messages become durable session events precisely because they are delivered
 *   through `followup`.
 * - Precise guarantee: at most one RECEIVED continuation per child chain. The
 *   only window where a second could ever be sent is a crash between followup
 *   acceptance and the message becoming durable — in which case the first
 *   continuation was lost, so the child has still received at most one.
 */

/** Service name presented to Cordis; composition rows address the module. */
const name = 'dsh-subagent-watchdog'

/** Tracked-child table cap (FIFO eviction; scalars only). */
const MAX_TRACKED_CHILDREN = 1024

/** Matches the seam's own `diagnostic` bound for parent notices. */
const NOTICE_MAX_BYTES = 4096
/** Folded `LlmFailure.message` budget inside a notice. */
const FAILURE_MESSAGE_MAX_CHARS = 200
/** Mirrors the runtime's `CONTEXT_SUMMARY_MAX_CHARS`. */
const SUMMARY_MAX_CHARS = 120

const encoder = typeof TextEncoder === 'undefined' ? undefined : new TextEncoder()

function byteLengthOf(text) {
	return encoder ? encoder.encode(text).length : text.length
}

function truncate(text, max) {
	if (typeof text !== 'string') return undefined
	return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

let noticeSeq = 0
function freshMessageId() {
	noticeSeq += 1
	return `watchdog-${Date.now().toString(36)}-${noticeSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Extract scalar failure facts from a folded `LlmFailure` (or flattened `{message, code}`). */
function extractFailure(error) {
	if (error === null || typeof error !== 'object') return undefined
	const code = typeof error.code === 'string' && error.code !== '' ? error.code : undefined
	const status = typeof error.status === 'string' && error.status !== '' ? error.status : undefined
	const requestId = typeof error.requestId === 'string' && error.requestId !== '' ? error.requestId : undefined
	const message = truncate(error.message, FAILURE_MESSAGE_MAX_CHARS)
	if (code === undefined && status === undefined && requestId === undefined && message === undefined) {
		return undefined
	}
	return { code, status, requestId, message }
}

/** FIFO eviction keeping a scalar-only table bounded. */
function evictOldest(map, cap) {
	while (map.size > cap) {
		for (const key of map.keys()) {
			map.delete(key)
			break
		}
	}
}

/**
 * Resolve the delegating parent's session id for a child.
 * Primary: the live agent store (`ctx.get('agents').get(childId)` resolves
 * during the `subagent/start` notification for in-process providers). Fallback:
 * the sessions store's durable `SessionHeader.parentSession`.
 */
function resolveParentSessionId(ctx, childId) {
	try {
		const agent = ctx.get('agents')?.get(childId)
		const fromAgent = agent?.session?.header?.parentSession
		if (typeof fromAgent === 'string' && fromAgent !== '') return fromAgent
	} catch { /* live-store miss falls through to the durable header */ }
	try {
		const fromStore = ctx.get('sessions')?.get(childId)?.header?.parentSession
		if (typeof fromStore === 'string' && fromStore !== '') return fromStore
	} catch { /* persistence-less deployments simply have no fallback */ }
	return undefined
}

/** Whether a durable user/message event records a prior watchdog continuation. */
function isContinuationMarker(event) {
	return event?.type === 'user/message'
		&& event.data?.source?.kind === 'subagent-watchdog'
}

/**
 * Build the one-shot continuation instruction delivered to the child. Short,
 * deterministic, and free of any judgment about the task content.
 */
function buildContinuationInstruction(childId) {
	return [
		'[watchdog] Your previous turn ended because it ran out of output tokens (reason: max-tokens).',
		'Continue the unfinished task from your existing conversation state; do not repeat work you already completed.',
	].join(' ')
}

/** Build the single parent notice for a recovery chain whose one continuation
 * did not lead to a healthy outcome. `outcome` keeps the wording honest about
 * what actually happened: either the continuation WAS delivered and the chain
 * failed again, or the continuation could not be delivered at all. */
function buildRecoveryFailedNotice({ childId, stopReason, failure, outcome }) {
	const lines = [outcome === 'delivery-failed'
		? `[watchdog] Subagent ${childId} ended with max-tokens; its one automatic continuation could not be delivered (${stopReason}). No further automatic recovery will be attempted.`
		: outcome === 'checkpoint-failed'
			? `[watchdog] Subagent ${childId} ended with max-tokens; its automatic continuation was skipped because the durability checkpoint failed (${stopReason}). No further automatic recovery will be attempted.`
			: `[watchdog] Subagent ${childId} was automatically continued once after ending with max-tokens, but its latest activation ended again (${stopReason}). No further automatic recovery will be attempted.`]
	if (failure !== undefined) {
		const bits = []
		if (failure.code !== undefined) bits.push(`code=${failure.code}`)
		if (failure.status !== undefined) bits.push(`status=${failure.status}`)
		if (failure.requestId !== undefined) bits.push(`requestId=${failure.requestId}`)
		if (failure.message !== undefined) bits.push(`message=${failure.message}`)
		if (bits.length > 0) lines.push(`Failure: ${bits.join(' ')}.`)
	}
	lines.push(
		'Official options: send_message continues this continuable child manually; interrupt_agent stops a currently running turn; re-delegate a fresh subagent call if it cannot finish within its token budget.',
	)
	let text = lines.join('\n')
	if (encoder && byteLengthOf(text) > NOTICE_MAX_BYTES) {
		const cut = encoder.encode(text).slice(0, NOTICE_MAX_BYTES - 1)
		text = `${new TextDecoder().decode(cut)}…`
	}
	return {
		id: freshMessageId(),
		role: 'user',
		content: [{ type: 'text', text }],
		source: {
			kind: 'subagent-watchdog',
			form: 'notice',
			summary: truncate(`Subagent ${childId} watchdog recovery ended (${stopReason})`, SUMMARY_MAX_CHARS),
			senderSessionId: childId,
		},
	}
}

/** Deliver one notice to the delegating parent, mirroring the runtime's own
 * `notifySettlement` pattern: `followup` when idle, `steer` when running; a
 * delivery failure is logged and dropped (the child's session stays durable). */
function deliverNotice(ctx, warn, parentSessionId, message) {
	let parent
	try {
		parent = ctx.get('agents')?.get(parentSessionId)
	} catch {
		parent = undefined
	}
	if (parent === undefined) {
		warn(`parent ${parentSessionId ?? '(unresolved)'} is not live; notice skipped`)
		return
	}
	try {
		if (parent.status === 'idle') parent.followup(message)
		else parent.steer(message)
	} catch (error) {
		warn(`notice delivery to parent ${parentSessionId} failed:`, error)
	}
}

/**
 * Start the one official durability checkpoint (`ctx.sessions.flush`) for a
 * freshly observed terminal max-tokens turn, exactly as verified in
 * docs/DSH-SEAMS.md §10. The call happens synchronously inside the child's own
 * `turn/end` append dispatch — the one window where the Session is still live —
 * and performs no enqueue work. The promise is normalized to `{ ok, … }` so the
 * settlement-time decision can branch without a try/catch around await: a
 * rejection and a synchronous admission throw both surface as `{ ok: false }`.
 */
function startDurabilityCheckpoint(ctx, session, warn) {
	try {
		const sessions = ctx.get('sessions')
		if (sessions === undefined || typeof sessions.flush !== 'function') {
			// Degenerate composition without the core session store: behave like
			// the pre-checkpoint world (the decision path re-verifies durability).
			return { promise: Promise.resolve({ ok: true, unavailable: true }) }
		}
		return {
			promise: Promise.resolve(sessions.flush(session)).then(
				(participated) => ({ ok: true, participated: participated === true }),
				(error) => ({ ok: false, error }),
			),
		}
	} catch (error) {
		warn('durability checkpoint could not start:', error)
		return { promise: Promise.resolve({ ok: false, error }) }
	}
}

/**
 * Hard dependency: the host-plane subagent registry is the only service the
 * plugin cannot observe around. Declaring it makes Cordis defer (and re-run)
 * `apply` until `subagents` is registered — composition rows activate in
 * service-availability order, and an optional `ctx.get('subagents')` read at
 * apply time races that order: on a real headless mount the row regularly
 * activated BEFORE `dsh-subagent`, leaving the plugin a silent no-op for its
 * whole lifetime (observed live during the packaged-mount acceptance run;
 * every other service stays an optional in-handler read by design).
 */
const inject = ['subagents']

/** The Cordis plugin. Registers listeners inside `apply` so Cordis owns disposal. */
function apply(ctx) {
	const subagents = ctx.subagents

	const warn = (...parts) => {
		try {
			const line = ['[dsh-subagent-watchdog]', ...parts.map((part) => String(part))].join(' ')
			if (typeof console !== 'undefined') console.warn(line)
		} catch { /* containment: a logging failure must never escape a listener */ }
	}

	/**
	 * Per-child fold: childId ->
	 * { parentSessionId?, mode?, lastTurnEnd?, checkpoint? }. All fields are
	 * owned scalars except `checkpoint`, which holds the normalized promise of
	 * the one durability checkpoint started at the terminal observation.
	 */
	const children = new Map()
	/**
	 * Recovery-chain states (process lifetime), keyed by durable child id.
	 * 'pending': the first max-tokens end was accepted and the async durable
	 * verification / followup decision is still in flight; 'delivered': the
	 * one watchdog continuation was spent (delivered, marked failed attempt,
	 * or proven already durable). The third phase — recovery failed again /
	 * notify once — is the 'delivered' state plus the `notified` cap below.
	 */
	const CHAIN_PENDING = 'pending'
	const CHAIN_DELIVERED = 'delivered'
	const chains = new Map()
	/** Chains whose recovery-failure notice was already delivered (per process). */
	const notified = new Set()

	function admitChild(childId) {
		let child = children.get(childId)
		if (child === undefined) {
			child = {}
			children.set(childId, child)
			evictOldest(children, MAX_TRACKED_CHILDREN)
		}
		return child
	}

	ctx.on('subagent/start', (info) => {
		try {
			const childId = info?.id
			if (typeof childId !== 'string') return
			const child = admitChild(childId)
			if (child.parentSessionId === undefined) {
				child.parentSessionId = resolveParentSessionId(ctx, childId)
			}
		} catch (error) {
			warn('subagent/start handler failed:', error)
		}
	})

	ctx.on('session/event', (session, event) => {
		try {
			const type = event?.type
			// Cheap first filter: only two event types matter.
			if (type !== 'turn/end' && type !== 'subagent/descriptor') return
			let childId
			try {
				childId = session?.id
			} catch {
				return
			}
			if (typeof childId !== 'string') return
			let child = children.get(childId)
			if (child === undefined) {
				// Lazy admission: a child's first events can be appended inside the
				// provider's start window, racing the synchronous `subagent/start`
				// publication. Admit only genuine subagent sessions.
				let origin
				try {
					origin = session.header?.origin
				} catch {
					return
				}
				if (origin !== 'subagent') return
				child = admitChild(childId)
			}
			const data = event.data ?? {}
			if (type === 'subagent/descriptor') {
				if (data.mode === 'one-shot' || data.mode === 'continuable') child.mode = data.mode
				return
			}
			const kind = data.reason?.kind
			if (typeof kind !== 'string') return
			child.lastTurnEnd = kind === 'error'
				? { kind, error: extractFailure(data.reason.error) }
				: { kind }
			// Durability checkpoint (§10): a `max-tokens` turn end is terminal for
			// the activation, and this dispatch runs inside the child's own append
			// while its Session is still live. Start exactly one checkpoint per
			// fresh recovery decision — a chain already engaged ('pending' or
			// 'delivered') will never follow up again, so it needs no barrier, and
			// one-shot children are never recovered at all. No enqueue and no
			// followup happen here; the settlement-time decision awaits it.
			if (
				kind === 'max-tokens'
				&& chains.get(childId) === undefined
				&& child.mode !== 'one-shot'
				&& child.checkpoint === undefined
			) {
				child.checkpoint = startDurabilityCheckpoint(ctx, session, warn)
			}
		} catch (error) {
			warn('session/event handler failed:', error)
		}
	})

	/** Notify the parent once per chain per process; later failures stay silent. */
	function notifyOnce(parentSessionId, childId, stopReason, failure, outcome) {
		if (notified.has(childId)) return
		notified.add(childId)
		deliverNotice(ctx, warn, parentSessionId, buildRecoveryFailedNotice({
			childId,
			stopReason,
			failure,
			outcome,
		}))
	}

	/**
	 * Consume the folded terminal facts so they can never leak into a later
	 * activation epoch of the same child.
	 */
	function consumeFailure(child) {
		if (child?.lastTurnEnd?.kind !== 'error') return undefined
		const failure = child.lastTurnEnd.error
		child.lastTurnEnd = undefined
		return failure
	}

	/**
	 * Read the child's own durable log through the official persistence seam.
	 * Returns the durable subagent mode and whether a prior watchdog
	 * continuation marker exists. The inspection is live-preferred, so it
	 * answers identically for resident and cold children; it survives process/
	 * plugin restarts because both the descriptor and the continuation are
	 * durable session events. This mirrors how `coldResume` itself classifies
	 * a restored child (`foldSubagentDescriptor(loaded.events)`).
	 */
	async function inspectDurable(childId, signal) {
		const persistence = ctx.get('sessionPersistence')
		if (persistence === undefined || typeof persistence.inspect !== 'function') {
			return { mode: undefined, continued: false }
		}
		const inspection = await persistence.inspect(childId, signal)
		const events = Array.isArray(inspection?.events) ? inspection.events : []
		return {
			mode: events.find((event) => event?.type === 'subagent/descriptor')?.data?.mode,
			continued: events.some(isContinuationMarker),
		}
	}

	ctx.on('subagent/end', (info) => {
		try {
			const stopReason = info?.stopReason
			// High-confidence branch on known variants; everything else untouched.
			if (stopReason !== 'max-tokens' && stopReason !== 'error') return
			const childId = info?.id
			if (typeof childId !== 'string') return
			const child = children.get(childId)
			const mode = child?.mode

			// One-shot children have no resume seam; never recovered. Unknown
			// shapes are decided by the durable verification below (the live
			// descriptor fold can miss a restored log after remount).
			if (mode === 'one-shot') return

			// Resolve the delegating parent once; without a live parent there is
			// no authorized followup and no reachable notice channel.
			const parentSessionId = child?.parentSessionId ?? resolveParentSessionId(ctx, childId)

			// Guard: branch purely on this chain's recovery state.
			const chainState = chains.get(childId)
			if (chainState === CHAIN_PENDING) {
				// A repeated/duplicate end of the ORIGINAL settlement epoch while
				// the first recovery decision is still in flight is not evidence
				// of a failed recovery: neither continue nor notify.
				return
			}
			if (chainState === CHAIN_DELIVERED) {
				// The one continuation is spent; a genuinely later activation
				// failing again — max-tokens or explicit error — reaches the
				// parent exactly once.
				notifyOnce(parentSessionId, childId, stopReason, consumeFailure(child))
				return
			}

			// Provider/runtime errors are never auto-retried in v0.1; an error as
			// the FIRST observed terminal outcome is left to the runtime's own
			// settlement notice.
			if (stopReason !== 'max-tokens') return

			// Enter 'pending' synchronously so duplicate/repeated settlements of
			// the original epoch can never initiate a second continuation, then
			// verify durability off-thread.
			chains.set(childId, CHAIN_PENDING)
			Promise.resolve()
				.then(async () => {
					// Settle the durability checkpoint started at the terminal
					// observation BEFORE consulting the durable log: the freshly
					// settled child is no longer live-published, so both the guard's
					// inspection and cold resume read the physical log (§8/§10).
					const flushed = await child?.checkpoint?.promise
					if (flushed !== undefined && !flushed.ok) {
						// The recovery pipeline broke before anything was delivered;
						// per the product contract this is not retried automatically.
						chains.set(childId, CHAIN_DELIVERED)
						warn(`durability checkpoint for child ${childId} failed:`, flushed.error)
						notifyOnce(parentSessionId, childId, stopReason, consumeFailure(child), 'checkpoint-failed')
						return
					}
					// One real cancellation scope per attempt. `followup` fuses the
					// caller signal through `AbortSignal.any`, which rejects
					// duck-typed stand-ins (§10); a fresh host `AbortController` —
					// the primitive first-party plugins use in normal execution —
					// stays valid across the whole decision window because the
					// watchdog never aborts it.
					const signal = new AbortController().signal
					// Restart-safe verification against the child's own durable
					// log: confirmed continuable mode, and no prior watchdog
					// continuation marker.
					const durable = await inspectDurable(childId, signal)
					if (durable.mode !== 'continuable' && mode !== 'continuable') {
						// The budget was not spent; release the chain so a later
						// epoch can decide again with better information.
						chains.delete(childId)
						warn(`child ${childId} is not verifiably continuable; recovery skipped`)
						return
					}
					if (durable.continued) {
						// Restart safety: this child's own durable log already
						// carries a watchdog continuation — treat that prior
						// delivery as this chain's one continuation.
						chains.set(childId, CHAIN_DELIVERED)
						warn(`child ${childId} already carries a watchdog continuation; not continuing again`)
						notifyOnce(parentSessionId, childId, stopReason, consumeFailure(child))
						return
					}
					const parent = ctx.get('agents')?.get(parentSessionId)
					if (parent === undefined) {
						// No authorized channel exists right now; release the chain
						// (a later epoch may find the parent live again).
						chains.delete(childId)
						warn(`parent ${parentSessionId ?? '(unresolved)'} is not live; recovery skipped`)
						return
					}
					try {
						await subagents.followup(parent, childId, [{
							type: 'text',
							text: buildContinuationInstruction(childId),
						}], {
							source: {
								kind: 'subagent-watchdog',
								form: 'relay',
								summary: truncate('watchdog auto-continue after max-tokens', SUMMARY_MAX_CHARS),
								senderSessionId: parentSessionId,
							},
							signal,
						})
						// Delivered — marked only after followup resolves, so an end
						// event racing the await is still treated as a duplicate of
						// the original epoch, never as a failed recovery. From here
						// on only a genuinely later failing activation can notify.
						chains.set(childId, CHAIN_DELIVERED)
					} catch (error) {
						// The attempt stands (mark-before-act): this chain keeps
						// its one slot even though nothing was received.
						chains.set(childId, CHAIN_DELIVERED)
						warn(`continuation delivery to child ${childId} failed:`, error)
						notifyOnce(parentSessionId, childId, stopReason, consumeFailure(child), 'delivery-failed')
					}
				})
				.catch((error) => {
					chains.set(childId, CHAIN_DELIVERED)
					warn(`recovery decision for child ${childId} failed:`, error)
					notifyOnce(parentSessionId, childId, stopReason, consumeFailure(child), 'delivery-failed')
				})
		} catch (error) {
			warn('subagent/end handler failed:', error)
		}
	})
}


return { name, inject, apply }
