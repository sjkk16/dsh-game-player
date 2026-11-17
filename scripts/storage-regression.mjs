import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureStorageDirectory } from '../src/storage-directory.js'
import { OverlayPreferences } from '../src/overlay-preferences.js'
import { MacroStore } from '../src/macros.js'
import { ModelLibrary } from '../src/model-library.js'

const project = dirname(dirname(fileURLToPath(import.meta.url))), base = join(project, '.qa')
await fs.mkdir(base, { recursive: true })
let scenarios = 0
async function fixture(run) {
  const directory = await fs.mkdtemp(join(base, 'storage-auto-')), links = []
  const boundary = await fs.realpath(base), real = await fs.realpath(directory)
  assert.ok(real.startsWith(boundary + sep))
  try { await run(directory, async (path, target) => { await fs.symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir'); links.push(path) }); scenarios++ }
  finally {
    for (const link of links.reverse()) await fs.unlink(link).catch(e => { if (e.code !== 'ENOENT') throw e })
    assert.equal(await fs.realpath(directory), real)
    await fs.rm(directory, { recursive: true, force: true })
  }
}
await fixture(async dir => {
  const path = join(dir, 'missing', 'nested')
  assert.equal(await ensureStorageDirectory(path), path)
  const file = join(path, 'keep.json'); await fs.writeFile(file, 'unchanged')
  await ensureStorageDirectory(path); assert.equal(await fs.readFile(file, 'utf8'), 'unchanged')
})
await fixture(async (dir, link) => {
  const path = join(dir, 'data'), target = join(dir, 'absent', 'pet-state')
  await link(path, target); await assert.rejects(fs.stat(path), { code: 'ENOENT' })
  assert.equal(await ensureStorageDirectory(path), target)
  assert.equal(await fs.realpath(path), target); assert.ok((await fs.lstat(path)).isSymbolicLink())
  await ensureStorageDirectory(join(path, 'skins')); assert.ok((await fs.stat(join(target, 'skins'))).isDirectory())
})
await fixture(async (dir, link) => {
  const target = join(dir, 'target'); await fs.mkdir(target); await fs.writeFile(join(target, 'keep'), 'original')
  const path = join(dir, 'data'); await link(path, target)
  await Promise.all(Array.from({ length: 6 }, () => ensureStorageDirectory(join(path, 'new', 'nested'))))
  assert.equal(await fs.readFile(join(target, 'keep'), 'utf8'), 'original')
})
await fixture(async (dir, link) => {
  const a = join(dir, 'a'), b = join(dir, 'b'); await link(a, b); await link(b, a)
  await assert.rejects(ensureStorageDirectory(a), { code: 'storage_link_cycle' })
  assert.ok((await fs.lstat(a)).isSymbolicLink()); assert.ok((await fs.lstat(b)).isSymbolicLink())
})
await fixture(async dir => {
  const path = join(dir, 'occupied'); await fs.writeFile(path, 'do not replace')
  await assert.rejects(ensureStorageDirectory(join(path, 'nested')), { code: 'ENOTDIR' })
  assert.equal(await fs.readFile(path, 'utf8'), 'do not replace')
})
await fixture(async dir => {
  const path = join(dir, 'denied'), io = { ...fs, mkdir: async value => { if (value === path) throw Object.assign(Error('Synthetic permission failure'), { code: 'EACCES', path }); return fs.mkdir(value) } }
  await assert.rejects(ensureStorageDirectory(path, { io }), e => e.code === 'EACCES' && e.message.includes('Storage directory unavailable'))
  await assert.rejects(fs.stat(path), { code: 'ENOENT' })
})
await fixture(async dir => {
  let writes = 0
  const path = join(dir, 'network-link'), io = { ...fs, lstat: async value => value === path ? { isSymbolicLink: () => true } : fs.lstat(value), readlink: async () => '\\\\remote\\share\\missing', mkdir: async () => { writes++; throw Error('Must not create network targets') } }
  await assert.rejects(ensureStorageDirectory(path, { io }), { code: 'unsafe_storage_path' }); assert.equal(writes, 0)
  await assert.rejects(ensureStorageDirectory('\\\\?\\UNC\\remote\\share'), { code: 'unsafe_storage_path' })
})
await fixture(async (dir, link) => {
  const path=join(dir,'relative-link'),target=join(dir,'relative-target');await link(path,target)
  const io={...fs,readlink:async value=>value===path?'relative-target':fs.readlink(value)}
  assert.equal(await ensureStorageDirectory(path,{io}),target)
  if(process.platform==='win32'){
    const extended={...fs,readlink:async value=>value===path?'\\\\?\\'+target:fs.readlink(value)}
    assert.equal(await ensureStorageDirectory(path,{io:extended}),target)
  }
  await assert.rejects(ensureStorageDirectory('https://example.invalid/storage'),{code:'unsafe_storage_path'})
  await assert.rejects(ensureStorageDirectory('\\\\?\\GLOBALROOT\\Device\\storage'),{code:'unsafe_storage_path'})
})
await fixture(async dir => {
  const path = join(dir, 'data', 'overlay.json'), store = new OverlayPreferences(path)
  await store.ready; assert.equal(store.error, null); assert.ok((await fs.stat(dirname(path))).isDirectory())
  await assert.rejects(fs.stat(path), { code: 'ENOENT' })
  await store.update({ widthDip: 530 }, store.revision)
  const saved = await fs.readFile(path, 'utf8'); const again = new OverlayPreferences(path); await again.ready
  assert.equal(again.value.widthDip, 530); assert.equal(await fs.readFile(path, 'utf8'), saved)
})
await fixture(async (dir, link) => {
  const path = join(dir, 'data'), target = join(dir, 'pet-state'); await link(path, target)
  const store = new OverlayPreferences(join(path, 'overlay.json')); await store.ready
  assert.equal(store.error, null); await assert.rejects(fs.stat(store.path), { code: 'ENOENT' })
  await store.update({ opacity: .8 }, 0); assert.equal(JSON.parse(await fs.readFile(join(target, 'overlay.json'), 'utf8')).opacity, .8)
  const macros = new MacroStore(join(path, 'macros.json')); assert.deepEqual(await macros.list(), { templates: [] })
  await assert.rejects(fs.stat(macros.path), { code: 'ENOENT' }); await macros.save('wait', { actions: [{ kind: 'wait', durationMs: 10 }] })
  assert.equal((await macros.list()).templates.length, 1)
  const manager = { store, io: fs, overlay: { defaultModel: join(dir, 'none') } }, library = new ModelLibrary(manager)
  await library.ready; await library.ensureRoot(); assert.equal(library.root, join(target, 'models'))
  await assert.rejects(fs.stat(library.path), { code: 'ENOENT' })
})
await fixture(async dir => {
  const path = join(dir, 'overlay.json'), original = '{broken configuration'; await fs.writeFile(path, original)
  const store = new OverlayPreferences(path); await store.ready; assert.ok(store.error)
  await assert.rejects(store.update({ widthDip: 540 }, store.revision)); assert.equal(await fs.readFile(path, 'utf8'), original)
  const macroPath = join(dir, 'macros.json'); await fs.writeFile(macroPath, '{broken templates')
  await assert.rejects(new MacroStore(macroPath).save('wait', { actions: [{ kind: 'wait', durationMs: 10 }] }))
  assert.equal(await fs.readFile(macroPath, 'utf8'), '{broken templates')
})
await fixture(async (dir, link) => {
  const path = join(dir, 'data'), target = join(dir, 'target'); await link(path, target)
  await ensureStorageDirectory(path); await fs.rmdir(target)
  await new MacroStore(join(path, 'macros.json')).list(); assert.ok((await fs.stat(target)).isDirectory())
})
console.log('Storage regression passed: ' + scenarios + ' isolated scenarios; directory/link creation, lazy files, concurrency, failures and data preservation.')
