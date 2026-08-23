/**
 * Acceptance tests for dsh-subagent-watchdog v0.1 (auto-continue-once scope).
 *
 * Method: the watchdog plugin is exercised on the REAL runtime pieces it
 * targets — `@deepseek-ai/cordis` event dispatch (with scope-carrier
 * filtering), `@deepseek-ai/dsh-subagent`'s `SubagentRuntime` lifecycle
 * emitter (`observeRun`, one-shot path), and `@deepseek-ai/dsh-session`'s
 * live `SessionStore` whose appends drive real `session/event` feeds. Only
 * two things are scripted:
 *
 * 1. The model loop: a fake provider returns runs whose results settle like
 *    the in-process drivers do; durable child events (`subagent/descriptor`,
 *    `turn/end`) are appended to the child's REAL session with payload shapes
 *    taken verbatim from the installed sources.
 * 2. The recovery seam: `subagents.followup` is spied on the real service
 *    instance, because driving the real continuation would require full agent
 *    materialization (persistence + agents.resume). The spy records the exact
 *    (parent, childId, content, options) the plugin passes; the real seam's
 *    cold-resume/queue behavior was verified against source and live probes
 *    (docs/DSH-SEAMS.md).
 *
 * Continuable-epoch note: continuable lifecycle edges come from the
 * continuation manager's Activation observer. The edges flow through the SAME
 * `createLifecycleEmitter` dispatch as one-shot runs, so scenarios drive
 * identical edges through a provider while folding a `mode: 'continuable'`
 * descriptor — outside the watchdog's observable surface, who triggers an
 * epoch is indistinguishable.
 *
 * Every scenario runs against BOTH distribution artifacts:
 *   - lib/index.js (the packaged ESM module), and
 *   - plugin/watchdog.host.js (the dynamic `cordis_define` body).
 *
 * Runtime under test: the installed DSH checkout this deployment serves
 * (`DSH_RUNTIME_ROOT` env overrides; defaults to the npx cache of
 * @deepseek-ai/dsh 0.1.1-rc.2).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const DSH_ROOT = process.env.DSH_RUNTIME_ROOT
	?? join(process.env.HOME ?? '', '.npm/_npx/2ede61d9d1d3d32e/node_modules')

async function importRuntime(pkg) {
	return import(pathToFileURL(join(DSH_ROOT, '@deepseek-ai', pkg, 'lib', 'index.js')).href)
}

const [{ Context, Service }, dshSessionModule, dshSubagentModule] = await Promise.all([
	importRuntime('cordis'),
	importRuntime('dsh-session'),
	importRuntime('dsh-subagent'),
])
const SessionStore = dshSessionModule.default
const { NO_START_CAPABILITIES, SubagentRuntime } = dshSubagentModule

/** The two artifacts under test. */
const artifacts = [
	{
		id: 'package',
		load: async () => (await import('../lib/index.js')).default,
		source: () => readFileSync(join(repoRoot, 'lib', 'index.js'), 'utf8'),
	},
	{
		id: 'dynamic',
		load: async () => {
			const code = readFileSync(join(repoRoot, 'plugin', 'watchdog.host.js'), 'utf8')
			// The sandbox evaluates the body inside a vm context; new Function is
			// the closest host-realm equivalent (plain body → plugin object).
			return new Function(code)()
		},
		source: () => readFileSync(join(repoRoot, 'plugin', 'watchdog.host.js'), 'utf8'),
	},
]

/** A stub parent Agent exposing only what the watchdog may touch. */
function makeAgent(id, status = 'idle') {
	return {
		id,
		status,
		calls: [],
		followup(message) {
			this.calls.push({ verb: 'followup', message })
		},
		steer(message) {
			this.calls.push({ verb: 'steer', message })
		},
		inject(message) {
			this.calls.push({ verb: 'inject', message })
		},
	}
}

class AgentsStub extends Service {
	constructor(ctx) {
		super(ctx, 'agents')
		this.map = new Map()
	}

	register(agent) {
		this.map.set(agent.id, agent)
	}

	get(id) {
		return this.map.get(id)
	}
}

