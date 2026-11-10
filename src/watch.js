/** Permanently disabled watcher compatibility, plus agent-local image demand. */

/** Receipt values only: these are not settings and never schedule sampling. */
export const WATCH_DISABLED_STATE = Object.freeze({
  running: false, intervalMs: 1000, threshold: 0.03, wakes: 0, maxWakes: 20,
  lastError: 'Automatic screen-change notifications are permanently disabled. Use game_screen to check the current frame.',
})

export function createImageDemand() {
  const pending = new Map()
  let sequence = 0
  return {
    ensure(id) { if (!pending.has(String(id))) pending.set(String(id), ++sequence) },
    mark(id) { pending.set(String(id), ++sequence) },
    current(id) { return pending.get(String(id)) },
    consume(id, token) { if (pending.get(String(id)) === token) pending.delete(String(id)) },
    clear(id) { pending.delete(String(id)) },
    clearAll() { pending.clear() },
  }
}

/** Both identifiers must match; text that merely mentions game-watch is not owned. */
export function isLegacyWatchMessage(message) {
  return message?.source?.kind === 'game-watch'
    && typeof message.id === 'string' && message.id.startsWith('game-watch:')
}

/**
 * Keep the old controller entry points without a sampler, timer or followup.
 * Pending legacy notices are removed by identity through the public Inbox API;
 * claimed history and unrelated input are never cleared or rewritten.
 */
export function createWatchController({ ctx, warn = () => {}, imageDemand, forget = () => {} }) {
  const warned = new WeakSet(), owners = new WeakSet(), dead = new WeakSet()
  let disposed = false, registryWarned = false
  const report = (agent, reason) => {
    if (agent && (typeof agent === 'object' || typeof agent === 'function')) {
      if (warned.has(agent)) return
      warned.add(agent)
    } else {
      if (registryWarned) return
      registryWarned = true
    }
    try { warn('game player: automatic screen-change notifications are disabled; legacy reminder cleanup unavailable: ' + reason) } catch {}
  }
  const clearLegacy = (agent) => {
    try {
      const inbox = agent?.inbox
      if (!inbox || typeof inbox.remove !== 'function' || !Array.isArray(inbox.nextTurn) || !Array.isArray(inbox.nextStep)) {
        report(agent, 'the host does not expose readable pending lists and safe message removal.')
        return
      }
      const ids = new Set([...inbox.nextTurn, ...inbox.nextStep].filter(isLegacyWatchMessage).map(message => message.id))
      for (const id of ids) {
        if (disposed || dead.has(agent)) return
        // Re-read ownership before every removal: host callbacks can claim or
        // replace another pending item while a previous removal is published.
        const current = [...inbox.nextTurn, ...inbox.nextStep].find(message => message.id === id)
        if (current && isLegacyWatchMessage(current)) inbox.remove(id)
      }
    } catch (error) { report(agent, String(error?.message ?? error)) }
  }
  const ownImages = (agent) => {
    if (!imageDemand || owners.has(agent) || typeof agent?.ctx?.effect !== 'function') return
    owners.add(agent)
    agent.ctx.effect(() => () => {
      dead.add(agent)
      imageDemand.clear(String(agent.id))
      if (!disposed) void Promise.resolve().then(() => forget('screen:' + agent.id)).catch(() => {})
    }, 'game-player.image-owner')
  }
  const visit = (agent) => {
    if (disposed || !agent || dead.has(agent)) return
    clearLegacy(agent)
    ownImages(agent)
  }
  const state = (agent) => { visit(agent); return { ...WATCH_DISABLED_STATE } }

  ctx.on('agent/created', ({ agent }) => visit(agent))
  // The optional registry covers already attached agents during plugin reload;
  // agent/created covers restored/new sessions before their loop starts.
  if (typeof ctx.inject === 'function') ctx.inject(['agents'], agentsCtx => {
    if (disposed) return
    let registry
    try { registry = agentsCtx.agents } catch { return }
    if (typeof registry?.list !== 'function') return
    try { for (const agent of registry.list()) visit(agent) }
    catch (error) { report(undefined, String(error?.message ?? error)) }
  })
  ctx.effect(() => () => { disposed = true; imageDemand?.clearAll() }, 'game-player.watch-compat')
  return { status: state, start: state, stop: state }
}
