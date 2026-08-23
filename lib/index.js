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
 * v0.1 boundaries:
 * - Continuable children only (confirmed via the durable `subagent/descriptor`
 *   mode); unknown-shape and one-shot children are never recovered.
 * - `max-tokens` is the only automatic recovery trigger.
 * - Errors are never auto-retried; they are reported only as a recovery-chain
 *   failure (once).
 * - Normal completion, clean abort, refusal, and unknown future stop reasons
 *   (merge-extensible enums) are untouched.
 * - No UI, no dashboard, no persistence of the plugin's own, no second LLM.
 *
 * Continue-once guard (verified design — docs/DSH-SEAMS.md § "v0.1
 * continue-once guard"):
 * - Identity: the child's DURABLE session id (stable across activation epochs;
 *   each epoch mints a fresh runId, so runId cannot key the guard).
 * - Process-lifetime state: an `engaged` set marks a chain whose one watchdog
 *   continuation was initiated; a `notified` set caps parent notices at one per
 *   chain per process. Both are consulted synchronously inside event handlers,
 *   so duplicate or repeated events cannot re-trigger.
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
export const name = 'dsh-subagent-watchdog'

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

/**
 * `followup` requires a cancellation signal; the watchdog intentionally cannot
 * cancel its own single recovery. In a host realm use a real never-aborted
 * controller; in the dynamic-package sandbox (no AbortController global) supply
 * the minimal never-aborting AbortSignal view every consumer reads
 * (`aborted`, `throwIfAborted`, `addEventListener`, `removeEventListener`).
 */
function neverAbortSignal() {
	if (typeof AbortController === 'function') return new AbortController().signal
	const listenerStub = () => {}
	return {
		aborted: false,
		reason: undefined,
		throwIfAborted() {},
		addEventListener: listenerStub,
		removeEventListener: listenerStub,
	}
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

/** The Cordis plugin. Registers listeners inside `apply` so Cordis owns disposal. */
export function apply(ctx) {
	const subagents = ctx.get('subagents')
	// Nothing to observe on compositions without the host-plane registry.
	if (subagents === undefined) return

	const warn = (...parts) => {
		try {
			const line = ['[dsh-subagent-watchdog]', ...parts.map((part) => String(part))].join(' ')
			if (typeof console !== 'undefined') console.warn(line)
		} catch { /* containment: a logging failure must never escape a listener */ }
	}

	/**
	 * Scalar-only per-child fold: childId ->
	 * { parentSessionId?, mode?, lastTurnEnd? }.
	 */
	const children = new Map()
	/** Chains whose single watchdog continuation was initiated (process lifetime). */
	const engaged = new Set()
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
	async function inspectDurable(childId) {
		const persistence = ctx.get('sessionPersistence')
		if (persistence === undefined || typeof persistence.inspect !== 'function') {
			return { mode: undefined, continued: false }
		}
		const inspection = await persistence.inspect(childId, neverAbortSignal())
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

			// Guard fast path: this chain already had its one continuation (or a
			// sibling settlement just engaged it). A recovery attempt that fails
			// again — max-tokens or explicit error — reaches the parent once.
			if (engaged.has(childId)) {
				if (stopReason === 'max-tokens' || stopReason === 'error') {
					notifyOnce(parentSessionId, childId, stopReason, consumeFailure(child))
				}
				return
			}

			// Provider/runtime errors are never auto-retried in v0.1; an error as
			// the FIRST observed terminal outcome is left to the runtime's own
			// settlement notice.
			if (stopReason !== 'max-tokens') return

			// Engage synchronously so duplicate/repeated settlements can never
			// initiate a second continuation, then verify durability off-thread.
			engaged.add(childId)
			Promise.resolve()
				.then(async () => {
					// Restart-safe verification against the child's own durable
					// log: confirmed continuable mode, and no prior watchdog
					// continuation marker.
					const durable = await inspectDurable(childId)
					if (durable.mode !== 'continuable' && mode !== 'continuable') {
						// The budget was not spent; release the slot so a later
						// epoch can decide again with better information.
						engaged.delete(childId)
						warn(`child ${childId} is not verifiably continuable; recovery skipped`)
						return
					}
					if (durable.continued) {
						// Restart safety: this child's own durable log already
						// carries a watchdog continuation — never send another.
						warn(`child ${childId} already carries a watchdog continuation; not continuing again`)
						notifyOnce(parentSessionId, childId, stopReason, consumeFailure(child))
						return
					}
					const parent = ctx.get('agents')?.get(parentSessionId)
					if (parent === undefined) {
						// No authorized channel exists right now; release the slot
						// (a later epoch may find the parent live again).
						engaged.delete(childId)
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
							signal: neverAbortSignal(),
						})
					} catch (error) {
						// The attempt stands (mark-before-act): this chain keeps
						// its one slot even though nothing was received.
						warn(`continuation delivery to child ${childId} failed:`, error)
						notifyOnce(parentSessionId, childId, stopReason, consumeFailure(child), 'delivery-failed')
					}
				})
				.catch((error) => {
					warn(`recovery decision for child ${childId} failed:`, error)
					notifyOnce(parentSessionId, childId, stopReason, consumeFailure(child), 'delivery-failed')
				})
		} catch (error) {
			warn('subagent/end handler failed:', error)
		}
	})
}

export default { name, apply }
