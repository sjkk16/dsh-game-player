import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWatchController, createImageDemand, WATCH_DISABLED_STATE, isLegacyWatchMessage } from '../src/watch.js'
import { Config, apply, resolveConfig } from '../index.js'
import toolContract from './tool-contract-0.2.2.fixture.mjs'
import { screenTool } from '../src/tools.js'

function context(agents = []) {
  const handlers = new Map(), effects = [], timers = [], tools = [], warnings = []
  let closed = false
  return {
    handlers, effects, timers, registered: tools, warnings, logger: { warn(message) { warnings.push(message) } },
    on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) },
    effect(fn) { const dispose = fn(); effects.push(dispose); return dispose },
    interval(fn) { const timer = { fn, stopped: false }; timers.push(timer); return () => { timer.stopped = true } },
    setInterval(fn) { return this.interval(fn) },
    inject(_deps, fn) { fn({ agents: { list: () => [...agents] }, systemPrompt: { section: section => { this.prompt = section.text } } }) },
    tools: { register(tool) { tools.push(tool); return () => { const at = tools.indexOf(tool); if (at >= 0) tools.splice(at, 1) } } },
    attachments: { async saveImage({ data, mediaType }) { return { attachmentId: 'a', mediaType, bytes: data.length, width: 20, height: 10 } } },
    async dispose() { if (closed) return; closed = true; for (const fn of [...effects].reverse()) await fn?.(); handlers.clear() },
  }
}
const options = { maxWidth: 1280, jpegQuality: 60, monitor: 'primary' }
const notice = (agent, sequence) => ({ id: 'game-watch:old-run:watch:' + agent + ':1#' + sequence, role: 'user', source: { kind: 'game-watch' }, content: [{ type: 'text', text: '[game-watch] synthetic change' }] })
const user = id => ({ id, role: 'user', source: { kind: 'human' }, content: [{ type: 'text', text: 'keep this message' }] })
function publicInbox(turn = [], step = []) {
  const lists = { 'next-turn': [...turn], 'next-step': [...step] }, removals = [], durable = []
  let clears = 0
  return {
    lists, removals, durable,
    get nextTurn() { return Object.freeze([...lists['next-turn']]) },
    get nextStep() { return Object.freeze([...lists['next-step']]) },
    remove(id) {
      for (const target of ['next-turn', 'next-step']) {
        const at = lists[target].findIndex(message => message.id === id)
        if (at < 0) continue
        removals.push(id); lists[target].splice(at, 1)
        durable.push({ type: 'agent/inbox/spliced', data: { target, start: at, removedCount: 1, inserted: [] } })
        return true
      }
      return false
    },
    clear() { clears++; throw Error('Whole-inbox clearing is forbidden') },
    get clearCalls() { return clears },
  }
}
const agentWith = (id, inbox) => ({ id, inbox, ctx: context(), followup() { throw Error('No automatic followup may be sent') } })
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description').map(([key, item]) => [key, canonical(item)])) : value

// The legacy 13/3-message backlog must be removed, not merged into more turns.
test('reload clears 13 and 3 owned queued notices and preserves all other messages and history', async () => {
  const aNotices = Array.from({ length: 13 }, (_, i) => notice('a', i + 1)), bNotices = Array.from({ length: 3 }, (_, i) => notice('b', i + 1))
  const foreign = [user('ordinary'), { ...user('game-watch:human-prefix'), content: [{ type: 'text', text: '[game-watch] is only quoted here' }] }, { ...notice('foreign', 1), source: { kind: 'another-plugin' } }, { ...notice('foreign', 2), id: 'other-prefix' }]
  const inboxA = publicInbox([foreign[0], ...aNotices.slice(0, 11), foreign[1]], [foreign[2], ...aNotices.slice(11), foreign[3]])
  const inboxB = publicInbox([user('b-user'), ...bNotices.slice(0, 2)], bNotices.slice(2))
  const a = agentWith('a', inboxA), b = agentWith('b', inboxB), history = [notice('claimed', 1)], preservedHistory = structuredClone(history)
  a.history = history
  const ctx = context([a, b]), demand = createImageDemand(); demand.mark('a'); const token = demand.current('a')
  const before = structuredClone(foreign), watch = createWatchController({ ctx, imageDemand: demand, warn: ctx.logger.warn })
  assert.equal(inboxA.removals.length, 13); assert.equal(inboxB.removals.length, 3)
  assert.deepEqual(inboxA.nextTurn, foreign.slice(0, 2)); assert.deepEqual(inboxA.nextStep, foreign.slice(2)); assert.deepEqual(inboxB.nextTurn, [user('b-user')]); assert.deepEqual(inboxB.nextStep, [])
  assert.deepEqual(foreign, before); assert.deepEqual(history, preservedHistory); assert.equal(demand.current('a'), token)
  assert.equal(inboxA.clearCalls + inboxB.clearCalls, 0); assert.equal(inboxA.durable.length + inboxB.durable.length, 16)
  assert.deepEqual(watch.status(a), WATCH_DISABLED_STATE); assert.deepEqual(watch.status(b), WATCH_DISABLED_STATE)
  await ctx.dispose(); await a.ctx.dispose(); await b.ctx.dispose()
})

