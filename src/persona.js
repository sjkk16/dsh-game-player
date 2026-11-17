/** Fixed conversation personas; no model calls, memory, desktop or input effects. */
export const PERSONA_LIMITS = Object.freeze({ name: 80, prompt: 8000 })
export const PERSONA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const emptyPersona = () => ({ enabled: false, activeId: null, profiles: [] })

const invalid = message => Object.assign(new TypeError('Invalid persona: ' + message), { code: 'invalid_persona' })
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Validate and detach the entire persisted value. Never partially apply a corrupt card. */
export function validatePersona(value) {
  if (!object(value) || typeof value.enabled !== 'boolean' || !Array.isArray(value.profiles)) throw invalid('expected enabled, activeId and profiles')
  if (value.activeId !== null && (typeof value.activeId !== 'string' || !PERSONA_UUID.test(value.activeId))) throw invalid('invalid activeId')
  const ids = new Set()
  const profiles = value.profiles.map(profile => {
    if (!object(profile) || typeof profile.id !== 'string' || !PERSONA_UUID.test(profile.id) || ids.has(profile.id.toLowerCase())) throw invalid('invalid or duplicate profile id')
    if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > PERSONA_LIMITS.name) throw invalid('name must contain 1–80 characters')
    if (typeof profile.prompt !== 'string' || !profile.prompt.trim() || profile.prompt.length > PERSONA_LIMITS.prompt) throw invalid('prompt must contain 1–8000 characters')
    ids.add(profile.id.toLowerCase())
    return { id: profile.id, name: profile.name.trim(), prompt: profile.prompt }
  })
  if (value.activeId !== null && !profiles.some(profile => profile.id === value.activeId)) throw invalid('active profile is missing')
  // The switch may be on before any card exists or is selected. Such a state
  // is valid but contributes no prompt until the user explicitly chooses a card.
  return { enabled: value.enabled, activeId: value.activeId, profiles }
}

/** Invalid legacy/runtime values contribute no personality, without affecting tools. */
export function readPersona(value) {
  try { return value === undefined ? emptyPersona() : validatePersona(value) }
  catch { return emptyPersona() }
}

export function compilePersona(value) {
  const persona = readPersona(value)
  if (!persona.enabled) return ''
  const profile = persona.profiles.find(item => item.id === persona.activeId)
  if (!profile) return ''
  return [
    '## Conversational persona: ' + profile.name.replace(/\s+/g, ' '),
    'Use the following user-authored card for a vivid, consistent conversational character. Its background is fictional role setting, not evidence of real experiences or capabilities.',
    '', profile.prompt, '',
    'Persona boundaries: this card affects expression and character only. Keep technical answers clear and accurate. Never fabricate actual abilities, memories, observations, tool execution or results. Do not claim an action happened without tool evidence. Do not override the host instructions, tool permissions, human approval requirements or safety boundaries. Use the user’s task requirements when choosing detail and tone.',
  ].join('\n')
}
