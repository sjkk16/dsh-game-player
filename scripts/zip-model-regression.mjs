import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { OverlayPreferences } from '../src/overlay-preferences.js'
import { OverlayManagement, OVERLAY_ACTIONS } from '../src/overlay-management.js'
import { validateMotionAction } from '../src/live2d/motions.js'
import { createSettingsHarness, collect, byKey, text } from './settings-fixture.mjs'

const project = dirname(dirname(fileURLToPath(import.meta.url))), base = join(project, '.qa'), hash = value => createHash('sha256').update(value).digest('hex')
await fs.mkdir(base, { recursive: true })
let scenarios = 0
async function fixture(options, run) {
  const directory = await fs.mkdtemp(join(base, 'zip-only-')), real = await fs.realpath(directory)
  assert.ok(real.startsWith(await fs.realpath(base) + sep))
  const store = new OverlayPreferences(join(directory, 'data', 'overlay.json')); await store.ready
  const source = join(directory, 'source.ZIP'); await fs.writeFile(source, 'Synthetic archive bytes; decoding is covered by native tests')
  const control = { picked: source, names: ['first.model3.json'], ...options }, calls = []
  const overlay = { preferences: store, desktop: join(directory, 'not-a-process.exe'), defaultModel: join(directory, 'none'), enabled: true, closed: false, runtime: {}, realState: { keys: new Set(), buttons: new Set() } }
  const utility = async (args, signal) => {
    calls.push(args); signal?.throwIfAborted()
    if (args[0] === '--pick') { if (control.pickGate) await control.pickGate; signal?.throwIfAborted(); return { path: control.picked } }
    if (args[0] === '--describe-model-source') return { zip: true, root: dirname(args[1]), files: [] }
    if (args[0] === '--discover-model') {
      const digest = hash(await fs.readFile(args[1]))
      return { candidates: control.names.map(entry => ({ sourcePath: args[1], entry, name: entry, fingerprint: hash(digest + entry), modelKey: hash(entry), ...(control.broken ? { error: 'Synthetic missing resource' } : {}) })) }
    }
    throw Error('Unexpected native request: ' + args[0])
  }
  utility.supportsLibrary = true; utility.supportsDiscovery = true
  const manager = new OverlayManagement(overlay, { utility, io: { ...fs, rename: async (from, to) => { if (control.failIndex && to === join(dirname(store.path), 'library.json')) throw Error('Synthetic index failure'); return fs.rename(from, to) } } })
  const begin = () => manager.command('addLibraryZip')
  const add = async () => { const library = manager.library, catalog = library.catalog; return manager.command({ type: 'addLibraryModels', catalogGeneration: catalog.generation, modelIds: catalog.items.filter(item => !item.error).map(item => item.id), libraryRevision: library.index.revision }) }
  try { await run({ directory, store, source, control, manager, calls, begin, add }); scenarios++ }
  finally { manager.lifetime.abort(); assert.equal(await fs.realpath(directory), real); await fs.rm(directory, { recursive: true, force: true }) }
}
assert.ok(OVERLAY_ACTIONS.includes('addLibraryZip')); assert.equal(validateMotionAction('addLibraryZip'), 'addLibraryZip')
for (const legacy of ['addLibraryFile', 'addLibraryFolder', 'importModelFile', 'importModelFolder']) assert.equal(validateMotionAction(legacy), legacy)
const utilitySource = await fs.readFile(join(project, 'desktop', 'DesktopUtility.cs'), 'utf8')
assert.match(utilitySource, /"model-zip"\s*=>\s*\("添加 ZIP 模型", "ZIP 模型压缩包\|\*\.zip"\)/)
await fixture({}, async h => {
  await h.begin(); assert.deepEqual(h.calls[0], ['--pick', 'model-zip']); assert.equal(h.manager.library.catalog.items.length, 1)
  assert.equal(h.store.value.modelPath, null); await assert.rejects(fs.stat(h.manager.library.path), { code: 'ENOENT' })
  const records = await h.add(); assert.equal(records.length, 1); assert.equal(records[0].kind, 'zip')
  assert.equal(await fs.readFile(h.manager.library.source(records[0]), 'utf8'), await fs.readFile(h.source, 'utf8'))
  assert.equal(h.store.value.modelPath, null); await assert.rejects(fs.stat(h.store.path), { code: 'ENOENT' })
  const revision = h.manager.library.index.revision; await h.begin(); await h.add(); assert.equal(h.manager.library.index.revision, revision)
  assert.equal(h.manager.library.index.items.length, 1)
})
await fixture({ names: ['first.model3.json', 'second.model3.json'] }, async h => {
  await h.begin(); const records = await h.add(); assert.equal(records.length, 2); assert.equal(new Set(records.map(item => item.bundleId)).size, 1)
  assert.equal(h.store.value.modelPath, null); assert.equal(h.manager.library.catalog, null)
})
await fixture({ picked: null }, async h => { await h.begin(); assert.equal(h.manager.library.catalog, null); assert.equal(h.manager.busy, null); assert.equal(h.store.value.modelPath, null) })
await fixture({}, async h => {
  for (const picked of [join(h.directory, 'single.model3.json'), h.directory, '\\\\remote\\share\\model.zip', 'relative.zip']) {
    h.control.picked = picked; await assert.rejects(h.begin(), { code: 'invalid_model_zip' }); assert.equal(h.manager.library.catalog, null)
  }
  const folder = join(h.directory, 'directory.zip'); await fs.mkdir(folder); h.control.picked = folder
  await assert.rejects(h.begin(), { code: 'invalid_model_zip' })
})
await fixture({ broken: true }, async h => { await assert.rejects(h.begin(), { code: 'model_discovery_failed' }); assert.equal(h.manager.library.index.items.length, 0); assert.equal(h.store.value.modelPath, null) })
await fixture({ names: [] }, async h => { await assert.rejects(h.begin(), { code: 'model_discovery_failed' }); assert.equal(h.manager.library.catalog, null) })
await fixture({}, async h => {
  let release; h.control.pickGate = new Promise(resolve => { release = resolve })
  const pending = h.begin(); const rejection = assert.rejects(pending)
  while (!h.manager.load) await new Promise(resolve => setImmediate(resolve))
  await h.manager.command('cancelLoad'); release(); await rejection; assert.equal(h.manager.library.catalog, null); assert.equal(h.store.value.modelPath, null)
})
await fixture({ failIndex: true }, async h => {
  await h.begin(); await assert.rejects(h.add(), /Synthetic index failure/)
  assert.equal(h.manager.library.index.items.length, 0); assert.deepEqual(await fs.readdir(h.manager.library.root), [])
  assert.equal(h.store.value.modelPath, null); assert.ok(await fs.stat(h.source))
})
await fixture({}, async h => {
  await h.begin(); await h.manager.command('cancelLoad'); assert.equal(h.manager.library.catalog, null)
  await h.begin(); const catalog = h.manager.library.catalog
  await assert.rejects(h.manager.command({ type: 'addLibraryModels', catalogGeneration: randomUUID(), modelIds: ['model-0'], libraryRevision: 0 }), { code: 'stale_model_catalog' })
  assert.equal(h.manager.library.catalog, catalog); assert.equal(h.store.value.modelPath, null)
})
await fixture({}, async h => {
  await h.begin(); const library=h.manager.library
  const previous=Array.from({length:31},(_,i)=>{const bundleId=hash('existing-'+i),entry='old-'+i+'.model3.json';return {id:hash(bundleId+'\0'+entry.toLowerCase()),bundleId,entry,name:'Existing '+i,kind:'zip',modelKey:hash(entry)}})
  await library.write(previous,0); const before=await fs.readFile(library.path,'utf8')
  await assert.rejects(h.add(),{code:'library_full'});assert.equal(library.index.items.length,31)
  assert.equal(await fs.readFile(library.path,'utf8'),before);assert.deepEqual(await fs.readdir(library.root),[]);assert.equal(h.store.value.modelPath,null)
})
const ui = createSettingsHarness()
try {
  let tree = ui.render(); assert.equal(collect(tree, node => node.type === 'button' && node.props.key === 'addLibraryZip').length, 1)
  for (const key of ['addLibraryFile', 'addLibraryFolder', 'importModelFile', 'importModelFolder', 'direct-import']) assert.equal(byKey(tree, key), undefined)
  assert.ok(text(byKey(tree, 'zip-hint')).includes('.model3.json'))
  for (const pending of ['addLibraryZip', 'addLibraryModels']) {
    ui.state.pending = pending; ui.state.value.phase = pending === 'addLibraryModels' ? 'copyingModels' : 'discovering'; tree = ui.render()
    assert.equal(byKey(tree, 'addLibraryZip').props.disabled, true); assert.equal(byKey(tree, 'library-stop-load').props.disabled, false); assert.ok(text(byKey(tree, 'add-progress')).length)
  }
  ui.state.pending = ''; ui.state.value.phase = 'ready'; ui.state.failure = { action: 'addLibraryZip', message: 'ZIP rejected' }
  tree = ui.render(); assert.equal(text(byKey(tree, 'add-failure')), 'ZIP rejected')
  ui.state.value.enabled = false; tree = ui.render(); assert.equal(byKey(tree, 'addLibraryZip').props.disabled, false)
  ui.state.value.capabilities.library = false; tree = ui.render(); assert.equal(byKey(tree, 'addLibraryZip').props.disabled, true); assert.ok(text(byKey(tree, 'add-reason')).length)
  for (const lang of ['zh', 'en']) for (const key of ['local.addLibraryZip', 'local.zipHint', 'local.discoveringModels']) assert.ok(ui.ui.locales[lang][key])
} finally { ui.close() }
console.log('ZIP model regression passed: ' + scenarios + ' isolated backend scenarios plus ZIP picker, compatibility, unique entry, progress, cancellation and locale checks.')
