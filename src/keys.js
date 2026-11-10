/** Shared, canonical key names and strictly validated wire actions. */
import { readFileSync } from 'node:fs'
export const KEY_MAP = JSON.parse(readFileSync(new URL('./key-map.json', import.meta.url), 'utf8'))
export const MAX_CHORD_KEYS = 4
export const MAX_TEXT = 2000
export const MAX_ACTIONS = 12
export const INPUT_ACTIONS = ['move', 'click', 'down', 'up', 'scroll', 'key', 'keydown', 'keyup', 'hold', 'type', 'drag', 'wait']

export function parseChord(chord) {
  if (typeof chord !== 'string' || chord.trim() === '') throw new Error('A key name must be a non-empty string.')
  const names = chord.trim().toLowerCase().split(/\s*\+\s*/).map((name) => Object.hasOwn(KEY_MAP.aliases, name) ? KEY_MAP.aliases[name] : name)
  if (names.length > MAX_CHORD_KEYS) throw new Error(`A chord may hold at most ${MAX_CHORD_KEYS} keys.`)
  for (const name of names) if (!Object.hasOwn(KEY_MAP.keys, name)) throw new Error(`Unsupported key "${name}".`)
  if (new Set(names).size !== names.length) throw new Error('A chord must not repeat a key or alias.')
  return names
}
export function normalizeKeys(value) {
  const entries = typeof value === 'string' ? [value] : value
  if (!Array.isArray(entries) || !entries.length) throw new Error('At least one key must be named.')
  const names = entries.flatMap(parseChord)
  if (names.length > MAX_CHORD_KEYS) throw new Error(`A chord may hold at most ${MAX_CHORD_KEYS} keys.`)
  if (new Set(names).size !== names.length) throw new Error('A chord must not repeat a key or alias.')
  return names
}
export function normalizeText(value, limit = MAX_TEXT) {
  if (typeof value !== 'string') throw new Error('text must be a string.')
  if (!value.length) throw new Error('text must not be empty.')
  if (value.length > limit) throw new Error(`text must be at most ${limit} UTF-16 code units.`)
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('text must not contain control characters. Send Enter or Tab as key actions.')
  // Unicode SendInput accepts surrogate pairs, not isolated surrogates.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error('text contains an unpaired Unicode surrogate.')
  return value
}
function integer(value, label, min = -2147483648, max = 2147483647) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be a finite integer between ${min} and ${max}.`)
  return value
}
export function normalizeAction(action, maxHoldMs = 3000) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Each action must be an object.')
  const { kind } = action
  if (!INPUT_ACTIONS.includes(kind)) throw new Error(`Unsupported action "${kind}".`)
  const out = { kind }
  if (['move','drag'].includes(kind) || (kind === 'click' && (action.x !== undefined || action.y !== undefined))) {
    out.x = integer(action.x, 'x'); out.y = integer(action.y, 'y')
  }
  if (['click','down','up','drag'].includes(kind)) {
    const button = action.button ?? 'left'
    if (!['left','right','middle'].includes(button)) throw new Error('button must be left, right, or middle.')
    out.button = button
  }
  if (kind === 'click') out.count = integer(action.count ?? 1, 'count', 1, 5)
  if (kind === 'scroll') {
    out.amount = integer(action.amount ?? 120, 'amount', -12000, 12000)
    if (!out.amount) throw new Error('amount must not be zero.')
  }
  if (['key','keydown','keyup','hold'].includes(kind)) out.keys = normalizeKeys(action.keys)
  if (kind === 'hold') {
    out.holdMs = integer(action.holdMs ?? 200, 'holdMs', 10, 60000)
    if (out.holdMs > maxHoldMs) throw new Error(`holdMs ${out.holdMs} exceeds the configured limit of ${maxHoldMs} ms.`)
  }
  if (kind === 'wait') out.durationMs = integer(action.durationMs, 'durationMs', 0, 60000)
  if (kind === 'type') out.text = normalizeText(action.text)
  if (kind === 'drag') {
    out.fromX = integer(action.fromX, 'fromX'); out.fromY = integer(action.fromY, 'fromY')
    out.steps = integer(action.steps ?? 12, 'steps', 2, 60)
  }
  return out
}
/** Delays plus scheduling overhead; enforced both here and in PowerShell. */
export function actionBudget(action) {
  switch (action.kind) {
    case 'wait': return action.durationMs + 100
    case 'hold': return action.holdMs + 100
    case 'key': return 130
    case 'click': return 100 + action.count * 88
    case 'drag': return 140 + action.steps * 18
    case 'type': return 100 + action.text.length * 8
    default: return 100
  }
}
export function validateBudget(actions, timeoutMs = 15000, repeat = 1) {
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20 || actions.length * repeat > 120) throw new Error('repeat must be 1 to 20 with at most 120 total steps.')
  const budget = repeat * actions.reduce((total, action) => total + actionBudget(action), 0)
  if (budget > timeoutMs - 1000) throw new Error(`Batch execution budget ${budget} ms exceeds helper timeout minus 1000 ms cleanup margin.`)
  return budget
}

/** Standalone templates/repeated gestures may not inherit or leave held input. */
export function validateBalanced(actions, maxHoldMs = 3000) {
  const held = new Map(); let elapsed = 0
  for (const a of actions) {
    const ids = a.keys?.map(k => 'key:' + k) ?? ['button:' + a.button]
    if (a.kind === 'keydown' || a.kind === 'down') for (const id of ids) { if (!held.has(id)) held.set(id, elapsed) }
    if (a.kind === 'keyup' || a.kind === 'up') for (const id of ids) { if (!held.delete(id)) throw new Error('Standalone sequence releases input it did not press.') }
    elapsed += actionBudget(a)
    for (const started of held.values()) if (elapsed - started > maxHoldMs) throw new Error('Sequence held input exceeds maxHoldMs budget.')
  }
  if (held.size) throw new Error('Standalone sequence must release every explicit down/keydown.')
}