test('created/restored agents have their legacy pending queues cleaned before loop use', async () => {
  const ctx = context(), watch = createWatchController({ ctx, warn: ctx.logger.warn }), inbox = publicInbox([user('keep'), notice('restored', 1)])
  const agent = agentWith('restored', inbox)
  ctx.handlers.get('agent/created')({ agent })
  assert.deepEqual(inbox.nextTurn, [user('keep')]); assert.equal(inbox.removals.length, 1); assert.deepEqual(watch.status(agent), WATCH_DISABLED_STATE)
  await agent.ctx.dispose(); await ctx.dispose()
})

test('repeated reload/start/stop/status is idempotent and disposed callbacks cannot clean new state', async () => {
  const inbox = publicInbox([notice('a', 1), user('keep')]), agent = agentWith('a', inbox), firstCtx = context([agent])
  const first = createWatchController({ ctx: firstCtx, warn() {} }); const oldCreated = firstCtx.handlers.get('agent/created')
  for (let i = 0; i < 50; i++) { first.start(agent); first.stop(agent); first.status(agent) }
  assert.equal(inbox.removals.length, 1)
  await firstCtx.dispose(); inbox.lists['next-turn'].push(notice('a', 2)); oldCreated({ agent }); first.start(agent)
  assert.equal(inbox.removals.length, 1)
  const secondCtx = context([agent]); createWatchController({ ctx: secondCtx, warn() {} })
  assert.equal(inbox.removals.length, 2); assert.deepEqual(inbox.nextTurn, [user('keep')])
  await secondCtx.dispose(); await agent.ctx.dispose()
})

test('disabled controller never captures, schedules, sends followups or reads old watcher settings', async () => {
  const ctx = context(), agent = agentWith('a', publicInbox()), demand = createImageDemand(); let captures = 0, followups = 0, oldReads = 0
  agent.followup = () => { followups++ }
  const oldOptions = {}; for (const key of ['watchIntervalMs', 'watchThreshold', 'watchMaxWakes']) Object.defineProperty(oldOptions, key, { get() { oldReads++; throw Error('No old setting reads') } })
  const watch = createWatchController({ ctx, options: oldOptions, imageDemand: demand, capture: async () => { captures++; return { diff: .9 } }, warn() {} })
  for (let i = 0; i < 100; i++) { assert.deepEqual(watch.start(agent, { intervalMs: 200, threshold: .001, maxWakes: 50 }), WATCH_DISABLED_STATE); watch.stop(agent); watch.status(agent) }
  assert.equal(captures, 0); assert.equal(followups, 0); assert.equal(oldReads, 0); assert.equal(ctx.timers.length, 0); assert.equal(agent.ctx.timers.length, 0); assert.equal(demand.current('a'), undefined)
  const altered = watch.status(agent); altered.running = true; altered.wakes = 50; assert.deepEqual(watch.status(agent), WATCH_DISABLED_STATE); assert.equal(Object.isFrozen(WATCH_DISABLED_STATE), true)
  await ctx.dispose(); await agent.ctx.dispose()
})

