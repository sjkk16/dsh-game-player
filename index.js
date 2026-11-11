/**
 * Game Player — gives the model a virtual mouse and keyboard plus a live view
 * of the screen, so it can watch and play a windowed game.
 *
 * The Host half owns three things: the resident PowerShell helper that
 * captures the screen and injects input, the five model-facing tools, and one
 * screen watcher per agent, plus an independent release-only watchdog.
 * Everything is registered as a Cordis effect, so unloading the plugin lifts
 * every timer; input cleanup is confirmed or explicitly reported unsafe.
 *
 * The plugin is deliberately dependency-free: a locally linked bundle cannot
 * resolve peer packages, so it uses only Node built-ins and the raw
 * `ToolDefinition` shape rather than `defineTool`.
 *
 * @module @local/dsh-game-player
 */
import { PwshBridge } from './src/pwsh-bridge.js'
import { normalizeAction } from './src/keys.js'
import { inputTool, screenTool, watchTool } from './src/tools.js'
import { createWatchController, createImageDemand } from './src/watch.js'
import { createWindowController } from './src/windows.js'
import { MacroStore } from './src/macros.js'
import { windowTool, macroTool } from './src/extra-tools.js'
import { assertClient, clientActions } from './src/geometry.js'
import { join, isAbsolute } from 'node:path'
import { DEFAULT_MACRO_STORAGE, resolveDataDirectory, prepareDataDirectory, resolveMacroStorage } from './src/data-directory.js'
import { OverlayController } from './src/overlay.js'
import { styleFor, THEMES, ACCENTS, LAYOUTS, SKINS, VIEWS, STYLE_DEFAULTS } from './src/keyboard-style.js'
import Schema from '@deepseek-ai/schemastery'
import { OverlayManagement } from './src/overlay-management.js'
import { installOverlayRemote } from './src/overlay-remote.js'

/** Loader row name, reused as the plugin identity in diagnostics. */
export const name = 'game-player'

/** Hard dependencies: without a tool registry or an attachment store the tools cannot work. */
export const inject = ['tools', 'attachments']

/** Defaults for every user-supplied configuration value. */
const CONFIG_DEFAULTS = {
  requireApproval: true,
  overlayEnabled: true,
  overlayView: STYLE_DEFAULTS.view,
  keyboardTheme: STYLE_DEFAULTS.theme,
  keyboardAccent: STYLE_DEFAULTS.accent,
  keyboardLayout: STYLE_DEFAULTS.layout,
  keyboardSkin: STYLE_DEFAULTS.skin,
  maxWidth: 1280,
  jpegQuality: 60,
  monitor: 'primary',
  maxHoldMs: 3000,
  helperTimeoutMs: 15000,
  powershellPath: undefined,
  dataDirectory: undefined,
  macroStoragePath: DEFAULT_MACRO_STORAGE,
}

/**
 * The row's configuration schema. Every existing field is declared because a
 * schema decides what survives parsing and what the settings forms may show;
 * the declaration also validates the profile patch before the plugin starts.
 *
 * Two classes of field:
 *
 * - The twelve settings fields below are volatile. `@deepseek-ai/dsh-settings`
 *   derives its forms from volatile fields only, and the Loader commits a
 *   volatile change into this running reference instead of remounting the
 *   plugin, so the settings page can change them without touching registered
 *   tools, watchers, or held input. Every consumer therefore reads its field at
 *   call time, never at apply time.
 * - `powershellPath` and `macroStoragePath` stay ordinary. One selects the
 *   resident helper executable, the other the template store, so changing them
 *   must restart the component that owns it rather than mutate it in place.
 *   They are edited in `cordis.patch.yml` and take effect on the next load.
 *
 * The five appearance fields are volatile for the same reason, but they reach
 * the display process as a `style`/`view` command rather than through a direct
 * read: the panel is a separate native program that must repaint in place.
 */