/**
 * Build one isolated host: real Context, real sessions store, real subagent
 * runtime, stub agents service, the artifact mounted at the root (exactly
 * where dynamic plugins hang), and a scripted one-shot provider.
 */
async function makeHost(t, { persistenceEvents } = {}) {
	const root = new Context()
	t.after(() => root.fiber.dispose())

	class Sessions extends SessionStore {}
	await root.plugin(Sessions)
	class Agents extends AgentsStub {}
	await root.plugin(Agents)

	// Optional durable-log seam for the guard's restart-safety scan.
	if (persistenceEvents !== undefined) {
		root.provide('sessionPersistence', {
			inspectCalls: [],
			async inspect(id) {
				this.inspectCalls.push(id)
				return { meta: {}, events: persistenceEvents(id) }
			},
		})
	}

	await root.plugin(SubagentRuntime)

	const harness = {
		root,
		sessions: root.get('sessions'),
		subagents: root.get('subagents'),
		agentsStore: root.get('agents'),
		followupCalls: [],
		nextChild: 0,
		nextEpoch: 0,
	}

	// Spy on the official recovery seam; the real implementation needs full
	// agent materialization (see file header). Recording the exact arguments is
	// what the acceptance criteria observe.
	harness.subagents.followup = async (parent, childId, content, options) => {
		harness.followupCalls.push({ parent, childId, content, options })
		return `inbox-${harness.followupCalls.length}`
	}

	harness.subagents.registerProvider({
		name: 'scripted-base',
		capabilities: NO_START_CAPABILITIES,
		inheritsParentContext: false,
		start: async () => {
			throw new Error('use spawnOneShot for scripted children')
		},
	})

	return harness
}

/** Spawn one scripted child whose durable events land in its REAL session. */
function spawnOneShot(harness, parent, plan) {
	const childId = `child-${++harness.nextChild}`
	const session = harness.sessions.create(childId, {
		meta: {
			cwd: repoRoot,
			parentSession: parent.id,
			origin: 'subagent',
			delegationDepth: 1,
			createdAt: Date.now(),
		},
	})
	const run = runEpochOnSession(harness, parent, session, childId, plan)
	return { childId, session, ...run }
}

/**
 * Run one more activation epoch of an EXISTING child: same durable session id
 * (the guard's identity), fresh provider/run (fresh runId), as the continuation
 * manager does across cold resumes.
 */
function spawnEpoch(harness, parent, session, plan) {
	const childId = session.id
	return runEpochOnSession(harness, parent, session, childId, plan)
}

function runEpochOnSession(harness, parent, session, childId, plan) {
	let settleResult
	const result = new Promise((resolve, reject) => {
		settleResult = { resolve, reject }
	})
	harness.subagents.registerProvider({
		name: `scripted-${childId}-${harness.nextEpoch++}`,
		capabilities: NO_START_CAPABILITIES,
		inheritsParentContext: false,
		start: async () => {
			for (const event of plan.events ?? []) session.append(event.type, event.data)
			return { id: childId, output: [], result }
		},
	})
	const run = harness.subagents.start(`scripted-${childId}-${harness.nextEpoch - 1}`, {
		label: plan.label ?? 'scripted child',
		prompt: [],
		parent,
		signal: new AbortController().signal,
	})
	return {
		settle(stopReason) {
			settleResult.resolve({ stopReason, output: [] })
		},
		fail(error) {
			settleResult.reject(error)
		},
		ensureStarted: run.then(() => undefined),
	}
}

const turnEnd = (reason, turn = 1) => ({ type: 'turn/end', data: { turn, reason } })
const descriptor = (mode) => ({
	type: 'subagent/descriptor',
	data: { version: 2, mode, provider: 'scripted' },
})
/** A durable watchdog continuation marker, as followup delivery records it. */
const continuationMarker = (turn = 0) => ({
	type: 'user/message',
	data: {
		id: `inbox-marker-${turn}`,
		role: 'user',
		content: [{ type: 'text', text: '[watchdog] …continue…' }],
		source: { kind: 'subagent-watchdog', form: 'relay', senderSessionId: 'parent-1' },
	},
})

