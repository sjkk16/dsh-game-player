import assert from 'node:assert/strict'
import { Config, resolveConfig, apply } from '../index.js'
import { PERSONA_LIMITS, emptyPersona, validatePersona, readPersona, compilePersona } from '../src/persona.js'
import { createSettingsHarness, collect, text } from './settings-fixture.mjs'

let checks = 0
const idA = '00000000-0000-4000-8000-000000000001'
const idB = '00000000-0000-4000-8000-000000000002'
const card = (id = idA, name = '星星', prompt = '活泼俏皮，但技术回答清楚准确。') => ({ id, name, prompt })
const state = (profiles = [card()], activeId = null, enabled = false) => ({ enabled, activeId, profiles })
const run = async (name, test) => {
  try { await test(); checks++ }
  catch (error) { throw new Error('Persona regression: ' + name + ': ' + error.message, { cause: error }) }
}
const uiRun = (name, test) => run(name, async () => {
  const h = createSettingsHarness()
  h.config.value.persona = emptyPersona()
  try { await test(h) } finally { h.close() }
})
const view = h => { h.render('PersonaControls', { controller: h.controller, state: h.config, t: h.props.t }); return h.render('PersonaControls', { controller: h.controller, state: h.config, t: h.props.t }) }
const control = (h, action, id) => collect(view(h), node => node.props?.['data-persona-action'] === action && (id === undefined || node.props['data-persona-id'] === id))[0]
const field = (h, name) => collect(view(h), node => node.props?.['data-persona-field'] === name)[0]
const click = async (h, action, id) => { const node = control(h, action, id); assert.ok(node, action); assert.equal(Boolean(node.props.disabled), false, action + ' is disabled'); const result = await node.props.onClick(); view(h); return result }
const edit = (h, key, value) => { field(h, key).props.onChange({ target: { value } }); view(h) }
const add = async (h, name, prompt = '温柔地交流。') => { await click(h, 'new'); edit(h, 'name', name); edit(h, 'prompt', prompt); await click(h, 'save'); return h.config.value.persona.profiles.at(-1).id }
const seed = h => { h.config.value.persona = state([card(), card(idB, '月亮', '冷静理性。')], idA, true); view(h) }

await run('default is disabled and old configs have no sample cards', () => {
  assert.deepEqual(Config({}).persona.get(), emptyPersona())
  assert.deepEqual(resolveConfig({}, () => {}).persona, emptyPersona())
  assert.equal(Config.dict.persona.meta.volatile, true)
  assert.equal(compilePersona(undefined), '')
  const defaults = resolveConfig({}, () => {}); defaults.persona.profiles.push(card())
  assert.deepEqual(resolveConfig({}, () => {}).persona, emptyPersona())
})
await run('profiles are detached and stable through JSON round trips', () => {
  const value = state([card()], idA, true), result = validatePersona(value)
  assert.deepEqual(validatePersona(JSON.parse(JSON.stringify(result))), value)
  result.profiles[0].name = 'changed'
  assert.equal(value.profiles[0].name, '星星')
  assert.equal(validatePersona(value).profiles[0].id, idA)
  assert.deepEqual(PERSONA_LIMITS, { name: 80, prompt: 8000 })
})
await run('invalid cards and active selections fail closed without partial injection', () => {
  const invalid = [null, [], {}, { ...state(), enabled: 'yes' }, state([card('not-a-uuid')]), state([card(), card()]), state([card(), card(idA.toUpperCase())]), state([card(idA, '  ')]), state([card(idA, 'x'.repeat(81))]), state([card(idA, 'ok', '\n\t')]), state([card(idA, 'ok', 'x'.repeat(8001))]), state([], idA, true), state([card()], idB, false)]
  for (const value of invalid) { assert.throws(() => validatePersona(value)); assert.deepEqual(readPersona(value), emptyPersona()); assert.equal(compilePersona(value), '') }
  assert.throws(() => Config({ persona: state([card(idA, 'x'.repeat(81))]) }))
  assert.throws(() => Config({ persona: state([card(idA, 'ok', 'x'.repeat(8001))]) }))
  const warnings = []
  assert.deepEqual(resolveConfig({ persona: state([], idA, true) }, message => warnings.push(message)).persona, emptyPersona())
  assert.equal(warnings.length, 1)
})
await run('prompt preserves literal variables and appends factual/approval boundaries', () => {
  const prompt = '名字是星星。\n{{do_not_resolve}}\n<card>保留原文</card>'
  const compiled = compilePersona(state([card(idA, '星星', prompt)], idA, true))
  assert.ok(compiled.includes(prompt)); assert.match(compiled, /human approval requirements/); assert.match(compiled, /fictional role setting/); assert.match(compiled, /technical answers clear and accurate/i)
  assert.equal(compilePersona(state([card()], idA, false)), '')
})