export const Config = Schema.object({
  requireApproval: Schema.boolean().default(true).volatile()
    .description('Ask for a human confirmation before the model moves the real pointer or presses real keys.'),
  overlayEnabled: Schema.boolean().default(true).volatile()
    .description('Show the AI keyboard and mouse overlay panel. Display only; it never changes input approval.'),
  overlayView: Schema.union(VIEWS.map(value => Schema.const(value))).default(STYLE_DEFAULTS.view).volatile()
    .description("Which view the desktop runtime shows: 'auto' keeps the locally saved view, 'model' the Live2D pet, 'keyboard' the full keyboard panel."),
  keyboardTheme: Schema.union(THEMES.map(value => Schema.const(value))).default(STYLE_DEFAULTS.theme).volatile()
    .description('Color theme of the keyboard panel: dark, light or high contrast.'),
  keyboardAccent: Schema.union(ACCENTS.map(value => Schema.const(value))).default(STYLE_DEFAULTS.accent).volatile()
    .description('Accent color of the real-input keyboard panel. A simulation preview always stays amber.'),
  keyboardLayout: Schema.union(LAYOUTS.map(value => Schema.const(value))).default(STYLE_DEFAULTS.layout).volatile()
    .description("How many keys the panel draws: 'full' 104, 'tkl' 87, 'compact' 65. Keys are hidden, never rearranged."),
  keyboardSkin: Schema.union(SKINS.map(value => Schema.const(value))).default(STYLE_DEFAULTS.skin).volatile()
    .description("'builtin' draws the keycaps; 'custom' shows the keyboard image imported from the panel tray."),
  maxWidth: Schema.natural().min(320).max(2560).default(1280).volatile()
    .description('Screenshot width in pixels; height follows the screen aspect ratio.'),
  jpegQuality: Schema.natural().min(20).max(95).default(60).volatile()
    .description('JPEG quality of one capture.'),
  monitor: Schema.union([Schema.const('primary'), Schema.const('virtual')]).default('primary').volatile()
    .description("Capture the primary monitor ('primary') or every monitor ('virtual')."),
  maxHoldMs: Schema.natural().min(10).max(60000).default(3000).volatile()
    .description('Upper bound for one held key or mouse button.'),
  helperTimeoutMs: Schema.natural().min(1000).max(120000).default(15000).volatile()
    .description('How long one helper request may take before it is abandoned.'),
  powershellPath: Schema.string()
    .description('Windows PowerShell executable used for the resident helper.'),
  dataDirectory: Schema.string()
    .description('Optional local plugin data directory. Relative paths resolve from the plugin directory; changing this requires reloading the plugin.'),
  macroStoragePath: Schema.string().default(DEFAULT_MACRO_STORAGE)
    .description('Absolute path of the saved action-template store.'),
})

/** Symbol cosmokit uses to mark a live config reference; shared across ESM/CJS copies. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Whether a configuration value is a live reference produced by the Loader's
 * schema parse rather than a plain value. The marker symbol is the cross-copy
 * protocol `@deepseek-ai/cosmokit` documents, so this check needs no import.
 *
 * @param {unknown} value - one raw configuration value.
 * @returns {boolean} true when the value is a volatile reference.
 */
export function isLiveValue(value) {
  return typeof value === 'object' && value !== null && VOLATILE_WRITE in value
}

/** Read a configuration value, unwrapping a live reference at call time. */
function readConfigValue(value) {
  return isLiveValue(value) ? value.get() : value
}

/**
 * Merge the row's configuration over the defaults, reporting every value that
 * had to be replaced so a mistake in `cordis.patch.yml` is visible instead of
 * silent. The plugin never throws on configuration: a bad value must not make
 * the whole profile fail to boot.
 *
 * @param {Record<string, unknown>} raw - the loader row's `config`.
 * @param {(message: string) => void} warn - sink for configuration diagnostics.
 * @returns {Record<string, any>} the effective configuration.
 */
