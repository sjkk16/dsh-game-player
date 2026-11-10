/**
 * The three model-facing tools.
 *
 * Every tool returns a plain JSON value; rendered content is derived from that
 * value, so the session log can rebuild exactly what the model saw. Images
 * travel as `image` content blocks carrying a durable attachment reference,
 * never as base64 text.
 *
 * Schemas use the enforced raw JSON Schema subset: only `type`, `oneOf`,
 * `properties`, `required` (an array of names), `additionalProperties`,
 * `items`, `enum`, `const`, and the annotations. `required: true` on a property
 * is NOT part of that subset.
 *
 * @module @local/dsh-game-player/tools
 */
import { INPUT_ACTIONS, validateBudget, validateBalanced } from './keys.js'
import { selectCapture, targetSchema, regionSchema, assertClient } from './geometry.js'
import { WATCH_DISABLED_STATE } from './watch.js'

/** Explicit captures keep their old 3% change gate without a watcher setting. */
const SCREEN_CHANGE_THRESHOLD = 0.03

/** The largest number of stepped actions one call may carry. */
export const MAX_ACTIONS = 12

/** Media types the screenshot tool may produce. */
const MEDIA_TYPES = ['image/jpeg', 'image/png']

/**
 * Describe one action in plain words for the tool receipt.
 * @param {Record<string, any>} action - the normalized action.
 * @returns {string} the human summary.
 */
function describeAction(action) {
  switch (action.kind) {
    case 'wait': return `Wait ${action.durationMs} ms`
    case 'move':
      return `moved the pointer to (${action.x}, ${action.y})`
    case 'click':
      return `clicked ${action.button ?? 'left'}${action.count > 1 ? ` ${action.count} times` : ''}${action.x === undefined ? '' : ` at (${action.x}, ${action.y})`}`
    case 'down':
      return `pressed ${action.button ?? 'left'} down`
    case 'up':
      return `released ${action.button ?? 'left'}`
    case 'scroll':
      return `scrolled ${action.amount > 0 ? 'up' : 'down'} ${Math.abs(action.amount)} units`
    case 'key':
      return `pressed ${action.keys.join('+')}`
    case 'keydown':
      return `held down ${action.keys.join('+')}`
    case 'keyup':
      return `released ${action.keys.join('+')}`
    case 'hold':
      return `held ${action.keys.join('+')} for ${action.holdMs} ms`
    case 'type':
      return `typed ${JSON.stringify(action.text.length > 40 ? `${action.text.slice(0, 40)}…` : action.text)}`
    case 'drag':
      return `dragged ${action.button ?? 'left'} from (${action.fromX}, ${action.fromY}) to (${action.x}, ${action.y})`
    default:
      return action.kind
  }
}

/**
 * Build the `game_screen` tool. `attach` is injected by the plugin so the tool
 * body never touches the attachment store directly.
 * @param {{
 *   options: Record<string, any>,
 *   capture: (request: Record<string, any>, signal?: AbortSignal) => Promise<Record<string, any>>,
 *   attach: (frame: Record<string, any>) => Promise<Record<string, any>>,
 * }} deps
 * @returns {Record<string, any>} a ToolDefinition.
 */
