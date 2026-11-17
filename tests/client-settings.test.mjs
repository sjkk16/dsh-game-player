import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Config } from '../index.js'

/** Minimal React table: the factory only needs the symbols to exist. */
const REACT = {
  createElement(type, props, ...children) { return { type, props: props ?? {}, children: children.flat(Infinity) } },
  useCallback(fn) { return fn },
  useEffect() {},
  useId() { return 'dgp-test' },
  useRef(value) { return { current: value } },
  useState(value) { return [typeof value === 'function' ? value() : value, () => {}] },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
}

/** The client half must need nothing beyond React from the module table. */
function requireModule(id) {
  if (id === 'react') return REACT
  throw new Error('unexpected client dependency: ' + id)
}

let loading
/** Evaluate client.js against the module loader the app uses at boot. */
function loadClient() {
  if (loading !== undefined) return loading
  let definition
  globalThis.window = { __ModuleLoader__: { load(value) { definition = value } } }
  loading = import('../client.js').then(() => {
    assert.ok(definition !== undefined, 'client.js did not register a module')
    assert.equal(definition.id, '@local/dsh-game-player')
    return definition.factory(requireModule)
  })
  return loading
}

/** Read one field spec out of the exported table. */
function specOf(module, key) {
  return module.GROUPS.flatMap((group) => group.fields).find((field) => field.key === key)
}

test('every editable field mirrors a live Host Config field, range and default', async () => {
  const module = await loadClient()
  const live = Object.entries(Config.dict).filter(([, field]) => field.meta.volatile === true).map(([key]) => key)
  const keys = [...module.GROUPS.flatMap((group) => group.fields.map((field) => field.key)), ...module.SPECIAL_FIELDS.map(field => field.key)]
  assert.deepEqual(keys, live, 'the page must expose exactly the live Host fields, in declaration order')

  const defaults = Config({})
  for (const field of module.SPECIAL_FIELDS) assert.deepEqual(field.fallback, defaults[field.key].get(), 'compound fallback of ' + field.key)
  for (const group of module.GROUPS) {
    for (const field of group.fields) {
      const host = defaults[field.key]
      const value = typeof host?.get === 'function' ? host.get() : host
      assert.equal(field.fallback, value, 'fallback of ' + field.key)
      if (field.kind === 'integer' || field.kind === 'number') {
        const meta = Config.dict[field.key].meta
        assert.equal(field.min, meta.min, 'min of ' + field.key)
        assert.equal(field.max, meta.max, 'max of ' + field.key)
      }
      if (field.kind === 'enum') {
        const allowed = Config.dict[field.key].list.map((node) => node.value)
        assert.deepEqual(field.values, allowed, 'choices of ' + field.key)
      }
    }
  }
})

test('both languages translate every group, field, choice and status message', async () => {
  const module = await loadClient()
  const { zh, en } = module.locales
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), 'zh and en must declare the same keys')
  const status = ['summary', 'loading', 'unavailable', 'readOnly', 'saveFailed', 'reset', 'resetFailed', 'saving', 'dangerBanner', 'invalidInteger', 'invalidNumber', 'outOfRange', 'invalidChoice']
  for (const [locale, dict] of [['zh', zh], ['en', en]]) {
    for (const key of status) {
      assert.equal(typeof dict[key], 'string', locale + ' is missing ' + key)
    }
    for (const group of module.GROUPS) {
      assert.equal(typeof dict['group.' + group.id], 'string', locale + ' is missing group.' + group.id)
      for (const field of group.fields) {
        for (const suffix of ['label', 'hint']) {
          const key = 'field.' + field.key + '.' + suffix
          assert.equal(typeof dict[key], 'string', locale + ' is missing ' + key)
        }
        for (const choice of field.values ?? []) {
          const key = field.key + '.' + choice
          assert.equal(typeof dict[key], 'string', locale + ' is missing ' + key)
        }
      }
    }
  }
})

test('the client-side validator matches the declared ranges and types', async () => {
  const module = await loadClient()
  const maxWidth = specOf(module, 'maxWidth')
  // Keep the generic numeric parser covered without exposing a watcher field.
  const fraction = { kind: 'number', min: 0.001, max: 1 }
  const monitor = specOf(module, 'monitor')
  const approval = specOf(module, 'requireApproval')

  assert.deepEqual(module.parseField(maxWidth, '320'), { ok: true, value: 320 })
  assert.deepEqual(module.parseField(maxWidth, ' 2560 '), { ok: true, value: 2560 })
  assert.equal(module.parseField(maxWidth, '319').message, 'outOfRange')
  assert.equal(module.parseField(maxWidth, '2561').message, 'outOfRange')
  assert.equal(module.parseField(maxWidth, '12.5').message, 'invalidInteger')
  assert.equal(module.parseField(maxWidth, '').message, 'invalidInteger')
  assert.equal(module.parseField(maxWidth, 'wide').message, 'invalidInteger')

  assert.deepEqual(module.parseField(fraction, '0.03'), { ok: true, value: 0.03 })
  assert.equal(module.parseField(fraction, '0').message, 'outOfRange')
  assert.equal(module.parseField(fraction, '1.5').message, 'outOfRange')
  assert.equal(module.parseField(fraction, 'NaN').message, 'invalidNumber')

  assert.deepEqual(module.parseField(monitor, 'virtual'), { ok: true, value: 'virtual' })
  assert.equal(module.parseField(monitor, 'all').message, 'invalidChoice')
  assert.deepEqual(module.parseField(approval, false), { ok: true, value: false })
  assert.deepEqual(module.parseField(approval, 'true'), { ok: true, value: true })
})