test('late synthetic capture resolution after disposal cannot enqueue a notice', async () => {
  const ctx = context(), agent = agentWith('a', publicInbox()); let resolveFrame, captures = 0, followups = 0
  const frame = new Promise(resolve => { resolveFrame = resolve }); agent.followup = () => { followups++ }
  const watch = createWatchController({ ctx, capture: () => { captures++; return frame }, warn() {} })
  watch.start(agent); await ctx.dispose(); resolveFrame({ diff: 1 }); await frame; await Promise.resolve()
  assert.equal(captures, 0); assert.equal(followups, 0); assert.deepEqual(watch.status(agent), WATCH_DISABLED_STATE); assert.equal(ctx.handlers.size, 0)
  await agent.ctx.dispose()
})

test('ownership requires exact source kind and the complete plugin ID prefix', () => {
  assert.equal(isLegacyWatchMessage(notice('a', 1)), true)
  for (const message of [null, undefined, user('game-watch:quoted'), { id: 'game-watch:fake', source: { kind: 'game-watch-other' } }, { id: 'game-watch', source: { kind: 'game-watch' } }, { id: 7, source: { kind: 'game-watch' } }, { source: { kind: 'game-watch' } }]) assert.equal(isLegacyWatchMessage(message), false)
})

test('cleanup revalidates identity after reentrant removal callbacks replace another item', async () => {
  const first = notice('a', 1), second = notice('a', 2), inbox = publicInbox([first, second]), agent = agentWith('a', inbox)
  const originalRemove = inbox.remove.bind(inbox)
  inbox.remove = id => { const result = originalRemove(id); if (id === first.id) inbox.lists['next-turn'][0] = { ...second, source: { kind: 'human' } }; return result }
  const ctx = context([agent]); createWatchController({ ctx, warn() {} })
  assert.deepEqual(inbox.removals, [first.id]); assert.equal(inbox.nextTurn.length, 1); assert.equal(inbox.nextTurn[0].source.kind, 'human'); assert.equal(inbox.clearCalls, 0)
  await ctx.dispose(); await agent.ctx.dispose()
})

test('already claimed notices are not removed again or reintroduced into history', async () => {
  const message = notice('a', 1), inbox = publicInbox([message]), agent = agentWith('a', inbox), ctx = context([agent]); let removeCalls = 0
  inbox.remove = () => { removeCalls++; inbox.lists['next-turn'] = []; return false }
  const watch = createWatchController({ ctx, warn() {} }); watch.status(agent)
  assert.equal(removeCalls, 1); assert.deepEqual(inbox.nextTurn, []); assert.equal(inbox.durable.length, 0)
  await ctx.dispose(); await agent.ctx.dispose()
})

test('missing safe queue APIs stop new notices and warn once without whole-inbox clearing', async () => {
  const ctx = context(), pending = [notice('a', 1), user('keep')]; let clears = 0
  const agent = agentWith('a', { nextTurn: Object.freeze(pending), nextStep: Object.freeze([]), clear() { clears++ } })
  const watch = createWatchController({ ctx, warn: ctx.logger.warn })
  for (let i = 0; i < 10; i++) { assert.deepEqual(watch.start(agent), WATCH_DISABLED_STATE); watch.stop(agent); watch.status(agent) }
  assert.equal(ctx.warnings.length, 1); assert.match(ctx.warnings[0], /safe message removal/); assert.equal(pending.length, 2); assert.equal(clears, 0); assert.equal(ctx.timers.length, 0)
  await ctx.dispose(); await agent.ctx.dispose()
})

test('unreadable or failed queue removal never clears other input or spams warnings', async () => {
  for (const failAt of ['read', 'remove']) {
    const inbox = publicInbox([notice('a', 1), user('keep')]), ctx = context()
    if (failAt === 'read') Object.defineProperty(inbox, 'nextTurn', { get() { throw Error('Read failed') } })
    else inbox.remove = () => { throw Error('Removal failed') }
    const agent = agentWith('a', inbox), watch = createWatchController({ ctx, warn: ctx.logger.warn })
    assert.deepEqual(watch.start(agent), WATCH_DISABLED_STATE); assert.deepEqual(watch.status(agent), WATCH_DISABLED_STATE)
    assert.equal(ctx.warnings.length, 1); assert.equal(inbox.lists['next-turn'].length, 2); assert.equal(inbox.clearCalls, 0)
    await ctx.dispose(); await agent.ctx.dispose()
  }
})