/** Drain microtasks so async guard decisions settle before assertions. */
const settleAsync = () => new Promise((resolve) => setImmediate(resolve))

for (const artifact of artifacts) {
	test(`[${artifact.id}] AC1: continuable max-tokens → exactly one auto-continuation via followup`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		const child = spawnOneShot(h, parent, {
			events: [descriptor('continuable'), turnEnd({ kind: 'max-tokens' })],
		})
		await child.ensureStarted
		child.settle('max-tokens')
		await settleAsync()

		assert.equal(h.followupCalls.length, 1, 'exactly one watchdog continuation')
		const call = h.followupCalls[0]
		assert.equal(call.parent, parent, 'authorized by the delegating parent object')
		assert.equal(call.childId, child.childId)
		const instruction = call.content[0].text
		assert.ok(instruction.includes('[watchdog]'), 'instruction is [watchdog]-tagged')
		assert.ok(/max-tokens/i.test(instruction), 'names the failure reason')
		assert.ok(/continue/i.test(instruction), 'asks the child to continue its task')
		assert.equal(call.options.source.kind, 'subagent-watchdog', 'tagged for the durable guard marker')
		assert.equal(call.options.source.form, 'relay')
		assert.equal(typeof call.options.signal?.throwIfAborted, 'function', 'passes a cancellation signal')
		// The runtime's settlement notice covers continuable parents; no extra notice.
		assert.deepEqual(parent.calls, [], 'no parent notice on a successful single continuation')
	})

	test(`[${artifact.id}] AC2: second max-tokens epoch → no second continuation, exactly one parent notice`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		const first = spawnOneShot(h, parent, {
			events: [descriptor('continuable'), turnEnd({ kind: 'max-tokens' })],
		})
		await first.ensureStarted
		first.settle('max-tokens')
		await settleAsync()
		assert.equal(h.followupCalls.length, 1)
		assert.deepEqual(parent.calls, [])

		// The recovered activation (same child, new epoch) ends in max-tokens.
		const second = spawnEpoch(h, parent, first.session, {
			events: [turnEnd({ kind: 'max-tokens' }, 2)],
		})
		await second.ensureStarted
		second.settle('max-tokens')
		await settleAsync()

		assert.equal(h.followupCalls.length, 1, 'never continued twice')
		assert.equal(parent.calls.length, 1, 'the parent is notified once')
		const text = parent.calls[0].message.content[0].text
		assert.ok(text.startsWith('[watchdog]'))
		assert.ok(text.includes(first.childId), 'names the child')
		assert.ok(text.includes('max-tokens'), 'reports the repeat failure class')
		assert.ok(text.includes('No further automatic recovery'), 'states it will stop intervening')
		assert.equal(parent.calls[0].message.source.kind, 'subagent-watchdog')
		assert.equal(parent.calls[0].message.source.form, 'notice')

		// A third failing epoch must not re-notify either.
		const third = spawnEpoch(h, parent, first.session, {
			events: [turnEnd({ kind: 'max-tokens' }, 3)],
		})
		await third.ensureStarted
		third.settle('max-tokens')
		await settleAsync()
		assert.equal(h.followupCalls.length, 1)
		assert.equal(parent.calls.length, 1, 'notice stays once per chain per process')
	})

	test(`[${artifact.id}] AC3: successful resumed child completes normally — nothing further happens`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		const first = spawnOneShot(h, parent, {
			events: [descriptor('continuable'), turnEnd({ kind: 'max-tokens' })],
		})
		await first.ensureStarted
		first.settle('max-tokens')
		await settleAsync()

		// Recovery activation completes cleanly.
		const second = spawnEpoch(h, parent, first.session, {
			events: [turnEnd({ kind: 'completed' }, 2)],
		})
		await second.ensureStarted
		second.settle('completed')
		await settleAsync()

		assert.equal(h.followupCalls.length, 1, 'only the original continuation')
		assert.deepEqual(parent.calls, [], 'no notice after normal completion')
	})

	test(`[${artifact.id}] AC4: recovery ends in explicit error → one notice carrying LlmFailure.code, no retry`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		const first = spawnOneShot(h, parent, {
			events: [descriptor('continuable'), turnEnd({ kind: 'max-tokens' })],
		})
		await first.ensureStarted
		first.settle('max-tokens')
		await settleAsync()
		assert.equal(h.followupCalls.length, 1)

		const second = spawnEpoch(h, parent, first.session, {
			events: [
				turnEnd({
					kind: 'error',
					error: { message: 'auth rejected by provider', code: 'AUTH', status: '401' },
				}, 2),
			],
		})
		await second.ensureStarted
		second.settle('error')
		await settleAsync()

		assert.equal(h.followupCalls.length, 1, 'errors are never auto-retried')
		assert.equal(parent.calls.length, 1, 'exactly one failure notice')
		const text = parent.calls[0].message.content[0].text
		assert.ok(text.includes('AUTH'), 'carries the structured code')
		assert.ok(text.includes('401'), 'carries the status')
		assert.ok(text.includes('error'), 'names the terminal reason')
	})

	test(`[${artifact.id}] AC5: provider/runtime errors are never auto-continued`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		const child = spawnOneShot(h, parent, {
			events: [
				descriptor('continuable'),
				turnEnd({ kind: 'error', error: { code: 'RATE_LIMIT', message: 'slow down' } }),
			],
		})
		await child.ensureStarted
		child.settle('error')
		await settleAsync()

		assert.equal(h.followupCalls.length, 0, 'no automatic recovery for errors')
		assert.deepEqual(parent.calls, [], 'first-observed errors stay with the runtime settlement notice')
	})

	test(`[${artifact.id}] AC6: one-shot subagents are never recovered`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		const child = spawnOneShot(h, parent, {
			events: [descriptor('one-shot'), turnEnd({ kind: 'max-tokens' })],
		})
		await child.ensureStarted
		child.settle('max-tokens')
		await settleAsync()
		assert.equal(h.followupCalls.length, 0, 'no resume seam exists for one-shot children')
		assert.deepEqual(parent.calls, [])
	})

	test(`[${artifact.id}] AC7a: unknown-shape child fails closed (no descriptor → no recovery)`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		const child = spawnOneShot(h, parent, {
			events: [turnEnd({ kind: 'max-tokens' })],
		})
		await child.ensureStarted
		child.settle('max-tokens')
		await settleAsync()
		assert.equal(h.followupCalls.length, 0, 'unverifiable mode → fail closed')
		assert.deepEqual(parent.calls, [])
	})

	test(`[${artifact.id}] AC7b: completion, abort, refusal, unknown stop reasons untouched`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		for (const [reason, stop] of [
			[{ kind: 'completed' }, 'completed'],
			[{ kind: 'aborted', reason: 'parent' }, 'aborted'],
			[{ kind: 'blocked' }, 'refusal'],
			[{ kind: 'something-new' }, 'something-new'],
		]) {
			const child = spawnOneShot(h, parent, {
				events: [descriptor('continuable'), turnEnd(reason)],
			})
			await child.ensureStarted
			child.settle(stop)
		}
		await settleAsync()
		assert.equal(h.followupCalls.length, 0, 'non-max-tokens terminations are untouched')
		assert.deepEqual(parent.calls, [])
	})

	test(`[${artifact.id}] AC8: restart-safe guard — durable marker prevents a second continuation and notifies once`, async (t) => {
		// Fresh process: the child's durable log already carries the descriptor
		// and marker from a previous process's continuation. The live session is
		// created WITHOUT those events (a restored log does not replay through
		// session/event), so classification must come from the durable read.
		const h = await makeHost(t, {
			persistenceEvents: () => [
				descriptor('continuable'),
				continuationMarker(),
				turnEnd({ kind: 'completed' }, 2),
			],
		})
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		const child = spawnOneShot(h, parent, { events: [] })
		await child.ensureStarted
		child.session.append('turn/end', { turn: 5, reason: { kind: 'max-tokens' } })
		child.settle('max-tokens')
		await settleAsync()

		assert.equal(h.followupCalls.length, 0, 'durable marker blocks a second continuation')
		assert.ok(
			h.root.get('sessionPersistence').inspectCalls.includes(child.childId),
			'guard consulted the child’s own durable log',
		)
		assert.equal(parent.calls.length, 1, 'the still-failing already-recovered chain notifies once')
		const text = parent.calls[0].message.content[0].text
		assert.ok(text.includes(child.childId))
		assert.ok(text.includes('No further automatic recovery'))
	})

	test(`[${artifact.id}] AC9: duplicate end delivery engages the guard only once`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		const child = spawnOneShot(h, parent, {
			events: [descriptor('continuable'), turnEnd({ kind: 'max-tokens' })],
		})
		await child.ensureStarted
		child.settle('max-tokens')
		// Pathological duplicate settlement for the same epoch.
		child.settle('max-tokens')
		await settleAsync()
		assert.equal(h.followupCalls.length, 1, 'duplicate delivery cannot double-continue')
		assert.deepEqual(parent.calls, [])
	})

	test(`[${artifact.id}] AC10: failed followup keeps the chain engaged without a second attempt`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'idle')
		h.agentsStore.register(parent)

		h.subagents.followup = async () => {
			throw new Error('continuable subagents are draining; the operation was not admitted')
		}

		const first = spawnOneShot(h, parent, {
			events: [descriptor('continuable'), turnEnd({ kind: 'max-tokens' })],
		})
		await first.ensureStarted
		first.settle('max-tokens')
		await settleAsync()

		// The delivery failed inside the engaged decision; the chain remains
		// guarded, so a later epoch cannot sneak another continuation try.
		const second = spawnOneShot(h, parent, {
			events: [turnEnd({ kind: 'max-tokens' }, 2)],
		})
		await second.ensureStarted
		second.settle('max-tokens')
		await settleAsync()
		assert.equal(h.followupCalls.length, 0, 'still at most one attempted continuation')
	})

	test(`[${artifact.id}] absent parent → contained skip, no crash`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const gone = makeAgent('parent-gone', 'idle') // never registered

		const child = spawnOneShot(h, gone, {
			events: [descriptor('continuable'), turnEnd({ kind: 'max-tokens' })],
		})
		await child.ensureStarted
		child.settle('max-tokens')
		await settleAsync()
		assert.equal(gone.calls.length, 0)
		assert.equal(h.followupCalls.length, 0)
		assert.equal(h.nextChild, 1, 'handler survived without a live parent')
	})

	test(`[${artifact.id}] running parent receives the failure notice via steer`, async (t) => {
		const h = await makeHost(t)
		await h.root.plugin(await artifact.load())
		const parent = makeAgent('parent-1', 'running')
		h.agentsStore.register(parent)

		const first = spawnOneShot(h, parent, {
			events: [descriptor('continuable'), turnEnd({ kind: 'max-tokens' })],
		})
		await first.ensureStarted
		first.settle('max-tokens')
		await settleAsync()

		const second = spawnEpoch(h, parent, first.session, {
			events: [turnEnd({ kind: 'max-tokens' }, 2)],
		})
		await second.ensureStarted
		second.settle('max-tokens')
		await settleAsync()

		assert.equal(parent.calls.length, 1)
		assert.equal(parent.calls[0].verb, 'steer', 'running parent is steered, not followed-up')
	})
}

test('both artifacts register no tools, UI, or timers', () => {
	for (const artifact of artifacts) {
		const source = artifact.source()
		for (const forbidden of ['defineTool', 'registerTool', "slots", 'setTimeout(', 'setInterval(', 'require(', 'import(', 'fetch(']) {
			assert.ok(!source.includes(forbidden), `${artifact.id} must not use ${forbidden}`)
		}
	}
})

test('dynamic artifact is byte-derived from the packaged module', async () => {
	const { execFileSync } = await import('node:child_process')
	execFileSync(process.execPath, ['scripts/sync-dynamic.mjs'], { cwd: repoRoot })
	const regenerated = readFileSync(join(repoRoot, 'plugin', 'watchdog.host.js'), 'utf8')
	const before = artifacts[1].source()
	assert.equal(regenerated, before, 'plugin/watchdog.host.js must be regenerated via scripts/sync-dynamic.mjs')
})
