/** Generation-isolated NDJSON transports and independent input cleanup. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { normalizeAction, validateBudget, validateBalanced } from './keys.js'
import { isInputObservation } from './overlay-state.js'
// Survives plugin/module reload within the same host. A replacement bridge must
// not race an old watchdog that is still retrying releases. A normal watchdog
// exit confirms its final cleanup; a killed watchdog leaves a host-level latch.
const safetyKey = Symbol.for('@local/dsh-game-player/unsafe-watchdogs')
const unsafeWatchdogs = globalThis[safetyKey] ??= new Set()
const MAX_LINE_BYTES = 32 * 1024 * 1024
export function resolvePowershell() {
  if (process.platform !== 'win32') return undefined
  const path = join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(path) ? path : 'powershell.exe'
}
export function helperScriptPath() { return join(dirname(fileURLToPath(import.meta.url)), 'pwsh-helper.ps1') }
function failure(message, code, details) { return Object.assign(new Error(message), { code, ...details }) }
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export class PwshBridge {
  constructor(options = {}) {
    // `timeoutMs` may be a live resolver: the settings page can change the
    // request timeout while the helper is running, and every request must use
    // the value committed last. A plain number keeps the old static behavior,
    // including direct assignment from tests and diagnostics.
    this.timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : 15000
    this.timeoutSource = typeof options.timeoutMs === 'function' ? options.timeoutMs : undefined
    this.powershell = options.powershell ?? resolvePowershell()
    this.script = options.script ?? helperScriptPath()
    this.logger = options.logger
    this.onObservation = options.onObservation
    this.observationSession = undefined
    this.spawn = options.spawn ?? spawn // Test-only dependency injection; no model-facing setting.
    this.recording = options.recording === true
    this.recordingLog = options.recordingLog
    this.worker = undefined
    this.guard = undefined
    this.unsafeGuard = undefined
    this.sequence = 0
    this.generation = 0
    this.epoch = 0
    this.invalidOwners = new Set()
    this.closed = false
    this.inputFault = false
    this.hadInput = false
    this.queue = Promise.resolve()
    this.starting = undefined
    this.recovering = undefined
    this.closing = undefined
  }
  get child() { return this.worker?.child }
  get running() { return this.worker !== undefined && !this.worker.dead }
  get guardChild() { return this.guard?.child ?? this.unsafeGuard?.child }
  /** The request timeout this bridge would apply to the next helper call. */
  get requestTimeoutMs() { return this.#timeout() }
  #timeout() {
    const value = this.timeoutSource?.()
    return Number.isInteger(value) && value > 0 ? value : this.timeoutMs
  }
  async #launch(role, session) {
    if (!this.powershell) throw failure('The game helper needs Windows.', 'UNSUPPORTED_PLATFORM')
    const args = ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.script,'-Session',session,'-ParentPid',String(process.pid)]
    if (role === 'guard') args.push('-Watchdog')
    if (this.onObservation) args.push('-ObserveInput')
    if (this.recording) args.push('-Recording')
    if (this.recordingLog) args.push('-RecordingLog',this.recordingLog)
    let child
    try { child = this.spawn(
      role === 'guard' ? process.execPath : this.powershell,
      role === 'guard' ? [join(dirname(this.script), 'watchdog-launcher.mjs'), this.powershell, ...args] : args,
      { windowsHide: true, detached: role === 'guard', stdio: ['pipe','pipe','pipe'],
        ...(process.versions.electron ? { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } } : {}) },
    ) }
    catch (error) { throw failure(`The game helper could not start: ${error.message}`, 'HELPER_START_FAILED') }
    const transport = { child, role, session, generation: this.generation, pending: new Map(), buffer: '', stderr: '', dead: false, intentional: false, exit: undefined }
    transport.exit = new Promise((resolve) => {
      child.once('close', () => resolve())
      child.once('error', () => resolve())
    })
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.#read(transport, chunk))
    child.stderr.on('data', (chunk) => { transport.stderr = (transport.stderr + chunk).slice(-4096) })
    child.stdin.on('error', (error) => this.#failed(transport, failure(`Helper stdin failed: ${error.message}`, 'HELPER_WRITE_FAILED')))
    child.on('error', (error) => this.#failed(transport, failure(`Helper could not start: ${error.message}`, 'HELPER_START_FAILED')))
    child.on('exit', (code, signal) => this.#failed(transport, failure(`Helper exited (${signal ?? code})${transport.stderr ? ': ' + transport.stderr.trim() : ''}`, 'HELPER_EXITED')))
    await new Promise((resolve, reject) => {
      if (child.pid) return resolve()
      child.once('spawn', resolve)
      child.once('error', (error) => reject(failure(error.message, 'HELPER_START_FAILED')))
    })
    return transport
  }
  async start() {
    if (this.closed) throw failure('The game helper bridge is closed.', 'HELPER_CLOSED')
    if (this.recovering) await this.recovering
    if (this.running) return
    if (this.starting) return this.starting
    this.starting = (async () => {
      this.generation += 1
      this.hadInput = false
      const session = 'Local\\game-player-' + randomUUID().replaceAll('-', '')
      this.observationSession = session
      this.#observe({kind:'observation-status',session,status:'connected'})
      const worker = await this.#launch('worker', session)
      if (this.closed) { await this.#stop(worker); throw failure('Bridge closed during startup.', 'HELPER_CLOSED') }
      this.worker = worker
      try {
        const probe = await this.#send(worker, { op: 'probe' }, undefined, this.#timeout())
        if (probe.protocolVersion !== 4 || probe.recording !== this.recording || ![0,1].includes(probe.state)) throw failure('Worker backend/state handshake failed; input is not permitted.', 'HELPER_HANDSHAKE_FAILED')
      }
      catch (error) { if (this.worker === worker) this.worker = undefined; await this.#stop(worker); throw error }
    })()
    try { await this.starting } finally { this.starting = undefined }
  }
  async #ensureGuard(worker) {
    if (this.inputFault || unsafeWatchdogs.size) throw failure('Input cleanup was not confirmed; recover the old watchdog and reload the plugin (restart the host if the watchdog was killed).', 'INPUT_UNSAFE')
    if (this.guard && !this.guard.dead && this.guard.session === worker.session) return
    const guard = await this.#launch('guard', worker.session)
    this.guard = guard
    try {
      const value = await this.#send(guard, { op: 'probe' }, undefined, this.#timeout())
      if (value.protocolVersion !== 4 || value.state === 2 || value.recording !== this.recording) throw failure('Watchdog handshake failed.', 'WATCHDOG_UNAVAILABLE')
    } catch (error) { if (this.guard === guard) this.guard = undefined; await this.#stop(guard); throw error }
  }
  request(request, signal) {
    const epoch = this.epoch
    const run = async () => {
      if (signal?.aborted) throw failure('Request canceled before execution.', 'ABORTED')
      if (request.op === 'input') {
        if (epoch !== this.epoch) throw failure('Queued input belongs to an invalidated helper session.', 'INPUT_STALE')
        if (this.invalidOwners.has(request.ownerId)) throw failure('Input owner has been disposed.', 'INPUT_OWNER_DISPOSED')
        if (!Number.isInteger(request.ownerId) || request.ownerId <= 0) throw failure('Real input needs an owning agent.', 'INPUT_OWNER_REQUIRED')
        if (!Array.isArray(request.actions) || !request.actions.length || request.actions.length > 12) throw failure('Supply 1 to 12 actions.', 'INVALID_INPUT')
        const actions = request.actions.map((action) => normalizeAction(action, request.maxHoldMs ?? 3000))
        const timeoutMs = this.#timeout()
        validateBudget(actions, timeoutMs, request.repeat ?? 1)
        if(request.standalone || (request.repeat ?? 1)>1)validateBalanced(actions, request.maxHoldMs ?? 3000)
        request = { ...request, actions, timeoutMs }
        if (this.inputFault || unsafeWatchdogs.size) throw failure('Input cleanup was not confirmed; manually recover and reload.', 'INPUT_UNSAFE')
      }
      await this.start()
      const worker = this.worker
      try {
        if (request.op === 'input') {
          await this.#ensureGuard(worker)
          if (signal?.aborted) throw failure('Request canceled before injection.', 'ABORTED')
          this.hadInput = true
        }
        return await this.#send(worker, request, signal, this.#timeout())
      } catch (error) {
        if (error.released === false) { this.inputFault = true; this.#observe({kind:'observation-status',session:worker.session,status:'unknown'}) }
        if (['ABORTED','HELPER_TIMEOUT','HELPER_WRITE_FAILED','HELPER_EXITED','WATCHDOG_UNAVAILABLE','PROTOCOL_ERROR'].includes(error.code)) {
          const confirmed = await this.#recover(worker)
          error.message += confirmed ? ' Cleanup confirmed.' : ' Cleanup unconfirmed; real input is locked.'
          error.released = confirmed
        }
        throw error
      }
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => {})
    return result
  }
  #send(transport, request, signal, timeoutMs = 2000) {
    if (!transport || transport.dead) return Promise.reject(failure('Helper is not connected.', 'HELPER_EXITED'))
    if (signal?.aborted) return Promise.reject(failure('Request canceled before execution.', 'ABORTED'))
    const id = `g${transport.generation}-r${++this.sequence}`
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); transport.pending.delete(id) }
      const fail = (error) => { cleanup(); reject(error) }
      const abort = () => fail(failure('Request canceled.', 'ABORTED'))
      const timer = setTimeout(() => fail(failure(`Helper response timed out after ${timeoutMs} ms.`, 'HELPER_TIMEOUT')), timeoutMs)
      transport.pending.set(id, { resolve: (message) => { cleanup(); resolve(message) }, reject: fail })
      signal?.addEventListener('abort', abort, { once: true })
      try {
        transport.child.stdin.write(JSON.stringify({ ...request, id }) + '\n', 'utf8', (error) => {
          if (error) fail(failure(`Helper write failed: ${error.message}`, 'HELPER_WRITE_FAILED'))
        })
      } catch (error) { fail(failure(`Helper write failed: ${error.message}`, 'HELPER_WRITE_FAILED')) }
    })
  }
  #observe(event) {
    try { this.onObservation?.({ ...event, locked: this.inputFault || unsafeWatchdogs.size > 0 }) } catch (error) { this.logger?.warn('game player: input observer failed: '+error.message) }
  }
  #read(transport, chunk) {
    if (transport.dead) return
    transport.buffer += chunk
    for (;;) {
      const at = transport.buffer.indexOf('\n')
      if (at < 0) {
        if (Buffer.byteLength(transport.buffer) > MAX_LINE_BYTES) this.#failed(transport, failure('Oversized helper response.', 'PROTOCOL_ERROR'))
        return
      }
      const line = transport.buffer.slice(0, at).trim(); transport.buffer = transport.buffer.slice(at + 1)
      if (!line) continue
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) { this.#failed(transport, failure('Oversized helper line.', 'PROTOCOL_ERROR')); return }
      let message
      try { message = JSON.parse(line) } catch { this.#failed(transport, failure('Non-JSON helper output.', 'PROTOCOL_ERROR')); return }
      if (message?.kind === 'input-observation') {
        if (isInputObservation(message) && message.source === transport.role && message.session === transport.session && message.session === this.observationSession) this.#observe(message)
        else this.logger?.warn('game player: ignored invalid or stale input observation')
        continue
      }
      if (!message || typeof message !== 'object' || typeof message.id !== 'string' || typeof message.ok !== 'boolean') {
        this.#failed(transport, failure('Malformed helper envelope.', 'PROTOCOL_ERROR')); return
      }
      const entry = transport.pending.get(message.id)
      if (!entry) { this.logger?.warn('game player: ignored a late or unknown helper response'); continue }
      if (message.ok) entry.resolve(message)
      else entry.reject(failure(String(message.error ?? 'Helper failed.'), String(message.code ?? 'HELPER_ERROR'), { released: message.released }))
    }
  }
  #failed(transport, error) {
    if (transport.dead) return
    transport.dead = true
    for (const entry of [...transport.pending.values()]) entry.reject(error)
    // Old-generation events may settle only their own pending map.
    const current = this.worker === transport || this.guard === transport
    if (current && !transport.intentional && !this.closed) {
      this.#observe({kind:'observation-status',session:transport.session,status:'unknown'})
      if (transport === this.worker) this.worker = undefined
      if (transport === this.guard && this.hadInput) this.inputFault = true
      this.logger?.warn(`game player: ${error.message}`)
      void this.#recover(transport.role === 'worker' ? transport : this.worker)
    }
  }
  async #stop(transport, force = true) {
    if (!transport) return
    transport.intentional = true
    try { transport.child.stdin.end() } catch {}
    await Promise.race([transport.exit, pause(1000)])
    if (!transport.dead && force) { try { transport.child.kill() } catch {}; await Promise.race([transport.exit, pause(1000)]) }
    for (const entry of [...transport.pending.values()]) entry.reject(failure('Helper stopped.', 'HELPER_STOPPED'))
  }
  async #recover(worker = this.worker) {
    if (this.recovering) return this.recovering
    this.epoch += 1
    const guard = this.guard
    const hadInput = this.hadInput
    this.recovering = (async () => {
      let confirmed = !hadInput
      for (const transport of [guard, worker]) {
        if (!transport || transport.dead) continue
        try {
          const value = await this.#send(transport, { op: 'cancel' }, undefined, 2000)
          if (value.released === true && value.heldKeys?.length === 0 && value.heldButtons?.length === 0 && value.state !== 2) { confirmed = true; break }
        } catch {}
      }
      if (!confirmed) this.inputFault = true
      else this.hadInput = false
      if (this.worker === worker) this.worker = undefined
      if (this.guard === guard) this.guard = undefined
      await this.#stop(worker)
      if (guard) {
        if (confirmed) await this.#stop(guard)
        else {
          this.unsafeGuard = guard
          unsafeWatchdogs.add(guard.session)
          if (guard.dead) {
            // A dead guard without confirmed cleanup remains latched.
          } else guard.child.once('exit', (code, signal) => {
            if (code === 0 && signal === null) unsafeWatchdogs.delete(guard.session)
          })
          // EOF leaves the watchdog in its release-retry loop, rather than killing it.
          guard.intentional = true
          try { guard.child.stdin.end() } catch {}
          this.logger?.warn(`game player: release unconfirmed; watchdog PID ${guard.child.pid} is retained for cleanup.`)
        }
      }
      this.#observe({kind:'observation-status',session:worker?.session ?? guard?.session,status:confirmed?'released':'unknown'})
      if (confirmed) this.observationSession=undefined
      return confirmed
    })()
    try { return await this.recovering } finally { this.recovering = undefined }
  }
  async disposeOwner(ownerId) {
    this.invalidOwners.add(ownerId)
    return this.releaseAll(ownerId)
  }
  async releaseAll(ownerId = 0) {
    const transport = this.guard ?? this.worker
    if (!transport || transport.dead) return !this.hadInput && !this.inputFault
    try {
      const value = await this.#send(transport, { op: 'release', ownerId }, undefined, 2000)
      if (value.released !== true) { this.inputFault = true; this.#observe({kind:'observation-status',session:transport.session,status:'unknown'}) }
      return value.released === true
    } catch { this.inputFault = true; this.#observe({kind:'observation-status',session:transport.session,status:'unknown'}); return false }
  }
  async close() {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = (async () => {
      if (this.starting) { try { await this.starting } catch {} }
      await this.#recover(this.worker)
      if (this.unsafeGuard && !this.unsafeGuard.dead) this.logger?.warn('game player: manual input recovery is required; watchdog still retrying.')
    })()
    return this.closing
  }
  /** Explicit recording-only controls for offline tests, never exposed as a tool. */
  async testControl(request, guard = false) {
    if (!this.recording) throw failure('Recording backend required.', 'TEST_ONLY')
    await this.start()
    if (guard && (!this.guard || this.guard.dead)) await this.#ensureGuard(this.worker)
    return this.#send(guard ? this.guard : this.worker, { ...request, op: 'test_config' })
  }
}
