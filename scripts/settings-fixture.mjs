import { readFileSync } from 'node:fs'

// A deterministic component harness, not React or a real Host connection.
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
export function createSettingsHarness() {
  const instances = new Map(), effects = [], calls = []
  let current, slot = 0, serial = 0, definition
  const hook = init => {
    const index = slot++
    if (!(index in current.hooks)) current.hooks[index] = init()
    return current.hooks[index]
  }
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState(initial) { const cell = hook(() => ({ value: typeof initial === 'function' ? initial() : initial })); return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value }] },
    useRef(value) { return hook(() => ({ current: value })) },
    useId() { return hook(() => 'settings-fixture-' + (++serial)) },
    useCallback(fn) { return fn },
    useEffect(fn, deps) {
      const cell = hook(() => ({}))
      if (!cell.deps || !deps || deps.some((v, i) => !Object.is(v, cell.deps[i]))) {
        effects.push(() => { cell.dispose?.(); cell.dispose = fn() }); cell.deps = deps
      }
    },
    useSyncExternalStore(subscribe, getSnapshot) { react.useEffect(() => subscribe(() => {}), [subscribe]); return getSnapshot() },
  }
  new Function('window', source)({ __ModuleLoader__: { load: value => { definition = value } } })
  const ui = definition.factory(id => { if (id !== 'react') throw Error('Unexpected dependency: ' + id); return react })
  const config = { status: 'ready', value: {}, user: {}, writable: true, revision: 0 }
  const state = { status: 'ready', pending: '', feedback: '', failure: null, adapterSave: { status: 'idle', draft: {} }, value: demoState() }
  const controller = {
    subscribe: () => () => {}, getSnapshot: () => config,
    set: async (key, value) => { calls.push(['config', key, value]); config.value[key] = value; config.user[key] = value; return true },
    unset: async key => { calls.push(['reset', key]); delete config.value[key]; delete config.user[key]; return true },
  }
  const manager = {
    subscribe: () => () => {}, getSnapshot: () => state,
    set: async (key, value) => { calls.push(['preference', key, value]); state.value.preferences[key] = value; state.feedback = 'saved'; return true },
    command: async action => { calls.push(['command', action]); return true },
    retryAdapter: async () => { calls.push(['retryAdapter']); return true },
  }
  const resolve = (node, key) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (Array.isArray(node)) return node.map((child, i) => resolve(child, key + '/' + i))
    if (typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      let instance = instances.get(key)
      if (!instance) { instance = { hooks: [], type: node.type }; instances.set(key, instance) }
      if (instance.type !== node.type) throw Error('Component changed at stable key: ' + key)
      const parent = current, parentSlot = slot; current = instance; slot = 0
      instance.props = node.props; instance.raw = node.type(node.props)
      const output = resolve(instance.raw, key + '/render')
      current = parent; slot = parentSlot
      return output
    }
    return { ...node, children: node.children.map((child, i) => resolve(child, key + '/' + (child?.props?.key ?? i))).flat(Infinity) }
  }
  return {
    ui, config, state, manager, controller, calls, instances,
    props: { controller, overlay: manager, t: key => ui.locales.zh[key] ?? key },
    render(name = 'GamePlayerSettings', props = this.props, key = 'root') {
      const tree = resolve({ type: ui[name], props, children: [] }, key)
      while (effects.length) effects.shift()()
      return tree
    },
    close() { for (const instance of instances.values()) for (const hook of instance.hooks) hook?.dispose?.() },
  }
}

export function demoState() {
  return {
    revision: 1, enabled: true, phase: 'ready', loading: false, visible: true, renderer: 'live2d', view: 'model', modelLoaded: true,
    modelName: '桌边的小猫', modelPath: 'C:/models/cat/model.model3.json', activeModelId: 'builtin-default',
    capabilities: { management: true, picker: true, model: true, library: true, adaptation: true, motions: true, preview: true, adaptiveControl: true, modelInfoVisibility: true },
    preferences: { widthDip: 420, keyboardWidthDip: 900, opacity: 1, controlMode: 'ai-only', modelInfoVisible: true, globalAdapter: {} },
    modelLibrary: { revision: 1, items: [{ id: 'builtin-default', name: '桌边的小猫', builtin: true, available: true }, { id: 'sample-pet', name: '夜间陪伴 · 示例模型', available: true }] },
    adapterCatalog: { generation: '00000000-0000-4000-8000-000000000001', modelKey: 'fixture-model', parameters: [], inputs: [], effects: [], handStyle: 'default' },
    motionCatalog: { generation: '00000000-0000-4000-8000-000000000002', items: [] },
  }
}

export function collect(node, predicate, out = []) {
  if (node && typeof node === 'object') { if (predicate(node)) out.push(node); for (const child of node.children ?? []) collect(child, predicate, out) }
  return out
}
export const byKey = (tree, key) => collect(tree, node => node.props?.key === key)[0]
export const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children ?? []).map(text).join('')

// Static browser previews use the exact component markup/CSS with inert controls.
export function toHtml(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  if (typeof node !== 'object') return escape(node)
  const { type, props = {}, children = [] } = node
  const attributes = Object.entries(props).flatMap(([key, value]) => {
    if (value === null || value === undefined || key === 'key' || key === 'ref' || key.startsWith('on') || typeof value === 'function') return []
    const name = { className: 'class', htmlFor: 'for', tabIndex: 'tabindex' }[key] ?? key
    if (['hidden', 'disabled', 'checked', 'multiple', 'open'].includes(name)) return value ? [name] : []
    return [name + '="' + escape(value) + '"']
  }).join(' ')
  if (type === 'style') return '<style>' + children.join('') + '</style>'
  const body = type === 'select' ? children.map(child => child?.type === 'option' ? toHtml({ ...child, props: { ...child.props, selected: String(child.props.value) === String(props.value) ? 'selected' : undefined } }) : toHtml(child)).join('') : children.map(toHtml).join('')
  return '<' + type + (attributes ? ' ' + attributes : '') + '>' + (['input', 'img', 'br', 'hr'].includes(type) ? '' : body + '</' + type + '>')
}