test('image-demand ownership and release remain independent of automatic monitoring', async () => {
  const ctx = context(), agent = agentWith('a', publicInbox()), demand = createImageDemand(), forgotten = []
  const watch = createWatchController({ ctx, imageDemand: demand, forget: id => forgotten.push(id), warn() {} })
  demand.mark('a'); demand.mark('other'); const token = demand.current('a'); watch.status(agent)
  assert.equal(demand.current('a'), token); assert.equal(forgotten.length, 0)
  await agent.ctx.dispose(); await Promise.resolve(); assert.equal(demand.current('a'), undefined); assert.ok(demand.current('other')); assert.deepEqual(forgotten, ['screen:a'])
  await ctx.dispose(); assert.equal(demand.current('other'), undefined)
})

test('removed configuration references and property getters are never evaluated', () => {
  let reads = 0; const warnings = [], keys = ['watchIntervalMs', 'watchThreshold', 'watchMaxWakes']
  const reference = { get() { reads++; throw Error('Legacy live reference must not be read') }, set() {} }
  const raw = { requireApproval: false, dryRun: reference }; for (const key of keys) raw[key] = reference
  const config = resolveConfig(raw, message => warnings.push(message))
  assert.equal(config.requireApproval, false); for (const key of [...keys, 'dryRun']) assert.equal(Object.hasOwn(config, key), false)
  const getters = {}; for (const key of [...keys, 'dryRun']) Object.defineProperty(getters, key, { enumerable: true, get() { reads++; throw Error('Legacy property must not be read') } })
  assert.doesNotThrow(() => resolveConfig(getters, message => warnings.push(message)))
  assert.equal(reads, 0); assert.deepEqual(warnings, []); for (const key of keys) assert.equal(Object.hasOwn(Config.dict, key), false)
})

test('explicit screenshots retain the 3% image gate without evaluating removed watcher settings', async () => {
  let reads = 0, attached = 0, nextDiff = .02
  const config = { ...options }; Object.defineProperty(config, 'watchThreshold', { get() { reads++; throw Error('Removed setting') } })
  const tool = screenTool({ options: config, capture: async () => ({ width: 10, height: 10, screenWidth: 20, screenHeight: 20, screenX: 0, screenY: 0, scale: .5, diff: nextDiff }), attach: async () => { attached++; return { attachmentId: 'synthetic' } } })
  const small = await tool.execute({}, {}); assert.equal(small.changed, false); assert.equal(small.attached, false)
  nextDiff = .03; const changed = await tool.execute({}, {}); assert.equal(changed.changed, true); assert.equal(changed.attached, true)
  nextDiff = 0; const forced = await tool.execute({ force: true }, {}); assert.equal(forced.changed, false); assert.equal(forced.attached, true)
  nextDiff = -1; assert.equal((await tool.execute({}, {})).attached, true)
  assert.equal(reads, 0); assert.equal(attached, 3)
})

test('all compatibility actions return fixed stopped receipts with zero helper/capture calls', async () => {
  const agent = agentWith('a', publicInbox([notice('a', 1)])), ctx = context([agent]); let helperRequests = 0, closes = 0
  apply(ctx, { overlayEnabled: false }, { bridgeFactory: () => ({ running: false, async request() { helperRequests++; throw Error('No helper for game_watch') }, async close() { closes++ }, async disposeOwner() { return true } }) })
  const tool = ctx.registered.find(tool => tool.name === 'game_watch')
  for (const action of ['start', 'stop', 'status']) {
    const value = await tool.execute({ action, target: 'window', intervalMs: 200, threshold: .001, maxWakes: 50 }, { agent })
    assert.deepEqual(value, WATCH_DISABLED_STATE); assert.match(tool.output.render({}, value)[0].text, /permanently disabled/)
  }
  assert.equal(helperRequests, 0); assert.equal(ctx.timers.length, 0); assert.equal(agent.ctx.timers.length, 0); assert.equal(agent.inbox.removals.length, 1)
  assert.match(ctx.prompt, /Automatic screen-change wakeups are permanently disabled/); assert.doesNotMatch(ctx.prompt, /use .game_watch. instead/)
  await ctx.dispose(); await agent.ctx.dispose(); assert.equal(helperRequests, 0); assert.equal(closes, 1)
})

