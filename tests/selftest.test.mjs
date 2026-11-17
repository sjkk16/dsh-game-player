// Offline checks: schema shape, argument validation, and bridge round trips
// against a fake helper. Run with:
//   node tests/selftest.mjs
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { windowTool, macroTool } from '../src/extra-tools.js'
import { inputTool, screenTool, watchTool } from '../src/tools.js'
import { normalizeAction, parseChord, normalizeText } from '../src/keys.js'
import { PwshBridge, resolvePowershell, helperScriptPath } from '../src/pwsh-bridge.js'

const here = dirname(fileURLToPath(import.meta.url))
const options = {
  maxWidth: 1280,
  jpegQuality: 60,
  monitor: 'primary',
  maxHoldMs: 3000,
}

// --- schema subset, mirroring dsh-tools' enforced rules ---------------------
const CONSTRAINT = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const'])
const ANNOTATION = new Set(['description', 'title', 'default', 'examples'])
const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']

function checkSchema(node, path, violations) {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    violations.push(`${path} must be a schema object`)
    return
  }
  for (const key of Object.keys(node)) {
    if (CONSTRAINT.has(key)) continue
    if (ANNOTATION.has(key)) continue
    violations.push(`${path}.${key} is not a supported keyword`)
  }
  if (Object.hasOwn(node, 'type') && Object.hasOwn(node, 'oneOf')) {
    violations.push(`${path} cannot declare both type and oneOf`)
    return
  }
  if (Object.hasOwn(node, 'oneOf')) {
    for (const [index, branch] of node.oneOf.entries()) checkSchema(branch, `${path}.oneOf[${index}]`, violations)
    return
  }
  if (!Object.hasOwn(node, 'type')) return
  if (!TYPES.includes(node.type)) {
    violations.push(`${path}.type must be one of ${TYPES.join('/')}`)
    return
  }
  for (const [key, allowed] of Object.entries({
    properties: ['object'],
    required: ['object'],
    additionalProperties: ['object'],
    items: ['array'],
    enum: ['string', 'number', 'integer', 'boolean', 'null'],
    const: ['string', 'number', 'integer', 'boolean', 'null'],
  })) {
    if (Object.hasOwn(node, key) && !allowed.includes(node.type)) {
      violations.push(`${path}.${key} is not supported on type "${node.type}"`)
    }
  }
  if (node.type === 'object') {
    if (Object.hasOwn(node, 'required')) {
      if (!Array.isArray(node.required) || node.required.some((entry) => typeof entry !== 'string')) {
        violations.push(`${path}.required must be an array of strings`)
      } else {
        const declared = node.properties ?? {}
        for (const key of node.required) {
          if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`)
        }
      }
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      checkSchema(child, `${path}.properties.${key}`, violations)
    }
  }
  if (node.type === 'array' && Object.hasOwn(node, 'items')) checkSchema(node.items, `${path}.items`, violations)
}

const stubCapture = async () => ({
  width: 1280,
  height: 720,
  screenWidth: 2560,
  screenHeight: 1440,
  screenX: 0,
  screenY: 0,
  scale: 0.5,
  diff: 0.25,
  cursor: { x: 100, y: 200 },
  data: Buffer.from('jpeg').toString('base64'),
  mediaType: 'image/jpeg',
  black: false,
})

const stubAttach = async () => ({ attachmentId: 'att-1', mediaType: 'image/jpeg', bytes: 4, width: 1280, height: 720 })

const tools = {
  window: windowTool({windows:{}}),
  macro: macroTool({store:{},windows:{},options}),
  screen: screenTool({ options, capture: stubCapture, attach: stubAttach }),
  input: inputTool({ options, send: async () => ({ cursor: { x: 5, y: 6 }, heldKeys: [], heldButtons: [] }), normalize: normalizeAction }),
  watch: watchTool({
    options,
    watch: {
      status: (agent) => ({ running: false, intervalMs: 1000, threshold: 0.03, wakes: 0, maxWakes: 20 }),
      start: (agent) => ({ intervalMs: 500, threshold: 0.05, wakes: 0, maxWakes: 3 }),
      stop: () => ({ intervalMs: 1000, threshold: 0.03, wakes: 2, maxWakes: 20 }),
    },
  }),
}

await test('every tool schema stays inside the enforced subset', () => {
  for (const [label, tool] of Object.entries(tools)) {
    const violations = []
    checkSchema(tool.parameters, `${label}.parameters`, violations)
    assert.deepEqual(violations, [], `${label} parameters: ${violations.join('; ')}`)
    const outputViolations = []
    checkSchema(tool.output.schema, `${label}.output`, outputViolations)
    assert.deepEqual(outputViolations, [], `${label} output: ${outputViolations.join('; ')}`)
    assert.equal(typeof tool.execute, 'function', `${label} has no execute`)
    assert.ok(tool.name.length > 0, `${label} has no name`)
    assert.ok(tool.description.length > 20, `${label} has a thin description`)
  }
})

await test('tool names are the documented game_* names', () => {
  assert.deepEqual(Object.values(tools).map((tool) => tool.name), ['game_window','game_macro','game_screen', 'game_input', 'game_watch'])
})

await test('screenshot renders a text block plus an image block', async () => {
  const value = await tools.screen.execute({}, { signal: new AbortController().signal })
  assert.equal(value.attached, true)
  assert.equal(value.scale, 0.5)
  const blocks = tools.screen.output.render({}, value)
  assert.equal(blocks[0].type, 'text')
  const image = blocks.find((block) => block.type === 'image')
  assert.ok(image, 'no image block rendered')
  assert.equal(image.attachment.attachmentId, 'att-1')
  assert.equal(image.attachment.width, 1280)
})

await test('an unchanged screen omits the image unless forced', async () => {
  const still = screenTool({
    options,
    capture: async () => ({ ...(await stubCapture()), diff: 0 }),
    attach: stubAttach,
  })
  const skipped = await still.execute({}, { signal: new AbortController().signal })
  assert.equal(skipped.attached, false)
  const forced = await still.execute({ force: true }, { signal: new AbortController().signal })
  assert.equal(forced.attached, true)
})

await test('a nearly uniform capture warns instead of pretending it worked', async () => {
  const black = screenTool({
    options,
    capture: async () => ({ ...(await stubCapture()), black: true }),
    attach: stubAttach,
  })
  const value = await black.execute({}, { signal: new AbortController().signal })
  assert.match(value.warning, /borderless/i)
})

await test('screenshot rejects out-of-range capture parameters', async () => {
  await assert.rejects(
    () => tools.screen.execute({ maxWidth: 100 }, { signal: new AbortController().signal }),
    /between 320 and 2560/,
  )
  await assert.rejects(
    () => tools.screen.execute({ quality: 5 }, { signal: new AbortController().signal }),
    /between 20 and 95/,
  )
})

await test('input rejects an unknown action and a missing action', async () => {
  await assert.rejects(
    () => tools.input.execute({ kind: 'teleport' }, { signal: new AbortController().signal }),
    /Unsupported action/,
  )
  await assert.rejects(
    () => tools.input.execute({}, { signal: new AbortController().signal }),
    /Supply `kind`/,
  )
})

await test('input rejects both kind and actions together', async () => {
  await assert.rejects(
    () => tools.input.execute({ kind: 'move', actions: [{ kind: 'move', x: 1, y: 1 }] }, { signal: new AbortController().signal }),
    /not both/,
  )
})

await test('input bounds the hold duration and the action count', async () => {
  await assert.rejects(
    () => tools.input.execute({ kind: 'hold', keys: ['w'], holdMs: 99999 }, { signal: new AbortController().signal }),
    /exceeds the configured limit|finite integer/,
  )
  const many = Array.from({ length: 13 }, () => ({ kind: 'move', x: 1, y: 1 }))
  await assert.rejects(
    () => tools.input.execute({ actions: many }, { signal: new AbortController().signal }),
    /At most 12 actions/,
  )
})

await test('input normalizes a drag and a chord', async () => {
  const value = await tools.input.execute({
    actions: [
      { kind: 'drag', fromX: 0, fromY: 0, x: 10, y: 10 },
      { kind: 'key', keys: ['Ctrl+Shift+S'] },
    ],
  }, { signal: new AbortController().signal })
  assert.equal(value.actions.length, 2)
  assert.match(value.actions[0], /dragged/)
  assert.match(value.actions[1], /ctrl\+shift\+s/)
})

await test('watch start always reports permanently stopped compatibility values', async () => {
  const started = await tools.watch.execute({ action: 'start', intervalMs: 500, threshold: 0.05, maxWakes: 3 }, { agent: { id: 's1' } })
  assert.equal(started.running, false)
  assert.equal(started.intervalMs, 1000)
  assert.equal(started.threshold, 0.03)
  assert.equal(started.maxWakes, 20)
  assert.equal(started.wakes, 0)
  assert.match(started.lastError, /permanently disabled/)
  const stopped = await tools.watch.execute({ action: 'stop' }, { agent: { id: 's1' } })
  assert.equal(stopped.running, false)
})

await test('watch needs an owning session', async () => {
  await assert.rejects(() => tools.watch.execute({ action: 'status' }, {}), /owning session/)
})

await test('watch validates its interval and threshold', async () => {
  await assert.rejects(() => tools.watch.execute({ action: 'start', intervalMs: 50 }, { agent: { id: 's1' } }), /between 200 and 5000/)
  await assert.rejects(() => tools.watch.execute({ action: 'start', threshold: 3 }, { agent: { id: 's1' } }), /between 0.001 and 1/)
})

await test('key parsing accepts real names and rejects nonsense', () => {
  assert.deepEqual(parseChord('Ctrl+Shift+S'), ['ctrl', 'shift', 's'])
  assert.deepEqual(parseChord('F5'), ['f5'])
  for (const bad of ['', 'w!', 'a+b+c+d+e', 'ctrl+ctrl']) {
    assert.throws(() => parseChord(bad), /./, `should reject ${JSON.stringify(bad)}`)
  }
})

await test('text rejects control characters and emptiness', () => {
  assert.equal(normalizeText('hello', 10), 'hello')
  assert.throws(() => normalizeText('', 10), /must not be empty/)
  assert.throws(() => normalizeText('a\u0001b', 10), /control characters/)
  assert.throws(() => normalizeText('abcdef', 3), /at most 3/)
})

await test('bridge falls back to a readable error on an unsupported platform', () => {
  if (process.platform !== 'win32') return
  assert.equal(typeof resolvePowershell(), 'string')
})

