import assert from 'node:assert/strict'
import { validatePackageListing } from './validation.mjs'
import { DESKTOP_RUNTIME_DIRECTORY } from '../src/desktop-runtime.js'

const manifest = { name: '@fixture/package', version: '1.0.0' }
const sourceNames = ['package.json', 'index.js', 'CHANGELOG.md', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']
const sourcePaths = sourceNames.filter(name => name !== 'pnpm-lock.yaml')
const runtimeNames = [DESKTOP_RUNTIME_DIRECTORY + '/GamePlayer.Desktop.dll', DESKTOP_RUNTIME_DIRECTORY + '/GamePlayer.Desktop.runtimeconfig.json']
const listing = paths => [{ ...manifest, files: paths.map(path => ({ path })) }]
const validate = (value, options = {}) => validatePackageListing(value, { manifest, sourceNames, ...options })
let scenarios = 0
function check(name, run) {
  try { run(); scenarios++ } catch (error) { throw Error(name + ': ' + error.message, { cause: error }) }
}
check('source-only package needs no runtime or packed pnpm lockfile', () => {
  assert.deepEqual(validate(listing(sourcePaths)), { fileCount: sourcePaths.length, hasRuntime: false })
})
check('default mode permits only the current runtime without claiming completeness', () => {
  assert.deepEqual(validate(listing([...sourcePaths, runtimeNames[0]]), { runtimeNames }), { fileCount: sourcePaths.length + 1, hasRuntime: true })
})
check('release listing contains every required runtime file', () => {
  assert.deepEqual(validate(listing([...sourcePaths, ...runtimeNames]), { requireRuntime: true, runtimeNames }), { fileCount: sourcePaths.length + runtimeNames.length, hasRuntime: true })
})
check('release mode rejects absent runtime even without a required-file list', () => {
  assert.throws(() => validate(listing(sourcePaths), { requireRuntime: true }), /Runtime absent/)
})
check('release mode rejects a partial runtime listing', () => {
  assert.throws(() => validate(listing([...sourcePaths, runtimeNames[0]]), { requireRuntime: true, runtimeNames }), /Required file absent/)
})
for (const field of ['name', 'version']) check('reject mismatched ' + field, () => {
  const value = listing(sourcePaths); value[0][field] = 'different'
  assert.throws(() => validate(value), /identity\/version/)
})
for (const missing of sourcePaths) check('reject missing source ' + missing, () => {
  assert.throws(() => validate(listing(sourcePaths.filter(name => name !== missing))), /Required file absent/)
})
check('reject duplicate paths', () => {
  assert.throws(() => validate(listing([...sourcePaths, sourcePaths[0]])), /Duplicate package paths/)
})
for (const foreign of ['runtime/desktop-0.0.0/old.dll', 'runtime/unexpected.dll', 'runtime',
  DESKTOP_RUNTIME_DIRECTORY + '/', 'Runtime/desktop-0.0.0/old.dll']) {
  for (const requireRuntime of [false, true]) check('reject unexpected runtime path in ' + (requireRuntime ? 'release' : 'default') + ' mode: ' + foreign, () => {
    assert.throws(() => validate(listing([...sourcePaths, ...runtimeNames, foreign]), { requireRuntime, runtimeNames }), /Unexpected runtime path/)
  })
}
for (const unsafe of ['../outside.js', '/outside.js', 'C:/outside.js', 'src\\unsafe.js']) check('reject unsafe path ' + unsafe, () => {
  assert.throws(() => validate(listing([...sourcePaths, unsafe])), /Unsafe package path/)
})
for (const forbidden of ['.qa/cache.js', 'node_modules/dependency/index.js', '.env', 'models/model.moc3',
  DESKTOP_RUNTIME_DIRECTORY + '/debug.pdb', DESKTOP_RUNTIME_DIRECTORY + '/private.key', DESKTOP_RUNTIME_DIRECTORY + '/models/model.moc3']) {
  check('reject prohibited file ' + forbidden, () => {
    assert.throws(() => validate(listing([...sourcePaths, forbidden])), /Private, generated, model or unnecessary file/)
  })
}
for (const malformed of [null, [], [null], [{ ...manifest }], [...listing(sourcePaths), ...listing(sourcePaths)]]) {
  check('reject malformed listing', () => assert.throws(() => validate(malformed), /Expected one npm pack JSON entry/))
}
for (const file of [null, {}, { path: 123 }]) check('reject malformed file entry', () => {
  assert.throws(() => validate([{ ...manifest, files: [file] }]), /Invalid package file entry/)
})
check('validation leaves the original listing intact', () => {
  const value = listing([...sourcePaths, ...runtimeNames]), before = structuredClone(value)
  validate(value)
  assert.deepEqual(value, before)
})
console.log('Package listing regression passed: ' + scenarios + ' in-memory scenarios; no package files were created or runtime files read.')
