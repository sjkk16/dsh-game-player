import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { dirname, join, extname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { preferenceError, validatePreferencePatch, validatePreferenceRequest } from './overlay-preferences.js'
import { OverlayMotions } from './overlay-motions.js'
import { OverlayModels } from './overlay-models.js'
import { ModelLibrary } from './model-library.js'
import { desktopExecutable, desktopLaunch } from './desktop-runtime.js'
import { validateGlobalAdapter, mergeGlobalAdapter, resolveGlobalAdapter, confirmsGlobalAdapter, profileGlobalBindings } from './live2d/global-adapter.js'
import { validateMotionAction } from './live2d/motions.js'
import { defaultModelAvailable, requireModelSelection } from './model-selection.js'

export const OVERLAY_ACTIONS = Object.freeze([
  'show', 'hide', 'beginAdjust', 'endAdjust', 'resetLayout', 'reloadModel', 'retryDisplay',
  'preview', 'stopPreview', 'cancelLoad', 'refreshAdapter', 'refreshMotions', 'stopMotion', 'importModelFile', 'importModelFolder',
  'importProfile', 'clearProfile', 'importKeyboardImage', 'clearKeyboardImage', 'addLibraryFile', 'addLibraryFolder',
])
const abortError = () => preferenceError('canceled', 'Operation canceled.')

/** A short-lived, owned native picker/decoder. Never starts WebView2 or the input helper. */
export function desktopUtility(executable, args, signal, spawnProcess = spawn) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? abortError())
  return new Promise((resolve, reject) => {
    const launch = desktopLaunch(executable, ['--parent', String(process.pid), ...args])
    const child = spawnProcess(launch.command, launch.args, {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const replyBudget=args[0]==='--describe-model-source'?2*1024*1024:65536
    let stdout = '', stderr = '', settled = false
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const finish = (error, value) => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(value) }
    const abort = () => { try { child.kill() } catch {}; finish(signal.reason ?? abortError()) }
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', value => {
      stdout += value
      if (stdout.length > replyBudget) { try { child.kill() } catch {}; finish(new Error('Oversized picker reply.')) }
    })
    child.stderr.on('data', value => { stderr = (stderr + value).slice(-2048) })
    child.once('error', error => finish(error))
    child.once('close', code => {
      if (settled) return
      if (code !== 0) return finish(new Error(stderr || 'Native dialog failed.'))
      try { finish(null, JSON.parse(stdout.trim())) } catch { finish(new Error('Invalid native dialog reply.')) }
    })
  })
}