function hostFixture(initial = emptyPersona(), available = true) {
  let value = initial
  const handlers = new Map(), sections = new Map(), effects = [], tools = [], events = [], native = []
  const effect = fn => { const dispose = fn(); effects.push(dispose); return dispose }
  const prompt = { effect, emit: event => events.push(event), systemPrompt: { section(section) {
    assert.equal(sections.has(section.name), false)
    sections.set(section.name, section)
    return effect(() => () => sections.delete(section.name))
  } } }
  const ctx = {
    effect, logger: { warn() {} }, on(name, fn) { handlers.set(name, fn); effect(() => () => handlers.delete(name)) },
    inject(deps, fn) { if (deps.includes('systemPrompt') && available) fn(prompt) },
    tools: { register(tool) { tools.push(tool); return () => tools.splice(tools.indexOf(tool), 1) } }, attachments: {},
  }
  const ref = { get: () => value, [Symbol.for('cosmokit.volatile.write')]() {} }
  apply(ctx, { persona: ref }, {
    overlayFactory: () => ({ observe() {}, close() { native.push('close-overlay') }, syncEnabled() { native.push('enabled') } }),
    bridgeFactory: () => ({ close() { native.push('close-bridge') }, request() { throw Error('Unexpected real input or capture') } }),
    macroStoreFactory: () => ({}),
  })
  return { handlers, sections, tools, events, native, set: next => { value = next }, async close() { for (const dispose of effects.reverse()) await dispose?.() } }
}
await run('live prompt switches next request without re-registering tools or desktop effects', async () => {
  const h = hostFixture()
  try {
    const section = h.sections.get('game-player-persona'), game = h.sections.get('game-player')
    assert.equal(section.order, 30); assert.equal(section.interpolate, false); assert.notEqual(section.complete, true); assert.equal(game.order, 40)
    assert.equal(h.tools.length, 5); assert.equal(section.text(), '')
    const update = h.handlers.get('loader/volatile-update')
    h.set(state([card(), card(idB, '月亮', '冷静理性。')], idA, true)); update([['persona', 'activeId']])
    const previousRequest = section.text()
    assert.match(previousRequest, /星星/)
    h.set(state([card(), card(idB, '月亮', '冷静理性。')], idB, true)); update([['persona']])
    assert.match(section.text(), /月亮/); assert.match(previousRequest, /星星/)
    h.set(state([card()], idA, false)); update([['persona', 'enabled']]); assert.equal(section.text(), '')
    h.set(state([], idA, true)); update([['persona']]); assert.equal(section.text(), '')
    update([['maxWidth']]); assert.deepEqual(h.events, Array(4).fill('system-prompt/change'))
    assert.equal(h.sections.size, 2); assert.equal(h.tools.length, 5); assert.deepEqual(h.native, [])
    const decision = await h.handlers.get('tools/pre-execute')({ name: 'game_input' }, async () => ({ kind: 'allow' }))
    assert.equal(decision.kind, 'ask')
  } finally { await h.close() }
  assert.equal(h.sections.size, 0); assert.equal(h.tools.length, 0); assert.equal(h.handlers.size, 0)
})
await run('missing prompt service does not disable the tools or input approval', async () => {
  const h = hostFixture(state([card()], idA, true), false)
  try { assert.equal(h.sections.size, 0); assert.equal(h.tools.length, 5); h.handlers.get('loader/volatile-update')([['persona']]); assert.deepEqual(h.events, []); assert.equal((await h.handlers.get('tools/pre-execute')({ name: 'game_input' }, async () => ({ kind: 'allow' }))).kind, 'ask') }
  finally { await h.close() }
})