test('five public tool shapes and concurrency defaults match the pinned 0.2.2 contract', async () => {
  const ctx = context()
  apply(ctx, { overlayEnabled: false }, { bridgeFactory: () => ({ running: false, async request() { throw Error('Contract checks never use input') }, async close() {} }) })
  const actual = ctx.registered.map(tool => ({ name: tool.name, parameters: canonical(tool.parameters), outputSchema: canonical(tool.output.schema), concurrencySafe: tool.isConcurrencySafe({}) }))
  assert.deepEqual(actual, toolContract)
  await ctx.dispose()
})

test('safe defaults, mocked host registration/attachments/prompt and approval denial never inject',async()=>{
  const ctx=context(), calls=[], releases=[]
  const bridge={running:true,request:async req=>{calls.push(req);return {ok:true,width:20,height:10,screenWidth:40,screenHeight:20,screenX:-20,screenY:-5,scale:.5,diff:1,data:Buffer.from('synthetic image').toString('base64'),mediaType:'image/jpeg'}},close:async()=>calls.push({op:'close'}),disposeOwner:async owner=>{releases.push(owner);return true}}
  const config=resolveConfig({},()=>{});assert.equal(Object.hasOwn(config,'dryRun'),false);assert.equal(config.requireApproval,true)
  apply(ctx,{overlayEnabled:false}, {bridgeFactory:()=>bridge})
  assert.equal(ctx.registered.length,5);assert.match(ctx.prompt,/screenX \+ round/)
  const screen=ctx.registered.find(t=>t.name==='game_screen')
  const value=await screen.execute({},{});assert.equal(value.image.attachmentId,'a')
  const input=ctx.registered.find(t=>t.name==='game_input')
  const gate=ctx.handlers.get('tools/pre-execute')
  assert.equal((await gate({name:'game_input'},async()=>({kind:'deny'}))).kind,'deny')
  assert.equal((await gate({name:'game_input'},async()=>({kind:'allow'}))).kind,'ask')
  assert.equal((await gate({name:'game_screen'},async()=>({kind:'allow'}))).kind,'allow')
  await assert.rejects(input.execute({kind:'key',keys:['w']},{}),/owning agent/)
  assert.equal(calls.filter(req=>req.op==='input').length,0)
  await ctx.dispose();assert.equal(ctx.registered.length,0)
})
test('mocked real-input path gets an agent owner and disposer releases only that owner',async()=>{
  const ctx=context(),agentCtx=context(),calls=[],released=[]
  const bridge={running:false,request:async req=>{calls.push(req);if(req.op==='window')return {window:{windowId:'1:1:1',valid:true,focused:true,minimized:false,client:{x:0,y:0,width:100,height:100}}};return {ok:true,heldKeys:[],heldButtons:[],cursor:{x:1,y:2}}},releaseAll:async()=>true,disposeOwner:async id=>released.push(id),close:async()=>{}}
  apply(ctx,{overlayEnabled:false}, {bridgeFactory:()=>bridge})
  const input=ctx.registered.find(t=>t.name==='game_input')
  await assert.rejects(input.execute({kind:'keydown',keys:['w']},{}),/owning agent/)
  const agent={id:'a',ctx:agentCtx}
  await assert.rejects(input.execute({kind:'keydown',keys:['w']},{agent}),/bound/)
  await ctx.registered.find(t=>t.name==='game_window').execute({action:'bind',windowId:'1:1:1'},{agent})
  await input.execute({kind:'keydown',keys:['w']},{agent})
  const sent=calls.find(req=>req.op==='input');assert.deepEqual(sent.actions[0].keys,['w']);assert.equal(sent.ownerId,1)
  await agentCtx.dispose();assert.deepEqual(released,[1]);await ctx.dispose()
})