export class OverlayManagement {
  constructor(overlay, { utility, io = fs } = {}) {
    this.overlay = overlay; this.store = overlay.preferences; this.io = io
    this.lastError=null
    this.utilitySupportsLibrary=!utility||utility.supportsLibrary===true
    this.utilitySupportsDiscovery=!utility||utility.supportsDiscovery===true
    this.utility = utility ?? ((args, signal) => desktopUtility(overlay.desktop, args, signal, overlay.spawn))
    this.stateGeneration=randomUUID();this.stateRevision=0;this.stateSignature=''
    this.lifetime = new AbortController(); this.busy = null; this.load = null; this.manualPreview = null;this.previewContext=null
    overlay.onInitializeModel=()=>this.initializeModel(this.lifetime.signal)
    this.motions=new OverlayMotions(this);this.models=new OverlayModels(this);overlay.onMotionEvent=message=>this.motions.event(message)
    overlay.onActivity = () => this.manualPreview?.abort(abortError())
    overlay.onRealObservation = message => {
      if(this.manualPreview&&(overlay.realState.keys.size||overlay.realState.buttons.size||['unknown','locked','releasing','syncing'].includes(overlay.realState.status)||['down','up','move','wheel','fault'].includes(message.event)))overlay.beginReal()
    }
    overlay.onPreferences = async (patch, revision) => {
      try { await this.store.update(patch, revision);this.lastError=null }
      catch(error){this.lastError=error.message;throw error}
      finally { await overlay.syncPreferences() }
    }
  }
  canPreview() {
    const real = this.overlay.realState
    return !real.keys.size && !real.buttons.size && !(real.session && ['unknown', 'locked', 'releasing', 'syncing'].includes(real.status))
  }
  async getState() {
    await this.store.ready
    this.library??=new ModelLibrary(this);await this.library.ready;await this.library.refresh()
    try { await this.store.refresh() } catch (error) { this.store.error = error.message }
    const o = this.overlay, native = o.ready && !o.dead
    if(native&&o.capabilities.management&&!this.busy&&!this.store.writing&&o.preferencesSentRevision!==this.store.revision)await o.syncPreferences()
    const management = native ? o.capabilities.management === true : o.useDesktop && existsSync(o.desktop)
    this.models.snapshot();await this.models.checkProof();
    const value = {
      ...this.store.snapshot(), enabled: o.enabled,
      ...o.runtime, renderer: o.renderer ?? o.runtime.renderer,
      phase: this.busy ?? o.runtime.phase, loading: this.load !== null || o.runtime.loading === true || o.runtime.phase === 'starting',
      ...this.models.snapshot(), ...this.motions.snapshot(), ...this.library.snapshot(), previewing: this.manualPreview !== null, error: this.lastError ?? o.runtime.error ?? o.lastError ?? null,
      capabilities: { library:this.utilitySupportsLibrary&&existsSync(o.desktop), confirmedVisibility:native?o.capabilities.confirmedVisibility===true:this.utilitySupportsLibrary, archives: native?o.capabilities.archives===true:this.canDiscover(), adaptation:native?o.capabilities.adaptation===true:this.canDiscover(), handStyles:native?o.capabilities.handStyles===true:this.canDiscover(), management, model: native?o.capabilities.model===true:management, picker: existsSync(o.desktop), preview: o.enabled && this.canPreview(), motions: native?o.capabilities.motions===true:management, motionPreview:o.enabled&&this.canPreview()&&o.captureCount===0 },
    }
    const signature=JSON.stringify(value);if(signature!==this.stateSignature){this.stateSignature=signature;this.stateRevision++}
    return {...value,stateRevision:this.stateRevision,stateGeneration:this.stateGeneration}
  }
  signal(signal) { return signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal }
  requireEnabled() {
    if (this.lifetime.signal.aborted || this.overlay.closed) throw preferenceError('unavailable', 'Plugin has been unloaded.')
    if (!this.overlay.enabled) throw preferenceError('disabled', 'Enable the overlay before displaying or importing a model.')
  }
  async ensureManagement(signal, { deferModel = false } = {}) {
    this.requireEnabled(); signal?.throwIfAborted()
    const o=this.overlay,activity=o.activity
    let rejectCanceled
    const canceled=new Promise((_,reject)=>{rejectCanceled=reject})
    const abort=()=>{if(!o.activated&&o.activity===activity)void o.stopDisplay('Management canceled.');rejectCanceled(signal.reason??abortError())}
    signal?.addEventListener('abort',abort,{once:true})
    try{await Promise.race([o.start({hidden:true,deferModel}),canceled]);signal?.throwIfAborted()}
    finally{signal?.removeEventListener('abort',abort)}
    if (!this.overlay.ready || !this.overlay.capabilities.management) throw preferenceError('unsupported', 'This display runtime does not support desktop management.')
  }
  async ensureModelManagement(signal) {
    const o=this.overlay
    signal?.throwIfAborted()
    if(o.ready&&!o.dead&&o.capabilities.management&&o.capabilities.model)return
    let retried=false
    const restart=async()=>{
      signal?.throwIfAborted()
      if(!existsSync(o.desktop))throw preferenceError('unsupported','The native Live2D renderer/file picker is not installed.')
      const activated=o.activated,state=o.state,activity=o.activity,userHidden=o.runtime.userHidden,running=o.ready&&!o.dead
      o.useDesktop=true
      await o.stopDisplay('Restarting only the renderer for hidden model validation.')
      if(o.activity===activity){o.activated=activated;o.state=state}
      o.runtime.userHidden=userHidden;o.stopped=false;retried=true
      // Cancellation must not erase the already-running fallback's display intent.
      if(signal?.aborted&&running&&!o.closed&&!this.lifetime.signal.aborted)void o.start({hidden:true,deferModel:true})
      signal?.throwIfAborted()
    }
    if((o.child&&!o.dead)||o.stopped||!o.useDesktop)await restart()
    let failure
    try{await this.ensureManagement(signal,{deferModel:true})}catch(error){failure=error}
    signal?.throwIfAborted()
    if(o.ready&&!o.dead&&o.capabilities.management&&o.capabilities.model)return
    if(!retried){
      await restart()
      try{await this.ensureManagement(signal,{deferModel:true})}catch(error){failure=error}
    }
    signal?.throwIfAborted()
    if(!o.ready||!o.capabilities.management||!o.capabilities.model){
      throw preferenceError(o.runtime.errorCode??failure?.code??'runtime_unavailable',o.runtime.error??o.lastError??failure?.message??'The Live2D renderer could not recover; the previous model selection was kept.')
    }
  }
  async retireTemporary(wasRunning, activity) {
    if (!wasRunning && this.overlay.activity === activity && !this.overlay.closed) await this.overlay.stopDisplay()
  }
  canDiscover() { return this.utility.supportsDiscovery===true||this.utilitySupportsDiscovery&&(this.overlay.capabilities.archives===true || this.overlay.desktop===desktopExecutable()&&existsSync(this.overlay.desktop)) }
  modelRequest(next,extra={}) {
    const modelPath=requireModelSelection(next.modelPath,this.overlay.defaultModel)
    return {kind:'load-model',modelPath,profilePath:null,modelEntry:next.modelEntry??null,adapter:{},overrides:{},...extra}
  }
  async readProfile(path,signal){
    validatePreferencePatch({profilePath:path});signal?.throwIfAborted()
    // Match the native importer: no junctions/symlinks, including ancestor directories.
    for(let current=path;;current=dirname(current)){const stat=await this.io.lstat(current);if(stat.isSymbolicLink())throw preferenceError('invalid_adapter','Linked adapter files are not supported.');if(dirname(current)===current)break}
    const before=await this.io.stat(path,{bigint:true});if(!before.isFile()||before.size>1048576n)throw preferenceError('invalid_adapter','Adapter JSON exceeds 1 MiB.')
    const text=await this.io.readFile(path,'utf8');if(Buffer.byteLength(text)>1048576)throw preferenceError('invalid_adapter','Adapter JSON exceeds 1 MiB.')
    let raw;try{raw=JSON.parse(text.replace(/^\uFEFF/,''))}catch{throw preferenceError('invalid_adapter','Invalid adapter JSON.')}
    const bindings=profileGlobalBindings(raw),proof=[{path,size:Number(before.size),mtime:String(before.mtimeNs/100n+621355968000000000n)}]
    await this.models.assertProof(proof);signal?.throwIfAborted();return {bindings,proof}
  }
  async assertTransactionProof(proof){for(let offset=0;offset<proof.length;offset+=257)await this.models.assertProof(proof.slice(offset,offset+257))}
  async stageModel(next,signal,extra={},inputBindings){
    const o=this.overlay,previous=this.store.value;let anchorProof=[]
    // Migration is anchored to the originally selected model, never the switch destination.
    if(next.globalAdapter===null&&this.models.selection(next)!==this.models.selection(previous)){
      const original=structuredClone(previous),seed=await this.stageModel(original,signal,extra)
      next.globalAdapter=original.globalAdapter;next.profilePath=null
      anchorProof=[...(seed.sourceProof??[]),...(seed.migrationProof??[])];await this.assertTransactionProof(anchorProof)
    }
    let prepared=await o.command(this.modelRequest(next,extra),{signal});signal?.throwIfAborted()
    if(prepared.sourceProof)await this.models.assertProof(prepared.sourceProof)
    if(o.capabilities.adaptation!==true){
      if(next.globalAdapter===null||Object.keys(next.globalAdapter??{}).length)throw preferenceError('unsupported','Global adaptation requires the Live2D parameter catalog.')
      return prepared
    }
    const baseline=this.models.validate(prepared);let migrationProof=anchorProof
    if(next.globalAdapter===null){
      const old=next.modelOverrides?.[prepared.modelKey]??{},path=Object.prototype.hasOwnProperty.call(old,'profilePath')?old.profilePath:next.profilePath
      let record={};if(path&&inputBindings===undefined){const imported=await this.readProfile(path,signal);record.bindings=imported.bindings;migrationProof.push(...imported.proof)}
      const {profilePath,...manual}=old;record=mergeGlobalAdapter(record,manual)
      next.globalAdapter=validateGlobalAdapter(record);next.profilePath=null
    }
    if(inputBindings!==undefined){const record=structuredClone(next.globalAdapter??{});if(inputBindings===null)delete record.bindings;else record.bindings=inputBindings;next.globalAdapter=validateGlobalAdapter(record)}
    const resolved=resolveGlobalAdapter(next.globalAdapter??{},baseline)
    if(!confirmsGlobalAdapter(baseline,resolved.adapter)){
      const original=prepared
      prepared=await o.command(this.modelRequest(next,{...extra,adapter:resolved.adapter}),{signal});signal?.throwIfAborted()
      if(prepared.modelKey!==original.modelKey||JSON.stringify(prepared.sourceProof)!==JSON.stringify(original.sourceProof))throw preferenceError('stale_model_resources','Model changed while applying global adaptation.')
      this.models.validate(prepared)
    }
    if(prepared.sourceProof)await this.models.assertProof(prepared.sourceProof)
    if(!confirmsGlobalAdapter(prepared.adapter,resolved.adapter))throw preferenceError('invalid_adapter','Renderer did not confirm the effective global adaptation.')
    await this.assertTransactionProof(migrationProof)
    return {...prepared,globalAdapter:resolved.globalAdapter,fallbacks:resolved.fallbacks,migrationProof}
  }
  async initializeModel(signal){
    if(this.busy||this.load)return
    await this.store.ready
    // Nothing selected and no built-in pet on disk: asking the display to load
    // would fail its startup handshake and push the whole overlay back to the
    // PowerShell keyboard. Start without a model and let the panel stay usable.
    if(!this.store.value.modelPath&&!defaultModelAvailable(this.overlay.defaultModel))return
    if(this.store.value.globalAdapter===null)return this.applyPreferences({globalAdapter:null},this.store.revision,signal)
    try{const prepared=await this.stageModel(structuredClone(this.store.value),signal);await this.overlay.command({kind:'commit-model'},{signal});this.models.accept(prepared)}
    catch(error){await this.overlay.command({kind:'cancel-load'}).catch(()=>{});throw error}
  }
  async updatePreferences(patch,revision,signal) {
    const parsed=validatePreferenceRequest(patch),validated={...parsed};delete validated.modelAdapter
    if(['modelPath','profilePath','keyboardImage'].some(key=>key in validated))throw preferenceError('invalid_preferences','Use the import/clear commands to change local resource paths.')
    if(parsed.modelAdapter){
      this.requireEnabled();if(this.busy||this.load||this.manualPreview||this.motions.active)throw preferenceError('busy','Finish or cancel the current display operation first.')
      this.models.snapshot();if(this.models.cache)await this.models.assertProof(this.models.cache.sourceProof)
      Object.assign(validated,this.models.adapterPatch(parsed.modelAdapter))
    }
    return this.applyPreferences(validated,revision,this.signal(signal),{strictAdapter:!!parsed.modelAdapter})
  }
  async applyPreferences(patch,revision,signal,{strictAdapter=false,showAfterCommit=false,profileProof=[],inputBindings}={}) {
    signal??=this.signal();signal.throwIfAborted()
    const o=this.overlay,wasRunning=o.ready&&!o.dead,activity=o.activity
    if(inputBindings===undefined&&!showAfterCommit&&patch.globalAdapter!==null&&'globalAdapter'in patch&&Object.entries(patch).every(([key,v])=>JSON.stringify(v)===JSON.stringify(this.store.value[key]))){await this.models.assertProof(profileProof);return this.store.update(patch,revision)}
    const modelChange=['modelPath','profilePath','modelEntry','modelOverrides','globalAdapter'].some(key=>key in patch)
    let staged=false,committed=false,prepared,releaseVisibility,shown=false,displayIntent
    const previousDisplay={activated:o.activated,state:o.state,userHidden:o.runtime.userHidden,view:o.view??o.runtime.view??'auto'}
    if(modelChange){
      this.requireEnabled();if(this.load||this.busy||this.manualPreview||this.motions.active)throw preferenceError('busy','Another model or preview operation is active.')
      this.load=new AbortController();signal=AbortSignal.any([signal,this.load.signal]);this.busy='loading';o.deferModelStartup++;if(!o.runtime.modelLoaded)releaseVisibility=o.holdVisibility()
    }
    try {
      return await this.store.update(patch,revision,async(next,previous)=>{
        if(modelChange){
          await this.ensureModelManagement(signal)
          if(next.modelPath?.toLowerCase().endsWith('.zip')&&!o.capabilities.archives)throw preferenceError('unsupported','ZIP models require the 0.2.5 renderer.')
          if(strictAdapter&&!o.capabilities.adaptation)throw preferenceError('unsupported','This renderer cannot validate parameter or hand-style changes.')
          staged=true
          prepared=await this.stageModel(next,signal,{},inputBindings);signal.throwIfAborted()
          await this.models.assertProof(profileProof)

        }else if(o.ready&&!o.dead){
          if(!o.capabilities.management)throw preferenceError('unsupported','The keyboard fallback cannot apply these preferences live.')
          await o.command({kind:'preferences',preferences:next,revision},{signal})
        }
        return {
          rollback:async()=>{
            if(staged)await o.command({kind:'cancel-load'}).catch(()=>{})
            if(staged&&o.ready&&!o.dead&&(committed||prepared?.modelToken&&o.runtime.modelToken===prepared.modelToken)){
              try{await this.stageModel(structuredClone(previous),this.lifetime.signal,{});await o.command({kind:'commit-model'},{signal:this.lifetime.signal});this.models.invalidate();this.motions.invalidate()}catch(error){this.lastError='Configuration restored; renderer recovery failed: '+error.message}
            }
            if(o.ready&&o.capabilities.management)await o.command({kind:'preferences',...this.store.snapshot()}).catch(()=>{})
             if(showAfterCommit&&(displayIntent===undefined||o.activity===displayIntent)){o.activated=previousDisplay.activated;o.state=previousDisplay.state;o.runtime.userHidden=previousDisplay.userHidden;await o.setViewIntent?.(previousDisplay.view);o.changed();if(o.ready&&o.capabilities.management)await o.command({kind:'control',action:previousDisplay.activated&&!previousDisplay.userHidden?'show':'hide'}).catch(()=>{})}
          },
          commit:async state=>{
            if(staged){await this.models.assertProof(profileProof);await this.assertTransactionProof(prepared?.migrationProof??[]);if(prepared?.sourceProof)await this.models.assertProof(prepared.sourceProof);await o.command({kind:'commit-model'},{signal});committed=true;this.models.invalidate();this.motions.invalidate();if(prepared?.adapter&&o.capabilities.adaptation)this.models.accept(prepared)}
            if(o.ready&&o.capabilities.management)await o.command({kind:'preferences',...state})
             if(showAfterCommit){
               if(!o.capabilities.confirmedVisibility)throw preferenceError('unsupported','The 0.3.0 renderer is required for confirmed model display.')
               displayIntent=++o.activity;o.activated=true;o.onActivity?.();o.state=o.realState.session?o.realState:o.previewState;if(o.state===o.previewState)o.previewState.reset('simulation')
               await o.setViewIntent?.('model');releaseVisibility?.();releaseVisibility=undefined;o.changed()
               const confirmation=await o.command({kind:'control',action:'show-confirmed',modelToken:prepared?.modelToken??o.runtime.modelToken},{signal,timeoutMs:10000})
               if(confirmation.visible!==true||confirmation.framePrepared!==true)throw preferenceError('display_not_confirmed','The renderer did not confirm a visible model frame.');shown=true
             }
          },
        }
      },{forcePrepare:modelChange})
    }catch(error){
      if(modelChange&&staged&&!committed)await o.command({kind:'cancel-load'}).catch(()=>{})
      throw error
    }finally{
      if(modelChange){if(signal.aborted&&staged)await o.command({kind:'cancel-load'}).catch(()=>{});this.load=null;this.busy=null;try{if(!shown){if(showAfterCommit&&!wasRunning&&displayIntent!==undefined&&o.activity===displayIntent)await o.stopDisplay();else await this.retireTemporary(wasRunning,activity)}}finally{o.deferModelStartup--;releaseVisibility?.()}}
    }
  }
  /** Remove a selection without trying to load a missing default or another library model. */
  async clearModelSelection(revision, signal) {
    signal=this.signal(signal);signal.throwIfAborted()
    if(this.load||this.manualPreview||this.motions.active)throw preferenceError('busy','Finish or cancel the current display operation first.')
    const o=this.overlay,wasRunning=!!o.starting||!!o.child&&!o.dead,activity=o.activity,activated=o.activated,userHidden=o.runtime.userHidden===true
    await this.store.update({modelPath:null,modelEntry:null,profilePath:null,view:'keyboard'},revision,async()=>({
      commit:async()=>{
        signal.throwIfAborted()
        await o.stopDisplay('Model selection cleared.')
        this.models.cancelSelection();this.models.invalidate();this.motions.invalidate();this.motions.loadedSource=null
        await o.setViewIntent('keyboard')
        this.lastError=null;o.lastError=null
      },
    }),{forcePrepare:true})
    // Restart only a display that was already running; never start the input bridge.
    // The library invokes this after its lock is released and file removal finishes.
    return async()=>{
      if(!wasRunning||!o.enabled||o.closed||signal.aborted)return
      try {
        if(o.activity===activity){o.activated=activated;o.runtime.userHidden=userHidden}
        await o.start({hidden:!o.activated||o.runtime.userHidden===true,deferModel:true})
        o.changed()
      }catch(error){this.lastError='Model deselected; keyboard display unavailable: '+error.message;o.warn?.(this.lastError)}
    }
  }
  async pick(action, signal) {
    this.requireEnabled()
    if (this.busy) throw preferenceError('busy', 'Another dialog or load is active.')
    if(!existsSync(this.overlay.desktop))throw preferenceError('picker_unavailable','The native file picker is unavailable; rebuild or reinstall the desktop runtime.')
    const modes = { importModelFile: 'model-file', importModelFolder: 'model-folder', importProfile: 'profile', importKeyboardImage: 'keyboard-image' }
    this.busy = 'picking'
    const operation = new AbortController(); this.load = operation
    const combined = AbortSignal.any([signal, operation.signal])
    try {
      const revision = (await this.getState()).revision
      const selection = await this.utility(['--pick', modes[action]], combined)
      if (!selection.path) return
      validatePreferencePatch({ modelPath: selection.path })
      this.busy = null; this.load = null
      if (action === 'importKeyboardImage') {
        const metadata = await this.utility(['--validate-skin', selection.path], AbortSignal.any([combined, AbortSignal.timeout(10000)]))
        const bytes = await this.io.readFile(selection.path)
        if (bytes.length > 8 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) throw new Error('Selected image changed or exceeds the import budget.')
        const extension = extname(selection.path).toLowerCase()
        const path = join(dirname(this.store.path), 'skins', metadata.sha256 + extension)
        await this.io.mkdir(dirname(path), { recursive: true })
        try { await this.io.writeFile(path, bytes, { flag: 'wx' }) } catch (error) { if (error.code !== 'EEXIST') throw error }
        await this.applyPreferences({ keyboardImage: path }, revision, combined)
      } else if(action==='importProfile') {
        const imported=await this.readProfile(selection.path,combined)
        if(this.store.value.globalAdapter===null)await this.applyPreferences({globalAdapter:null,profilePath:null},revision,combined,{profileProof:imported.proof,inputBindings:imported.bindings})
        else await this.applyPreferences({globalAdapter:validateGlobalAdapter({...this.store.value.globalAdapter,bindings:imported.bindings}),profilePath:null},revision,combined,{profileProof:imported.proof})
      } else if(this.canDiscover()) {
        this.busy='discovering';this.load=operation
        const catalog=await this.models.discover(selection.path,combined);combined.throwIfAborted();this.busy=null;this.load=null
        const available=catalog.items.filter(x=>!x.error)
        if(available.length===1)await this.models.select({type:'selectModel',catalogGeneration:catalog.generation,modelId:available[0].id,revision},combined)
      } else {
        if(selection.path.toLowerCase().endsWith('.zip'))throw preferenceError('unsupported','The old native picker/renderer does not support ZIP models.')
        await this.applyPreferences({modelPath:selection.path,modelEntry:null,profilePath:null},revision,combined)
      }
    } finally { if (this.load === operation) this.load = null; if (this.busy === 'picking'||this.busy==='discovering') this.busy = null }
  }
  async preview(signal) {
    this.requireEnabled()
    if (!this.canPreview()) throw preferenceError('unsafe_preview', 'Real input is held or its release is unconfirmed.')
    const inherited=this.previewContext&&this.previewContext.activity===this.overlay.activity?this.previewContext:null
    this.manualPreview?.abort(abortError())
    const controller = new AbortController(); this.manualPreview = controller
    const combined = AbortSignal.any([signal, controller.signal])
    const o = this.overlay, wasRunning = inherited?.wasRunning??(o.ready&&!o.dead), previous = inherited?.previous??o.state, activated = inherited?.activated??o.activated
    const userHidden = inherited?.userHidden??o.runtime.userHidden, activity = o.activity
    this.previewContext={wasRunning,previous,activated,userHidden,activity}
    try {
      o.stopped = false; o.state = o.previewState; o.previewState.reset('simulation'); o.activated = true
      await o.start(); combined.throwIfAborted()
      if (!o.ready) throw new Error('Preview display could not start.')
      if (o.capabilities.management) await o.command({ kind: 'control', action: 'show' }, { signal: combined })
      const b = o.preview.bounds ?? { x: 0, y: 0, width: 1920, height: 1080 }
      o.preview.start([
        { kind: 'hold', keys: ['a'], holdMs: 600 }, { kind: 'wait', durationMs: 400 },
        { kind: 'move', x: Math.round(b.x + b.width * .65), y: Math.round(b.y + b.height * .55) },
        { kind: 'click', button: 'left' }, { kind: 'scroll', amount: -120 }, { kind: 'wait', durationMs: 1972 },
      ], 1, 3000, combined)
      await o.preview.done
    } finally {
      if (this.manualPreview === controller) {
        this.manualPreview = null;this.previewContext=null
        if (o.activity === activity && !o.closed) {
          o.preview.stop(); o.state = previous; o.activated = activated
          if (wasRunning) {
            o.changed()
            if (o.capabilities.management && o.ready) await o.command({ kind: 'control', action: userHidden ? 'hide' : 'show' }).catch(() => {})
          } else await o.stopDisplay()
        }
      }
    }
  }
  async command(action, signal) {
    action=validateMotionAction(action)
    signal = this.signal(signal)
    if (action === 'stopMotion') return this.motions.stop()
    if (action === 'hide' && this.motions.active) await this.motions.stop()
    if ((action==='show'||action==='beginAdjust')&&this.motions.active) {const o=this.overlay;this.requireEnabled();o.activity++;o.onActivity?.();o.activated=true;o.state=o.realState.session?o.realState:o.previewState;o.changed();await this.motions.stop()}
    if (action === 'cancelLoad') { this.cancelGeneration=(this.cancelGeneration??0)+1;this.load?.abort(abortError());this.models.cancelSelection();this.library?.cancel(); return }
    this.library??=new ModelLibrary(this)
    if(action==='addLibraryFile'||action==='addLibraryFolder')return this.library.beginAdd(action,signal)
    if(typeof action==='object'&&action.type==='addLibraryModels')return this.library.add(action,signal)
    if(typeof action==='object'&&action.type==='selectLibraryModel')return this.library.select(action,signal)
    if(typeof action==='object'&&action.type==='removeLibraryModel')return this.library.remove(action,signal)
    if(typeof action==='object'&&action.type==='setDisplayView'){this.requireEnabled();await this.updatePreferences({view:action.view},action.revision,signal);await this.overlay.setViewIntent?.(action.view);return}
    if (action === 'stopPreview') { this.manualPreview?.abort(abortError()); return }
    this.requireEnabled()
    if(action==='show'&&this.utilitySupportsLibrary){await this.library.ready;await this.library.refresh();const id=this.library.active();if(!id)return this.library.restore(signal);return this.library.select({modelId:id,libraryRevision:this.library.index.revision,revision:this.store.revision},signal)}
    if(this.busy||(this.manualPreview&&action!=='preview'))throw preferenceError('busy','Another desktop operation is active; finish or cancel it first.')
    if (action==='preview'&&this.motions.active)throw preferenceError('busy','Stop the special motion before starting a keyboard preview.')
    if (typeof action==='object'&&action.type==='selectModel')return this.models.select(action,signal)
    if (typeof action==='object') return this.motions.play(action,signal)
    if (action==='refreshAdapter')return this.models.refresh(signal)
    if (action==='refreshMotions') return this.motions.refresh(signal)
    if (action === 'preview') return this.preview(signal)
    if (action.startsWith('import')) return this.pick(action, signal)
    const revision = (await this.getState()).revision
    if (action === 'clearProfile') {const current=this.store.value.globalAdapter;if(current!==null){const record=structuredClone(current);delete record.bindings;return this.applyPreferences({globalAdapter:record,profilePath:null},revision,signal)}return this.applyPreferences({globalAdapter:null,profilePath:null},revision,signal,{inputBindings:null})}
    if (action === 'clearKeyboardImage') return this.applyPreferences({ keyboardImage: null }, revision, signal)
    if (action === 'reloadModel') {
      if (this.load) throw preferenceError('busy', 'Another model is loading.')
      const wasRunning = this.overlay.ready && !this.overlay.dead, activity = this.overlay.activity
      this.load = new AbortController(); this.busy = 'loading'
      const combined = AbortSignal.any([signal, this.load.signal])
      try {
        await this.ensureManagement(combined)
        const p = this.store.value
        const prepared=await this.stageModel(structuredClone(p),combined)
        await this.overlay.command({ kind: 'commit-model' }, { signal: combined });this.motions.invalidate();if(this.overlay.capabilities.adaptation)this.models.accept(prepared)
      } catch(error){await this.overlay.command({kind:'cancel-load'}).catch(()=>{});throw error}
      finally {
        if (combined.aborted) await this.overlay.command({ kind: 'cancel-load' }).catch(() => {})
        this.load = null; this.busy = null; await this.retireTemporary(wasRunning, activity)
      }
      return
    }
    if (action === 'resetLayout') return this.applyPreferences({ x: null, y: null, widthDip: 420, keyboardWidthDip: 900, opacity: 1 }, revision, signal)
    if (action === 'retryDisplay') {
      await this.overlay.stopDisplay(); this.overlay.useDesktop = existsSync(this.overlay.desktop)
      this.overlay.lastError = null; action = 'show'
       if(this.utilitySupportsLibrary){await this.library.ready;await this.library.refresh();const id=this.library.active();if(!id)return this.library.restore(signal);return this.library.select({modelId:id,libraryRevision:this.library.index.revision,revision:this.store.revision},signal)}
    }
    const o=this.overlay,wantsDisplay=action==='show'||action==='beginAdjust'
    const previous={running:o.ready&&!o.dead,activated:o.activated,state:o.state,userHidden:o.runtime.userHidden}
    let intent
    if(wantsDisplay){
      o.activity++;intent=o.activity;o.onActivity?.()
      o.state=o.realState.session?o.realState:o.previewState
      if(o.state===o.previewState)o.previewState.reset('simulation')
      o.activated=true;o.changed()
    }
    try{
      o.stopped=false
      await this.ensureManagement(signal)
      await o.command({kind:'control',action},{signal})
    }catch(error){
      if(wantsDisplay&&o.activity===intent&&!o.closed){
        o.activated=previous.activated;o.state=previous.state;o.runtime.userHidden=previous.userHidden;o.changed()
        if(!previous.running)await o.stopDisplay('Display request canceled or failed.')
        else if(o.ready&&o.capabilities.management)await o.command({kind:'control',action:previous.userHidden||!previous.activated?'hide':'show'}).catch(()=>{})
      }
      throw error
    }
  }
  async restoreSelection(){this.library??=new ModelLibrary(this);try{await this.library.restore(this.lifetime.signal)}catch(error){if(!this.lifetime.signal.aborted){this.lastError=error.message;this.overlay.warn?.('game player: automatic pet restoration failed: '+error.message)}}}
  async close() {
    this.library?.cancel();this.models.cancelSelection();this.models.invalidate();
    this.lifetime.abort(abortError()); this.load?.abort(abortError()); this.manualPreview?.abort(abortError())
    await this.motions.stop();await this.store.queue
  }
}