await uiRun('empty UI does not save, activate or create examples', h => {
  const tree = view(h)
  assert.ok(text(tree).includes(h.ui.locales.zh['persona.empty']))
  assert.equal(control(h, 'toggle').props.disabled, false)
  assert.equal(control(h, 'new').props.disabled, false)
  assert.deepEqual(h.calls, []); assert.deepEqual(h.config.value.persona, emptyPersona())
  assert.deepEqual(h.ui.PERSONA_LIMITS, PERSONA_LIMITS)
  assert.deepEqual(h.ui.SPECIAL_FIELDS.map(field => field.key), ['persona'])
})
await uiRun('client and host validators agree on JSON values and limits', h => {
  const valid = state([card(idA, 'x'.repeat(80), 'y'.repeat(8000))], idA, true)
  assert.deepEqual(h.ui.validatePersona(valid), validatePersona(valid))
  for (const invalid of [state([card('bad')]), state([card(idA, ' ')]), state([card(idA, 'a', ' ')]), state([card(idA, 'x'.repeat(81))]), state([card(idA, 'x', 'y'.repeat(8001))]), state([card(), card()]), state([], idA, true)]) { assert.throws(() => h.ui.validatePersona(invalid)); assert.throws(() => validatePersona(invalid)) }
})
await run('enabled without a selected card survives schema, validation and config reload but adds no prompt', () => {
  for (const profiles of [[], [card()]]) {
    const value = state(profiles, null, true)
    assert.deepEqual(validatePersona(value), value)
    assert.deepEqual(readPersona(value), value)
    assert.deepEqual(Config({ persona: value }).persona.get(), value)
    const warnings = []
    assert.deepEqual(resolveConfig({ persona: JSON.parse(JSON.stringify(value)) }, message => warnings.push(message)).persona, value)
    assert.deepEqual(warnings, [])
    assert.equal(compilePersona(value), '')
  }
})
await uiRun('enable first then create and save keeps chat unchanged until Use', async h => {
  await click(h, 'toggle')
  assert.deepEqual(h.config.value.persona, state([], null, true))
  assert.equal(control(h, 'new').props.disabled, false)
  assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.onWithoutSelection']))
  const id = await add(h, '先开启的新朋友', '清楚地交流。')
  assert.equal(h.config.value.persona.enabled, true)
  assert.equal(h.config.value.persona.activeId, null)
  assert.equal(compilePersona(h.config.value.persona), '')
  await click(h, 'use')
  assert.equal(h.config.value.persona.activeId, id)
  assert.match(compilePersona(h.config.value.persona), /先开启的新朋友/)
})
await uiRun('create and save while off never enables a persona or selects a profile', async h => {
  assert.equal(control(h, 'new').props.disabled, false)
  const a = await add(h, '只添加，不启用')
  const b = await add(h, '另一份备用人格')
  assert.equal(h.config.value.persona.enabled, false)
  assert.equal(h.config.value.persona.activeId, null)
  assert.deepEqual(h.config.value.persona.profiles.map(profile => profile.id), [a, b])
  assert.equal(h.calls.length, 2)
  assert.ok(h.calls.every(([, key, value]) => key === 'persona' && value.enabled === false && value.activeId === null))
  assert.equal(compilePersona(h.config.value.persona), '')
})
await uiRun('adding while disabled preserves previous selection without re-enabling it', async h => {
  h.config.value.persona = state([card()], idA, false)
  const id = await add(h, '备用人格')
  assert.notEqual(id, idA)
  assert.equal(h.config.value.persona.enabled, false)
  assert.equal(h.config.value.persona.activeId, idA)
  assert.equal(compilePersona(h.config.value.persona), '')
})
await uiRun('turning off with a draft does not prevent saving or auto-enable afterward', async h => {
  await click(h, 'toggle')
  await click(h, 'new'); edit(h, 'name', '关闭后的草稿'); edit(h, 'prompt', '只保存。')
  await click(h, 'toggle')
  assert.equal(field(h, 'name').props.value, '关闭后的草稿')
  await click(h, 'save')
  assert.equal(h.config.value.persona.enabled, false)
  assert.equal(h.config.value.persona.activeId, null)
  assert.equal(h.config.value.persona.profiles.length, 1)
  assert.equal(compilePersona(h.config.value.persona), '')
})
await uiRun('new card is a local draft until explicitly saved and UUID remains stable', async h => {
  await click(h, 'new'); edit(h, 'name', '星星'); edit(h, 'prompt', '活泼。{{literal}}')
  assert.deepEqual(h.calls, []); assert.equal(control(h, 'use').props.disabled, true)
  await click(h, 'save')
  const saved = h.config.value.persona.profiles[0]
  assert.match(saved.id, /^[0-9a-f-]{36}$/i); assert.deepEqual(h.config.value.persona, state([saved]))
  assert.equal(h.calls[0][0], 'config'); assert.equal(h.calls[0][1], 'persona')
  edit(h, 'name', '星星二号'); await click(h, 'save')
  assert.equal(h.config.value.persona.profiles[0].id, saved.id)
  assert.equal(h.config.value.persona.profiles[0].name, '星星二号')
})
await uiRun('saved first card enables directly without prior Use or activeId', async h => {
  const id = await add(h, '星星')
  assert.equal(h.config.value.persona.enabled, false)
  assert.equal(h.config.value.persona.activeId, null)
  assert.equal(control(h, 'toggle').props.disabled, false)
  assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.enableTarget'] + ' 星星'))
  const writes = h.calls.length
  await click(h, 'toggle')
  assert.equal(h.calls.length, writes + 1)
  assert.equal(h.config.value.persona.enabled, true)
  assert.equal(h.config.value.persona.activeId, id)
  assert.match(compilePersona(h.config.value.persona), /星星/)
})
await uiRun('reloaded saved profiles with no activeId can enable from the list', async h => {
  h.config.value.persona = state([card(), card(idB, '月亮', '冷静理性。')])
  assert.equal(control(h, 'toggle').props.disabled, false)
  await click(h, 'toggle')
  assert.equal(h.config.value.persona.activeId, idA)
  assert.equal(h.config.value.persona.enabled, true)
})
await uiRun('explicit toggle uses selected saved card without activating on selection', async h => {
  h.config.value.persona = state([card(), card(idB, '月亮', '冷静理性。')])
  await click(h, 'select', idB)
  assert.equal(h.config.value.persona.activeId, null)
  assert.equal(h.calls.length, 0)
  assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.enableTarget'] + ' 月亮'))
  await click(h, 'toggle')
  assert.equal(h.config.value.persona.activeId, idB)
  assert.equal(h.config.value.persona.enabled, true)
})
await uiRun('toggle applies saved version while leaving editor draft untouched', async h => {
  h.config.value.persona = state([card()])
  await click(h, 'select', idA)
  edit(h, 'name', '未保存名称'); edit(h, 'prompt', '未保存的人格描述')
  assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.savedOnly']))
  await click(h, 'toggle')
  assert.equal(h.config.value.persona.profiles[0].name, '星星')
  assert.equal(h.config.value.persona.profiles[0].prompt, card().prompt)
  assert.equal(field(h, 'prompt').props.value, '未保存的人格描述')
  assert.equal(control(h, 'use').props.disabled, true)
  assert.doesNotMatch(compilePersona(h.config.value.persona), /未保存的人格描述|未保存名称/)
})
await uiRun('off switch retains previous persona despite editing another saved card', async h => {
  h.config.value.persona = state([card(), card(idB, '月亮', '冷静理性。')], idA, false)
  await click(h, 'select', idB)
  assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.enableTarget'] + ' 星星'))
  await click(h, 'toggle')
  assert.equal(h.config.value.persona.activeId, idA)
  await click(h, 'toggle')
  assert.equal(h.config.value.persona.enabled, false)
  assert.equal(h.config.value.persona.activeId, idA)
})
await uiRun('switch can enable beside an unsaved-only draft without applying it', async h => {
  await click(h, 'new'); edit(h, 'name', '草稿'); edit(h, 'prompt', '尚未保存')
  assert.equal(control(h, 'toggle').props.disabled, false)
  assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.chooseFirst']))
  assert.equal(h.calls.length, 0)
  await click(h, 'toggle')
  assert.deepEqual(h.config.value.persona, state([], null, true))
  assert.equal(field(h, 'name').props.value, '草稿')
  assert.equal(field(h, 'prompt').props.value, '尚未保存')
  assert.equal(compilePersona(h.config.value.persona), '')
  assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.onWithoutSelection']))
})
await uiRun('failed switch write stays off and preserves saved cards', async h => {
  h.config.value.persona = state([card()])
  const before = JSON.stringify(h.config.value.persona)
  h.controller.set = async () => false
  assert.equal(await click(h, 'toggle'), false)
  assert.equal(JSON.stringify(h.config.value.persona), before)
  assert.equal(control(h, 'toggle').props['aria-checked'], false)
  assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.saveFailed']))
})
await uiRun('activation rechecks cards inside queue rather than activating a deleted target', async h => {
  h.config.value.persona = state([card()])
  const toggle = control(h, 'toggle').props.onClick
  h.config.value.persona = emptyPersona()
  assert.equal(await toggle(), true)
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.config.value.persona, state([], null, true))
  assert.equal(compilePersona(h.config.value.persona), '')
  assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.onWithoutSelection']))
})
await uiRun('invalid draft never writes and retains entered values', async h => {
  await click(h, 'new'); edit(h, 'name', '   '); edit(h, 'prompt', '草稿')
  assert.equal(await click(h, 'save'), false); assert.equal(h.calls.length, 0); assert.equal(field(h, 'prompt').props.value, '草稿')
  assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.invalidName']))
  edit(h, 'name', '星星'); edit(h, 'prompt', 'x'.repeat(8001)); assert.equal(await click(h, 'save'), false); assert.equal(h.calls.length, 0)
})
await uiRun('selecting edits does not activate; saved use/toggle preserves other settings', async h => {
  h.config.value.requireApproval = true
  const a = await add(h, '星星'), b = await add(h, '月亮')
  await click(h, 'use'); assert.equal(h.config.value.persona.activeId, b); assert.equal(h.config.value.persona.enabled, true)
  const calls = h.calls.length
  await click(h, 'select', a); assert.equal(h.config.value.persona.activeId, b); assert.equal(h.calls.length, calls)
  edit(h, 'prompt', '未保存人格'); assert.equal(h.calls.length, calls); assert.equal(control(h, 'use').props.disabled, true)
  await click(h, 'save'); await click(h, 'use'); assert.equal(h.config.value.persona.activeId, a)
  await click(h, 'toggle'); assert.equal(h.config.value.persona.enabled, false); assert.equal(h.config.value.persona.activeId, a); assert.equal(h.config.value.persona.profiles.length, 2)
  await click(h, 'toggle'); assert.equal(h.config.value.persona.enabled, true); assert.equal(h.config.value.requireApproval, true)
})
await uiRun('editing active card affects compiled prompt only after successful save', async h => {
  seed(h); await click(h, 'select', idA); const before = compilePersona(h.config.value.persona)
  edit(h, 'prompt', '新的角色风格。'); assert.equal(compilePersona(h.config.value.persona), before)
  await click(h, 'save'); assert.match(compilePersona(h.config.value.persona), /新的角色风格/)
  assert.equal(h.config.value.persona.activeId, idA)
})
await uiRun('unsaved selection supports cancel, save-and-continue and discard', async h => {
  seed(h); await click(h, 'select', idA); edit(h, 'prompt', '应当保存')
  await click(h, 'select', idB); assert.ok(control(h, 'cancel')); await click(h, 'cancel'); assert.equal(field(h, 'prompt').props.value, '应当保存'); assert.equal(h.calls.length, 0)
  await click(h, 'select', idB); await click(h, 'confirm-save'); assert.equal(h.config.value.persona.profiles[0].prompt, '应当保存'); assert.equal(field(h, 'name').props.value, '月亮')
  edit(h, 'prompt', '丢弃'); await click(h, 'select', idA); await click(h, 'confirm-discard'); assert.equal(h.config.value.persona.profiles[1].prompt, '冷静理性。'); assert.equal(field(h, 'name').props.value, '星星')
  await click(h, 'new'); edit(h, 'name', '未保存新卡'); await click(h, 'delete'); await click(h, 'confirm-discard'); assert.equal(field(h, 'name'), undefined); assert.equal(h.config.value.persona.profiles.length, 2)
})
await uiRun('false/throwing save preserves draft and unsaved confirmation', async h => {
  seed(h); await click(h, 'select', idA); edit(h, 'prompt', '保留我'); const before = JSON.stringify(h.config.value.persona)
  h.controller.set = async () => false
  await click(h, 'select', idB); await click(h, 'confirm-save'); assert.ok(control(h, 'cancel')); assert.equal(field(h, 'prompt').props.value, '保留我'); assert.equal(JSON.stringify(h.config.value.persona), before)
  await click(h, 'cancel'); h.controller.set = async () => { throw Error('offline') }; await click(h, 'save'); assert.equal(field(h, 'prompt').props.value, '保留我'); assert.ok(text(view(h)).includes('offline'))
})
await uiRun('pending saves serialize and disable edits without activating drafts', async h => {
  seed(h); await click(h, 'select', idA); edit(h, 'prompt', '待保存')
  let finish, writes = 0
  h.controller.set = async (key, value) => { writes++; return new Promise(resolve => { finish = () => { h.config.value[key] = value; resolve(true) } }) }
  const save = control(h, 'save').props.onClick, pending = save()
  assert.equal(writes, 1); assert.equal(control(h, 'save').props.disabled, true); assert.equal(field(h, 'prompt').props.disabled, true)
  assert.equal(await save(), false); assert.equal(writes, 1); assert.notEqual(h.config.value.persona.profiles[0].prompt, '待保存')
  finish(); await pending; assert.equal(h.config.value.persona.profiles[0].prompt, '待保存')
})
await uiRun('deleting active profile turns personality off and keeps other profiles', async h => {
  seed(h); await click(h, 'select', idA); await click(h, 'delete'); assert.equal(h.calls.length, 0)
  await click(h, 'confirm-discard'); assert.deepEqual(h.config.value.persona, state([card(idB, '月亮', '冷静理性。')])); assert.equal(field(h, 'prompt'), undefined)
})
await uiRun('save-then-delete dirty card does not lose UUID or leave it active', async h => {
  seed(h); await click(h, 'select', idA); edit(h, 'prompt', '保存再删除'); await click(h, 'delete'); await click(h, 'confirm-save')
  assert.equal(h.calls.length, 2); assert.equal(h.calls[0][2].profiles[0].id, idA); assert.equal(h.config.value.persona.activeId, null); assert.equal(h.config.value.persona.enabled, false)
})
await uiRun('read-only UI cannot write and existing cards remain readable', async h => {
  seed(h); h.config.writable = false; await click(h, 'select', idA)
  for (const action of ['new', 'save', 'use', 'delete', 'toggle']) assert.equal(control(h, action).props.disabled, true)
  assert.equal(field(h, 'prompt').props.readOnly, true); assert.equal(h.calls.length, 0); assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.readOnly']))
})
await uiRun('external profile writes cannot overwrite a dirty draft; unrelated cards are preserved', async h => {
  seed(h); await click(h, 'select', idA); edit(h, 'prompt', '本地草稿')
  h.config.value.persona = state([card(idA, '星星', '另一页面的新内容'), card(idB, '月亮', '新月亮')], idB, true)
  assert.equal(await click(h, 'save'), false); assert.equal(h.calls.length, 0); assert.equal(field(h, 'prompt').props.value, '本地草稿'); assert.ok(text(view(h)).includes(h.ui.locales.zh['persona.conflict']))
  await click(h, 'select', idA); await click(h, 'confirm-discard'); assert.equal(field(h, 'prompt').props.value, '另一页面的新内容')
  await click(h, 'select', idB); assert.equal(field(h, 'prompt').props.value, '新月亮')
})
await uiRun('external deletion is not silently resurrected by a stale save', async h => {
  seed(h); await click(h, 'select', idA); edit(h, 'prompt', '旧卡草稿'); h.config.value.persona = state([card(idB, '月亮', '冷静理性。')])
  assert.equal(await click(h, 'save'), false); assert.equal(h.calls.length, 0); assert.equal(h.config.value.persona.profiles.length, 1)
})
await uiRun('simultaneous mounted editors serialize transformations and reject stale same-card saves', async h => {
  seed(h)
  const props = { controller: h.controller, state: h.config, t: h.props.t }
  const render = key => { h.render('PersonaControls', props, key); return h.render('PersonaControls', props, key) }
  const button = (key, action) => collect(render(key), node => node.props?.['data-persona-action'] === action && (action !== 'select' || node.props['data-persona-id'] === idA))[0]
  const prompt = key => collect(render(key), node => node.props?.['data-persona-field'] === 'prompt')[0]
  for (const key of ['first-editor', 'second-editor']) { button(key, 'select').props.onClick(); render(key); prompt(key).props.onChange({ target: { value: key } }); render(key) }
  let finish, writes = 0
  h.controller.set = async (key, value) => { writes++; return new Promise(resolve => { finish = () => { h.config.value[key] = value; resolve(true) } }) }
  const first = button('first-editor', 'save').props.onClick(), second = button('second-editor', 'save').props.onClick()
  assert.equal(writes, 1); finish(); assert.equal(await first, true); assert.equal(await second, false)
  assert.equal(writes, 1); assert.equal(h.config.value.persona.profiles[0].prompt, 'first-editor'); assert.equal(prompt('second-editor').props.value, 'second-editor')
  assert.ok(text(render('second-editor')).includes(h.ui.locales.zh['persona.conflict']))
})
await uiRun('new save merges current unrelated profile changes', async h => {
  seed(h); await click(h, 'new'); edit(h, 'name', '新朋友'); edit(h, 'prompt', '第三份人格')
  h.config.value.persona = state([card(idA, '星星', '外部更新'), card(idB, '月亮', '冷静理性。')], idB, true)
  await click(h, 'save'); assert.equal(h.config.value.persona.profiles[0].prompt, '外部更新'); assert.equal(h.config.value.persona.activeId, idB); assert.equal(h.config.value.persona.profiles.length, 3)
})
await uiRun('both settings mounts share saved values, preserve drafts across tabs and use distinct IDs', async h => {
  seed(h)
  const first = h.render('GamePlayerSettings', h.props, 'first'), second = h.render('GamePlayerSettings', h.props, 'second')
  const ids = [...collect(first, node => node.props?.id), ...collect(second, node => node.props?.id)].map(node => node.props.id)
  assert.equal(new Set(ids).size, ids.length)
  const tab = (tree, key) => collect(tree, node => node.props?.role === 'tab' && node.props.key === key)[0]
  tab(first, 'personality').props.onClick(); const tree = h.render('GamePlayerSettings', h.props, 'first')
  assert.ok(text(tree).includes(h.ui.locales.zh['persona.explicitSave']))
  assert.deepEqual(collect(tree, node => node.props?.role === 'tab').map(node => node.props.key), ['common', 'models', 'personality', 'appearance', 'safety'])
  assert.equal(h.calls.length, 0)
})
await uiRun('all personality labels are translated and input IDs reference actual labels', h => {
  for (const key of Object.keys(h.ui.locales.zh).filter(key => key.startsWith('persona.') || key === 'tabs.personality' || key === 'page.personalityHint')) { assert.ok(h.ui.locales.en[key], key) }
  seed(h)
  control(h, 'select', idA).props.onClick()
  const tree = view(h)
  for (const node of collect(tree, node => ['input', 'textarea'].includes(node.type))) assert.ok(collect(tree, label => label.type === 'label' && label.props.htmlFor === node.props.id).length)
})
console.log('Persona regression passed: ' + checks + ' isolated configuration, dynamic prompt, draft, CRUD, conflict, read-only, lifecycle and bilingual UI scenarios. No desktop, captures or real input were started.')