test('the client half registers the settings page and the plugin row while served', async () => {
  const module = await loadClient()
  const registered = []
  const controller = {
    subscribe() { return () => {} },
    getSnapshot() { return { status: 'ready', value: {}, base: {}, user: {}, revision: 0, writable: true } },
    async set() { return true },
    async unset() { return true },
  }
  const ctx = {
    effect(fn) { return fn() },
    locale: { register() { return () => {} }, bind() { return (key) => key } },
    configForms: {
      get(namespace) { assert.equal(namespace, 'game-player'); return controller },
      whileServed(namespaces, register) { assert.deepEqual(namespaces, ['game-player']); return register(new Set(namespaces)) },
    },
    slots: {
      inject(name, fn) { assert.ok(['settings.section', 'plugins.row.config'].includes(name)); return fn() },
      register(options, component) {
        assert.equal(typeof component, 'function')
        assert.equal(options.locale, 'game-player')
        registered.push(options)
        return () => {}
      },
    },
  }

  module.apply(ctx)
  assert.equal(module.inject.length, 3)
  assert.deepEqual(registered.map((entry) => entry.name), ['settings.section', 'plugins.row.config'])
  assert.equal(registered[0].id, 'game-player')
  assert.equal(registered[0].order, 25)
  assert.equal(registered[1].key, '@local/dsh-game-player#game-player')
})

test('retired simulation setting has no field, translations or bundled configuration', async () => {
  const module = await loadClient()
  assert.equal(specOf(module, 'dryRun'), undefined)
  assert.equal(Object.hasOwn(Config.dict, 'dryRun'), false)
  for (const dict of Object.values(module.locales)) {
    assert.equal(Object.keys(dict).some(key => key.startsWith('field.dryRun.')), false)
  }
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(patch, /^\s*dryRun\s*:/m)
  assert.match(patch, /^\s*requireApproval: true$/m)
})

test('both settings mounts omit dryRun/watcher settings and retain disabled-approval warnings', async () => {
  const module = await loadClient(), registered = [], effects = []
  const snapshot = { status: 'ready', value: {}, user: {}, base: {}, writable: true, revision: 0 }
  const controller = { subscribe: () => () => {}, getSnapshot: () => snapshot }
  module.apply({
    effect(fn) { const dispose = fn(); effects.push(dispose); return dispose },
    locale: { register: () => () => {}, bind: () => key => key },
    configForms: { get: () => controller, whileServed: (_names, register) => register() },
    slots: { inject: (_name, register) => register(), register(options, component) { registered.push({ options, component }); return () => {} } },
  })
  const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flatMap(walk)]
  try {
    assert.equal(registered.length, 2)
    assert.equal(registered[0].component, registered[1].component)
    const expected = module.GROUPS.flatMap(group => group.fields.map(field => field.key))
    const removed = ['dryRun', 'watchIntervalMs', 'watchThreshold', 'watchMaxWakes']
    assert.equal(module.GROUPS.some(group => group.id === 'watch'), false)
    for (const key of removed) assert.equal(expected.includes(key), false)
    for (const dict of Object.values(module.locales)) {
      assert.equal(Object.hasOwn(dict, 'group.watch'), false)
      for (const key of removed) assert.equal(Object.hasOwn(dict, 'field.' + key + '.label'), false)
    }
    for (const entry of registered) {
      for (const value of [{}, { requireApproval: true }, { requireApproval: false }, { requireApproval: false, dryRun: true }, { watchIntervalMs: 200, watchThreshold: 0.001, watchMaxWakes: 50 }]) {
        snapshot.value = value
        const nodes = walk(entry.component({ ...entry.options.inject(), t: key => key }))
        assert.deepEqual(nodes.map(node => node.props.spec?.key).filter(Boolean).sort(), [...expected].sort())
        assert.equal(nodes.some(node => node.props.className === 'dgp-danger'), value.requireApproval === false)
      }
    }
  } finally { for (const dispose of effects.reverse()) await dispose?.() }
})