export function screenTool({ options, capture, attach, imageDemand, windows }) {
  return {
    name: 'game_screen',
    description:
      'Look at the screen: capture the desktop as an image and return it with the screen geometry. '
      + 'Call this before every decision, and again after acting, because the game state changes between calls. '
      + 'Coordinates are physical screen pixels. Convert image coordinates with screenX + round(imageX * screenWidth / width), and screenY + round(imageY * screenHeight / height). scale is width / screenWidth. The cursor is reported in screen pixels. '
      + 'A capture with no meaningful change since the previous one reports a low diff and omits the image unless force is true.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: targetSchema,
        region: regionSchema,
        monitor: {
          type: 'string',
          enum: ['primary', 'virtual'],
          description: "Which screens to capture. 'primary' is the default; 'virtual' covers every monitor.",
        },
        maxWidth: {
          type: 'integer',
          description: 'Image width in pixels, 320 to 2560. Omit to use the configured capture width.',
        },
        quality: {
          type: 'integer',
          description: 'JPEG quality, 20 to 95. Omit to use the configured quality.',
        },
        force: {
          type: 'boolean',
          description: 'Return the image even when the screen looks unchanged since the previous capture.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['width', 'height', 'screenWidth', 'screenHeight', 'screenX', 'screenY', 'scale', 'diff', 'changed', 'attached', 'cursorX', 'cursorY'],
        properties: {
          width: { type: 'integer' },
          height: { type: 'integer' },
          screenWidth: { type: 'integer' },
          screenHeight: { type: 'integer' },
          screenX: { type: 'integer' },
          screenY: { type: 'integer' },
          scale: { type: 'number' },
          diff: { type: 'number' },
          changed: { type: 'boolean' },
          attached: { type: 'boolean' },
          cursorX: { type: 'integer' },
          cursorY: { type: 'integer' },
          foreground: { type: 'string' },
          warning: { type: 'string' },
          image: {
            type: 'object',
            additionalProperties: false,
            required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
            properties: {
              attachmentId: { type: 'string' },
              mediaType: { type: 'string', enum: MEDIA_TYPES },
              bytes: { type: 'integer' },
              width: { type: 'integer' },
              height: { type: 'integer' },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines = [
          `<screen>${value.width}x${value.height} px capture of ${value.screenWidth}x${value.screenHeight} px capture area at (${value.screenX}, ${value.screenY}) (scale ${value.scale})</screen>`,
          `<cursor>${value.cursorX}, ${value.cursorY} in screen pixels</cursor>`,
          value.attached
            ? `<change>diff ${value.diff}</change>`
            : `<change>no meaningful change since the previous capture (diff ${value.diff})</change>`,
        ]
        if (value.foreground) lines.push(`<foreground>${value.foreground}</foreground>`)
        if (value.warning) lines.push(`<warning>${value.warning}</warning>`)
        const blocks = [{ type: 'text', text: lines.join('\n') }]
        if (value.image) {
          const advice = `screenX + round(imageX * ${value.screenWidth} / ${value.width}), screenY + round(imageY * ${value.screenHeight} / ${value.height}); origin (${value.screenX}, ${value.screenY})`
          blocks.push({
            type: 'text',
            text: `<note>${advice}. The cursor is at screen (${value.cursorX}, ${value.cursorY}).</note>`,
          })
          blocks.push({
            type: 'image',
            attachment: {
              attachmentId: value.image.attachmentId,
              mediaType: value.image.mediaType,
              bytes: value.image.bytes,
              width: value.image.width,
              height: value.image.height,
              ...(value.image.name === undefined ? {} : { name: value.image.name }),
            },
          })
        }
        return blocks
      },
      presentationMeta: (_args, value) => ({ width: value.width, height: value.height, attached: value.attached }),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const maxWidth = args.maxWidth ?? options.maxWidth
      if (!Number.isInteger(maxWidth) || maxWidth < 320 || maxWidth > 2560) {
        throw new Error('maxWidth must be an integer between 320 and 2560.')
      }
      const quality = args.quality ?? options.jpegQuality
      if (!Number.isInteger(quality) || quality < 20 || quality > 95) {
        throw new Error('quality must be an integer between 20 and 95.')
      }
      const target = selectCapture(args, options, windows?.bound(exec.agent) ?? false)
      const agentId = String(exec.agent?.id ?? 'anonymous')
      const demand = imageDemand?.current(agentId)
      try {
      const signal=target.target==='window'?AbortSignal.any([exec.signal,windows.lease(exec.agent)].filter(Boolean)):exec.signal
      const windowId = target.target === 'window' ? assertClient(await windows.current(exec.agent, signal)).windowId : undefined
      const frame = await capture({ maxWidth, quality, ...target, windowId, consumerId: `screen:${agentId}` }, signal)
      for (const field of ['width','height','screenWidth','screenHeight','screenX','screenY']) {
        if (!Number.isSafeInteger(frame[field]) || (!field.endsWith('X') && !field.endsWith('Y') && frame[field] <= 0)) throw new Error(`Invalid capture geometry: ${field}.`)
      }
      if (!Number.isFinite(frame.scale) || frame.scale <= 0 || Math.abs(frame.scale - frame.width / frame.screenWidth) > 0.000001) throw new Error('Invalid capture scale.')


      // A negative diff means this was the first capture of the helper's
      // lifetime; treat that as a change so the model always gets one image.
      const known = typeof frame.diff === 'number' && frame.diff >= 0
      const changed = !known || frame.diff >= SCREEN_CHANGE_THRESHOLD
      const returnImage = args.force === true || Boolean(demand) || changed

      const value = {
        width: frame.width,
        height: frame.height,
        screenWidth: frame.screenWidth,
        screenHeight: frame.screenHeight,
        screenX: frame.screenX,
        screenY: frame.screenY,
        scale: frame.scale,
        diff: known ? frame.diff : 1,
        changed,
        attached: false,
        cursorX: frame.cursor?.x ?? 0,
        cursorY: frame.cursor?.y ?? 0,
      }
      if (typeof frame.foreground === 'string' && frame.foreground !== '') value.foreground = frame.foreground
      if (frame.black === true) {
        value.warning =
          'The capture is nearly uniform. The game may be exclusive fullscreen or showing protected content; '
          + 'switch it to borderless windowed mode so the desktop can be captured.'
      }
      if (returnImage) {
        value.image = await attach(frame)
        if (signal?.aborted) throw Object.assign(new Error('Screen capture canceled before delivery.'), { code: 'ABORTED' })
        value.attached = true
        if (demand) imageDemand?.consume(agentId, demand)
      }
      return value
      } catch(error) { imageDemand?.ensure(agentId); throw error }
    },
  }
}

/**
 * Build the `game_input` tool.
 * @param {{
 *   options: Record<string, any>,
 *   send: (request: Record<string, any>, signal?: AbortSignal) => Promise<Record<string, any>>,
 *   normalize: (action: Record<string, any>, maxHoldMs: number) => Record<string, any>,
 * }} deps
 * @returns {Record<string, any>} a ToolDefinition.
 */
export function inputTool({ options, send, normalize, macros }) {
  return {
    name: 'game_input',
    description:
      'Act on the game with the physical mouse and keyboard. '
      + 'Provide one action with `kind`, or several in `actions` to run in order within one call; that is how a drag, a click-and-hold, or a key held while the pointer moves is expressed. '
      + 'Coordinates are physical screen pixels, the same space the `game_screen` cursor and scale describe. '
      + 'A single key, click, drag or hold releases only its newly pressed input before returning; hold releases automatically after holdMs. down and keydown persist across calls for this agent only, for at most maxHoldMs from the first down; release early with up or keyup. A keys array is ONE simultaneous chord; use separate actions for sequential chords. '
      + 'Real input requires a bound, focused target; use game_window list/bind first. Templates use game_macro get/save and an exact revision; repeats and wait are bounded and cancelable. '
      + 'Successful actions send real Windows input; host approval applies when enabled.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        macro: {type:'string',description:'Saved template name, mutually exclusive with kind/actions. Requires revision.'},
        revision: {type:'string',description:'Exact saved template content hash.'},
        repeat: {type:'integer',description:'1 to 20; at most 120 total steps and full timeout budget.'},
        coordinateSpace: {type:'string',enum:['screen','client']},
        durationMs: {type:'integer',description:'Cancelable wait duration, 0 to 60000 ms.'},
        kind: {
          type: 'string',
          enum: [...INPUT_ACTIONS],
          description: `One action to perform: ${INPUT_ACTIONS.join(', ')}. Use this or \`actions\`, not both.`,
        },
        actions: {
          type: 'array',
          description: `An ordered list of actions, at most ${MAX_ACTIONS}, used instead of \`kind\` when one call must express several steps.`,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: {
              kind: { type: 'string', enum: [...INPUT_ACTIONS] },
              x: { type: 'integer', description: 'Screen x in physical pixels.' },
              y: { type: 'integer', description: 'Screen y in physical pixels.' },
              button: { type: 'string', enum: ['left', 'right', 'middle'] },
              count: { type: 'integer', description: 'Click repetitions, 1 to 5.' },
              keys: { type: 'array', items: { type: 'string' }, description: 'Key names pressed together, such as ["ctrl","s"].' },
              text: { type: 'string', description: 'Literal text for the type action.' },
              amount: { type: 'integer', description: 'Wheel units for scroll; one notch is 120, positive scrolls up.' },
              durationMs: {type:'integer'},
              holdMs: { type: 'integer', description: 'How long to keep the keys down, for hold.' },
              fromX: { type: 'integer', description: 'Drag start x in physical pixels.' },
              fromY: { type: 'integer', description: 'Drag start y in physical pixels.' },
              steps: { type: 'integer', description: 'Sampled steps for a drag, 2 to 60.' },
            },
          },
        },
        x: { type: 'integer', description: 'Screen x in physical pixels, for move, click, and drag targets.' },
        y: { type: 'integer', description: 'Screen y in physical pixels.' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button for click, down, up, and drag. Defaults to left.' },
        count: { type: 'integer', description: 'Click repetitions, 1 to 5. Defaults to 1.' },
        keys: { type: 'array', items: { type: 'string' }, description: 'Key names pressed together, such as ["ctrl","s"] or ["w"].' },
        text: { type: 'string', description: 'Literal text for the type action.' },
        amount: { type: 'integer', description: 'Wheel units for scroll; one notch is 120, positive scrolls up.' },
        holdMs: { type: 'integer', description: 'How long to keep keys down before automatic release, for hold.' },
        fromX: { type: 'integer', description: 'Drag start x in physical pixels.' },
        fromY: { type: 'integer', description: 'Drag start y in physical pixels.' },
        steps: { type: 'integer', description: 'Number of sampled steps for a drag, 2 to 60. Defaults to 12.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'actions', 'cursorX', 'cursorY'],
        properties: {
          ok: { type: 'boolean' },
          actions: { type: 'array', items: { type: 'string' } },
          cursorX: { type: 'integer' },
          cursorY: { type: 'integer' },
          heldKeys: { type: 'array', items: { type: 'string' } },
          heldButtons: { type: 'array', items: { type: 'string' } },
          // Backward-compatible receipt field; new executions never set it.
          dryRun: { type: 'boolean' },
        },
      },
      render: (_args, value) => {
        const lines = value.actions.map((entry) => `- ${entry}`)
        lines.push(`<cursor>${value.cursorX}, ${value.cursorY}</cursor>`)
        // Older conversation receipts must not be mistaken for real input.
        if (value.dryRun === true) lines.push('<note>Dry run: nothing was injected.</note>')
        if (Array.isArray(value.heldKeys) && value.heldKeys.length > 0) {
          lines.push(`<held-keys>${value.heldKeys.join(', ')} are still down; release them with keyup if that was not intended.</held-keys>`)
        }
        if (Array.isArray(value.heldButtons) && value.heldButtons.length > 0) {
          lines.push(`<held-buttons>${value.heldButtons.join(', ')} are still down; release them with up.</held-buttons>`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const sources=['kind','actions','macro'].filter(k=>args[k]!==undefined).length
      if(!sources)throw new Error('Supply `kind`, `actions`, or `macro`.')
      if(sources!==1)throw new Error('Supply either kind or actions or macro, not both or multiple sources.')
      if(args.coordinateSpace!==undefined&&!['screen','client'].includes(args.coordinateSpace))throw new Error('Invalid coordinateSpace.')
      let raw,referenceSize
      if(args.macro!==undefined){
        if(typeof args.revision!=='string'||args.coordinateSpace!==undefined)throw new Error('Macro requires revision and uses fixed client coordinates.')
        const saved=await macros.get(args.macro)
        if(exec.signal?.aborted)throw new Error('Template read canceled.')
        if(saved.revision!==args.revision)throw new Error('Template revision mismatch.')
        raw=saved.actions;referenceSize=saved.referenceSize
      }else{
        if(args.revision!==undefined)throw new Error('revision is only valid with macro.')
        raw=args.actions!==undefined?args.actions:[args]
      }
      if(!Array.isArray(raw)||!raw.length)throw new Error('actions must not be empty.')
      if(raw.length>MAX_ACTIONS)throw new Error('At most 12 actions may run in one call.')
      const actions=raw.map(a=>normalize(a,options.maxHoldMs))
      const repeat=args.repeat??1, standalone=args.macro!==undefined||repeat>1
      validateBudget(actions,options.helperTimeoutMs??15000,repeat)
      if(standalone)validateBalanced(actions,options.maxHoldMs)
      const summary = actions.map(describeAction)

      if (exec.signal?.aborted) throw new Error('Input call canceled.')
      const result = await send({ op: 'input', actions, maxHoldMs: options.maxHoldMs, repeat, standalone, referenceSize, coordinateSpace:args.macro!==undefined?'client':(args.coordinateSpace??'screen') }, exec.signal, exec.agent)
      return {
        ok: true,
        actions: summary,
        cursorX: result.cursor?.x ?? 0,
        cursorY: result.cursor?.y ?? 0,
        heldKeys: Array.isArray(result.heldKeys) ? result.heldKeys : [],
        heldButtons: Array.isArray(result.heldButtons) ? result.heldButtons : [],
      }
    },
  }
}

/**
 * Describe the current watch state in one line.
 * @param {Record<string, any>} state - the watcher state.
 * @returns {string} the summary.
 */
function describeWatch(state) {
  if (!state.running) {
    const stopped = state.wakes > 0
      ? `The screen watcher is stopped. It woke the model ${state.wakes} time(s) before stopping.`
      : 'The screen watcher is stopped.'
    return state.lastError === undefined ? stopped : `${stopped} It stopped because: ${state.lastError}`
  }
  return `The screen watcher is running every ${state.intervalMs} ms with a ${Math.round(state.threshold * 100)}% change threshold. `
    + `It has woken the model ${state.wakes} of ${state.maxWakes} time(s).`
}

/**
 * Build the `game_watch` tool. The controller receives the calling agent from
 * the tool execution context, because a tool call is not an initiator scope.
 * @param {{
 *   watch: {
 *     status: (agent: any) => Record<string, any>,
 *     start: (agent: any) => Record<string, any>,
 *     stop: (agent: any) => Record<string, any>,
 *   },
 * }} deps
 * @returns {Record<string, any>} a ToolDefinition.
 */
export function watchTool({ watch }) {
  const requireAgent = (exec) => {
    if (exec.agent === undefined) throw new Error('The screen watcher needs an owning session.')
    return exec.agent
  }
  const result = () => ({ ...WATCH_DISABLED_STATE })

  return {
    name: 'game_watch',
    description:
      'Stopped compatibility endpoint: automatic screen-change notifications are permanently disabled. '
      + 'start, stop and status always report running=false and wakes=0; no background capture, timer or helper is started. '
      + 'Use game_screen explicitly to check the current frame. Legacy pending notices owned by this plugin are safely removed when the host supports it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'stop', 'status'],
          description: 'Compatibility actions only: automatic watching is disabled; all actions report stopped.',
        },
        target: targetSchema,
        region: regionSchema,
        intervalMs: {
          type: 'integer',
          description: 'Legacy sampling interval, 200 to 5000 ms. Validated for compatibility but does not start sampling.',
        },
        threshold: {
          type: 'number',
          description: 'Legacy grayscale difference threshold, 0.001 to 1. Validated for compatibility; automatic wakeups are disabled.',
        },
        maxWakes: {
          type: 'integer',
          description: 'Legacy wake budget, 1 to 50. Validated for compatibility; no wake messages are sent.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['running', 'intervalMs', 'threshold', 'wakes', 'maxWakes'],
        properties: {
          running: { type: 'boolean' },
          intervalMs: { type: 'integer' },
          threshold: { type: 'number' },
          wakes: { type: 'integer' },
          maxWakes: { type: 'integer' },
          lastError: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: describeWatch(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const agent = requireAgent(exec)
      switch (args.action) {
        case 'start': {
          const intervalMs = args.intervalMs ?? WATCH_DISABLED_STATE.intervalMs
          if (!Number.isInteger(intervalMs) || intervalMs < 200 || intervalMs > 5000) {
            throw new Error('intervalMs must be an integer between 200 and 5000.')
          }
          const threshold = args.threshold ?? WATCH_DISABLED_STATE.threshold
          if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0.001 || threshold > 1) {
            throw new Error('threshold must be a number between 0.001 and 1.')
          }
          const maxWakes = args.maxWakes ?? WATCH_DISABLED_STATE.maxWakes
          if (!Number.isInteger(maxWakes) || maxWakes < 1 || maxWakes > 50) {
            throw new Error('maxWakes must be an integer between 1 and 50.')
          }
          watch.start(agent)
          return result()
        }
        case 'stop':
          watch.stop(agent)
          return result()
        case 'status':
          watch.status(agent)
          return result()
        default:
          throw new Error('action must be start, stop, or status.')
      }
    },
  }
}