export function resolveConfig(raw, warn) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const config = { ...CONFIG_DEFAULTS }
  // The Loader hands over live references for volatile fields. Validate their
  // current snapshot for diagnostics, but remember the reference so every read
  // of the returned object sees the value committed most recently.
  const live = Object.create(null)
  const input = {}
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(CONFIG_DEFAULTS, key)) continue
    const value = source[key]
    if (isLiveValue(value)) { live[key] = value; input[key] = value.get() }
    else input[key] = value
  }
  const reject = (key, message) => warn(`game player: config.${key} ${message}; using ${JSON.stringify(CONFIG_DEFAULTS[key])}.`)

  const boolean = (key) => {
    const value = input[key]
    if (value === undefined) return
    if (typeof value !== 'boolean') return reject(key, 'must be true or false')
    config[key] = value
  }
  const integer = (key, min, max) => {
    const value = input[key]
    if (value === undefined) return
    if (!Number.isInteger(value) || value < min || value > max) {
      return reject(key, `must be an integer between ${min} and ${max}`)
    }
    config[key] = value
  }
  const choice = (key, list) => {
    const value = input[key]
    if (value === undefined) return
    if (typeof value !== 'string' || !list.includes(value)) {
      return reject(key, 'must be one of ' + list.map(item => `'${item}'`).join(', '))
    }
    config[key] = value
  }

  boolean('requireApproval')
  boolean('overlayEnabled')
  choice('overlayView', VIEWS)
  choice('keyboardTheme', THEMES)
  choice('keyboardAccent', ACCENTS)
  choice('keyboardLayout', LAYOUTS)
  choice('keyboardSkin', SKINS)
  integer('maxWidth', 320, 2560)
  integer('jpegQuality', 20, 95)
  integer('maxHoldMs', 10, 60000)
  integer('helperTimeoutMs', 1000, 120000)

  if (input.monitor !== undefined) {
    if (input.monitor !== 'primary' && input.monitor !== 'virtual') {
      reject('monitor', "must be 'primary' or 'virtual'")
    } else {
      config.monitor = input.monitor
    }
  }
  if (input.powershellPath !== undefined) {
    if (typeof input.powershellPath !== 'string' || input.powershellPath.trim() === '') {
      warn('game player: config.powershellPath must be a non-empty path; using the default Windows PowerShell.')
    } else {
      config.powershellPath = input.powershellPath
    }
  }
  const dataDirectory = resolveDataDirectory(input.dataDirectory)
  config.dataDirectory = input.dataDirectory === undefined ? undefined : dataDirectory
  config.settingsPath = join(dataDirectory, 'overlay.json')
  config.macroStoragePath = resolveMacroStorage(undefined, dataDirectory)
  if(input.macroStoragePath!==undefined){if(typeof input.macroStoragePath!=='string'||!isAbsolute(input.macroStoragePath))reject('macroStoragePath','must be an absolute path');else config.macroStoragePath=resolveMacroStorage(input.macroStoragePath,dataDirectory)}
  // Volatile reads stay live: `options.overlayEnabled` must answer with the
  // value the Loader committed last, not with the apply-time snapshot.
  for (const key of Object.keys(live)) {
    if (!Object.hasOwn(CONFIG_DEFAULTS, key) || key === 'dataDirectory') continue
    Object.defineProperty(config, key, { enumerable: true, get: () => readConfigValue(live[key]) })
  }
  return config
}

/**
 * Plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin's context.
 * @param {Record<string, unknown>} [config] - the loader row's configuration.
 */
