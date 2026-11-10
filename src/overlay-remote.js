import { Service } from '@deepseek-ai/cordis'
import { validateMotionAction } from './live2d/motions.js'
import { validatePreferenceRequest, preferenceError } from './overlay-preferences.js'

const NS = 'gamePlayerOverlay', PACKAGE = '@local/dsh-game-player'
const codec = (name, parse) => ({ mode: 'strict', typeSymbol: PACKAGE + '#' + name, create: () => ({ parse }) })
const stateCodec = codec('OverlayState', value => {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.revision) || !value.preferences) throw new TypeError('Invalid overlay state.')
  return value
})
const resultCodec = codec('OverlayResult', value => {
  if (!value || typeof value.success !== 'boolean') throw new TypeError('Invalid overlay result.')
  stateCodec.create().parse(value.state); return value
})
const parameter = (name, parser) => ({ name, wire: name, source: 'json', optional: false, codec: codec(name, parser) })
const descriptor = (method, parameters, result, cancel = false) => ({
  id: PACKAGE + '#' + NS + '/' + method, service: NS, namespace: NS, method,
  invocation: { kind: 'direct' }, parameters, result,
  ...(cancel ? { cancellation: { parameter: 'signal' } } : {}),
})
/** Versioned public Typert contribution; strict codecs do not need a second schema runtime. */
export const OVERLAY_CONTRIBUTION = {
  package: PACKAGE, face: 'host', schemas: [], model: { services: [], events: [], objects: [] },
  invocations: [
    descriptor('getState', [], stateCodec),
    descriptor('updatePreferences', [parameter('patch', validatePreferenceRequest), parameter('revision', value => {
      if (!Number.isSafeInteger(value) || value < 0) throw preferenceError('invalid_revision', 'Invalid preference revision.')
      return value
    })], resultCodec, true),
    descriptor('command', [parameter('action', value => {
      return validateMotionAction(value)
    })], resultCodec, true),
  ],
}
export class OverlayRemote extends Service {
  constructor(ctx, manager) {
    super(ctx, NS); this.manager = manager
    this.typertRemote = Object.freeze({ service: this, serviceKey: NS, namespace: NS })
  }
  owner() {
    if (this.ctx.invocation?.peer?.principal?.kind !== 'owner') throw preferenceError('owner_required', 'Desktop management is restricted to the Host owner.')
  }
  async getState() { this.owner(); return this.manager.getState() }
  async updatePreferences(patch, revision, signal) {
    this.owner(); return this.result(() => this.manager.updatePreferences(patch, revision, signal))
  }
  async command(action, signal) { this.owner(); return this.result(() => this.manager.command(action, signal)) }
  async result(operation) {
    try { await operation(); return { success: true, state: await this.manager.getState() } }
    catch (error) { return { success: false, error: { code: error.code ?? 'operation_failed', message: String(error.message).slice(0,1000) }, state: await this.manager.getState() } }
  }
}
export function installOverlayRemote(ctx, manager) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['typert'], child => {
    let registry
    try{registry=child.typert;if(typeof registry?.register!=='function'||typeof child.reflect?.provide!=='function')return}catch{return}
    new OverlayRemote(child, manager)
    registry.register(OVERLAY_CONTRIBUTION)
  })
}