export function apply(ctx, config, runtime = {}) {
  const warn = (message) => {
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(message)
    else console.warn(message)
  }
  const options = resolveConfig(config, warn)
  if (options.dataDirectory !== undefined) prepareDataDirectory(options.dataDirectory)

  const overlay = (runtime.overlayFactory ?? (options => new OverlayController(options)))({
    enabled: () => options.overlayEnabled, warn,
    settingsPath: options.settingsPath,
    // An isolated copy must never discover the original sibling model directory.
    defaultModel: options.dataDirectory === undefined ? undefined : join(options.dataDirectory, 'unselected-default-model'),
    // The display runtime verifies WDA_EXCLUDEFROMCAPTURE before reporting it.
    // On supported systems this keeps the pet visible during screenshots; an
    // unverified runtime still falls back to acknowledged hide + DwmFlush.
    trustCaptureAffinity: true,
    // Functions, not snapshots: the appearance fields are live settings and the
    // controller asks for the value committed most recently.
    style: () => styleFor({
      theme: options.keyboardTheme,
      accent: options.keyboardAccent,
      layout: options.keyboardLayout,
      skin: options.keyboardSkin,
    }),
    view: () => options.overlayView,
  })
  const management = overlay.preferences ? new OverlayManagement(overlay) : undefined
  if (management) {
    installOverlayRemote(ctx, management)
    if(runtime.autoRestore!==false)ctx.effect(()=>{void management.restoreSelection();return()=>management.lifetime.abort()},'game-player.restore')
  }
  const bridge = (runtime.bridgeFactory ?? ((options) => new PwshBridge(options)))({
    // A function, not a snapshot: `helperTimeoutMs` is a live setting and the
    // bridge must apply the value committed last to the next helper request.
    timeoutMs: () => options.helperTimeoutMs,
    powershell: options.powershellPath,
    logger: { warn },
    // The helper reports input events while the panel exists; the overlay drops
    // them itself when the setting is off, so enabling it later needs no helper
    // restart (which would risk the held-input accounting).
    onObservation: event => overlay.observe(event),
  })

  // The helper outlives individual tool calls but not the plugin. This effect
  // runs on unload, after the tools and compatibility subscriptions are gone, and it lifts any
  // key or mouse button the helper still holds.
  ctx.effect(
    () => () => {
      return Promise.resolve(bridge.close()).finally(async () => { await management?.close(); await overlay.close() })
    },
    'game-player.helper',
  )

  const attachments = ctx.attachments

  /** Capture one frame with the helper. */
  const capture = (request, signal) => overlay.capture(() => bridge.request({ op: 'frame', ...request }, signal))

  /** Persist one frame as a durable image attachment and return its reference. */
  const attach = async (frame) => {
    if (typeof frame.data !== 'string' || frame.data === '') {
      throw new Error('The game helper returned an empty capture.')
    }
    const bytes = Buffer.from(frame.data, 'base64')
    const saved = await attachments.saveImage({
      data: bytes,
      mediaType: frame.mediaType === 'image/png' ? 'image/png' : 'image/jpeg',
      name: frame.mediaType === 'image/png' ? 'game-screen.png' : 'game-screen.jpg',
    })
    return {
      attachmentId: saved.attachmentId,
      mediaType: saved.mediaType,
      bytes: saved.bytes,
      width: saved.width,
      height: saved.height,
      ...(saved.name === undefined ? {} : { name: saved.name }),
    }
  }

  const imageDemand = createImageDemand()
  const watch = createWatchController({ ctx, warn, imageDemand, forget: (consumerId) => bridge.running ? bridge.request({ op: 'forget', consumerId }) : undefined })
  const ownerIds = new Map()
  const disposedAgents = new WeakSet()
  let ownerSequence = 0
  const ownerId = (agent) => {
    if (!agent || agent.id === undefined || typeof agent.ctx?.effect !== 'function') throw new Error('Real input requires an owning agent with lifecycle cleanup.')
    if (disposedAgents.has(agent)) throw new Error('Input agent has been disposed.')
    const id = String(agent.id)
    if (!ownerIds.has(id)) {
      const token = ++ownerSequence
      ownerIds.set(id, token)
      agent.ctx.effect(() => () => { disposedAgents.add(agent); ownerIds.delete(id); return bridge.disposeOwner(token) }, 'game-player.input-owner')
    }
    return ownerIds.get(id)
  }

  const windows=createWindowController({ctx,bridge,ownerId,stopWatch:agent=>watch.stop(agent),imageDemand})
  const macros=(runtime.macroStoreFactory ?? (path=>new MacroStore(path)))(options.macroStoragePath)
  const send=async(request,signal,agent)=>{
    const owner=ownerId(agent)
    const releaseOnly=request.actions.every(a=>a.kind==='up'||a.kind==='keyup')
    if(releaseOnly){overlay.beginReal();return bridge.request({...request,ownerId:owner},signal)}
    const lease=windows.lease(agent), combined=AbortSignal.any([signal,lease].filter(Boolean))
    const info=assertClient(await windows.current(agent,combined))
    if(request.referenceSize&&(request.referenceSize.width!==info.client.width||request.referenceSize.height!==info.client.height))throw new Error('Template reference client size mismatch; save a new template.')
    const actions=clientActions(request.actions,info,request.coordinateSpace)
    overlay.beginReal()
    return bridge.request({...request,actions,window:info,ownerId:owner},combined)
  }
  const registered = [
    screenTool({ options, capture, attach, imageDemand, windows }),
    inputTool({ options, send, normalize: normalizeAction, macros }),
    watchTool({ watch }),
    windowTool({windows}),
    macroTool({store:macros,windows,options}),
  ]
  for (const tool of registered) {
    const unregister = ctx.tools.register(tool)
    if (typeof unregister === 'function') ctx.effect(() => unregister, `game-player.tool:${tool.name}`)
  }

  // ---------------------------------------------------------------
  // Settings: fifteen fields are volatile, so the Loader commits a new value
  // into the running reference and emits this event on the owning fiber
  // instead of remounting the plugin. Most consumers read their field at call
  // time and need no handler. Three effects are not covered by a plain read: an
  // already visible overlay panel must stop when its switch goes off, the panel
  // must repaint when an appearance field changes, and the unsafe
  // disabled input approval must be reported when it comes into force.
  // `loader/volatile-update` names only the paths that really changed.
  // ---------------------------------------------------------------
  const STYLE_KEYS = ['keyboardTheme', 'keyboardAccent', 'keyboardLayout', 'keyboardSkin']
  let reportedUnsafe = false
  const reportUnsafe = () => {
    if (options.requireApproval) { reportedUnsafe = false; return }
    if (reportedUnsafe) return
    reportedUnsafe = true
    warn(
      'game player: config.requireApproval is off, so the model can move the real pointer and press real keys without asking. '
      + 'Turn requireApproval back on to require a human confirmation before input.',
    )
  }

  ctx.on('loader/volatile-update', (paths) => {
    if (!Array.isArray(paths)) return
    const changed = (key) => paths.some(path => Array.isArray(path) && path[0] === key)
    if (changed('overlayEnabled') && typeof overlay.syncEnabled === 'function') {
      Promise.resolve(overlay.syncEnabled())
        .catch(error => warn('game player: overlay setting change failed: ' + (error?.message ?? error)))
    }
    // The view first: the panel instance that will paint must exist before its
    // palette and key-count preset arrive.
    if (changed('overlayView') && typeof overlay.syncView === 'function') {
      Promise.resolve(overlay.syncView({fromConfiguration:true}))
        .catch(error => warn('game player: overlay view change failed: ' + (error?.message ?? error)))
    }
    if (STYLE_KEYS.some(changed) && typeof overlay.syncStyle === 'function') {
      Promise.resolve(overlay.syncStyle())
        .catch(error => warn('game player: overlay style change failed: ' + (error?.message ?? error)))
    }
    if (changed('requireApproval')) reportUnsafe()
  })

  // This plugin ships its own settings page, so declare that the schema form
  // generator does not need to build one. The policy is optional: profiles
  // without the settings service still get the tools and the panel.
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.settings
    if (typeof settings?.configure !== 'function') return
    settings.configure({ auto: false }, ctx.fiber ?? settingsCtx.fiber)
  })

  // ---------------------------------------------------------------------
  // Approval gate: the model decides what to do, but a human confirms that the
  // real pointer and keyboard move. `requireApproval` is a live setting, so the
  // listener is always registered and answers with the value committed last:
  // turning it off must stop asking immediately, without remounting the plugin
  // (which would drop the registration while input state survives).
  // ---------------------------------------------------------------------
  reportUnsafe()
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (!['game_input','game_macro'].includes(exec.name)) return next()
    if (!options.requireApproval) return next()
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    return {
      kind: 'ask',
      reason: exec.name==='game_macro'?'The model wants to read or modify saved local plaintext action templates.':'The model wants to control the mouse and keyboard of this computer.',
      displayReason: {
        en: exec.name==='game_macro'?'Read or modify saved local plaintext action templates.':'The model wants to control the mouse and keyboard of this computer.',
        zh: exec.name==='game_macro'?'模型想要读取或修改本地明文动作模板。':'模型想要控制这台电脑的鼠标和键盘。',
      },
    }
  })

  // The prompt section is optional: a composition without a system-prompt
  // registry simply gets the tools and their descriptions.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'game-player',
      order: 40,
      text: [
        '## Playing a game on this computer',
        '',
        "You can see this computer's screen and drive its physical mouse and keyboard.",
        '',
        '- First use game_window list and bind with an explicit windowId. Real input requires that target to remain focused; do not auto-focus. Client-relative coordinates use coordinateSpace: client. Lost focus cancels and releases input.',
        '- game_screen defaults to the bound client area; target selects window/primary/virtual and region selects an in-bounds physical-pixel crop. Visible desktop capture is not background/occlusion capture.',
        '- game_macro list/get/save/delete manages shared plaintext templates. Never save secrets. Run via game_input macro + exact revision; client size must match. wait and repeat remain synchronous and timeout-bounded; standalone sequences must balance down/up.',
        '- `game_screen` captures the screen. The image may be downscaled: convert with screenX + round(imageX * screenWidth / width) and screenY + round(imageY * screenHeight / height). scale means width / screenWidth. The response also reports the current cursor in screen pixels.',
        '- `game_input` acts in physical screen pixels. A keys array is one simultaneous chord; use multiple actions for a sequence. hold auto-releases; keydown/down expire after maxHoldMs and belong to this agent only. Batch the steps of one gesture into `actions`, so a drag or a held key is one call, and release anything you pressed deliberately with `keyup` or `up`.',
        '- game_input sends real Windows keyboard and mouse input after validation and any required host approval. Approval is a live user setting. A successful call means Windows accepted the events, not that the game responded.',
        '- Work in a loop: capture, decide, act, then capture again. Never send several actions blind on the assumption that the last one worked.',
        '- Automatic screen-change wakeups are permanently disabled. Use game_screen explicitly to check the current frame after waiting; game_watch is only a stopped compatibility endpoint and never watches or wakes this session.',
        '- If a capture is nearly uniform, the game is probably exclusive fullscreen or showing protected content. Ask the user to switch it to borderless windowed mode instead of guessing.',
      ].join('\n'),
    })
  })
}
