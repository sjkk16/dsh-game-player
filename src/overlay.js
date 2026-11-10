import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { InputDisplayState, InputPreview } from './overlay-state.js'
import { resolvePowershell } from './pwsh-bridge.js'
import { OverlayPreferences } from './overlay-preferences.js'
import { cleanupOverlayCache } from './overlay-cache.js'
import { desktopExecutable, desktopLaunch } from './desktop-runtime.js'
const directory=dirname(fileURLToPath(import.meta.url))
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export class OverlayController {
  constructor(options={}) {
    // `enabled` may be a live resolver when the panel switch is a volatile
    // setting: every read asks the current value instead of a constructor copy.
    this.enabledSource=typeof options.enabled==='function'?options.enabled:()=>options.enabled!==false
    this.spawn=options.spawn??spawn;this.powershell=options.powershell??resolvePowershell()
    this.settingsPath=options.settingsPath??join(process.env.LOCALAPPDATA??join(homedir(),'AppData','Local'),'dsh-game-player','overlay.json')
    this.warn=options.warn??(()=>{});this.timeoutMs=options.timeoutMs??30000
    this.startupTimeoutMs=options.startupTimeoutMs??options.timeoutMs??55000
    this.desktop=options.desktop??desktopExecutable()
    this.useDesktop=options.useDesktop??(!options.powershell&&existsSync(this.desktop))
    this.defaultModel=options.defaultModel??join(directory,'..','..','Deepseek桌宠')
    // The production Host opts in only after the display runtime verifies that
    // WDA_EXCLUDEFROMCAPTURE is active. A runtime that reports false keeps the
    // acknowledged hide + DwmFlush fallback, so the fast path can never hide a
    // failed capture exclusion behind a successful Windows API call.
    this.trustCaptureAffinity=options.trustCaptureAffinity===true
    this.realState=new InputDisplayState(options.now);this.previewState=new InputDisplayState(options.now);this.state=this.realState
    this.preview=new InputPreview(this.previewState,()=>{if(this.state===this.previewState)this.changed()},options.preview)
    this.child=undefined;this.starting=undefined;this.ready=false;this.stopped=false;this.closed=false;this.dead=true
    this.captureCount=0;this.captureQueue=Promise.resolve();this.pending=new Map();this.sequence=0
    this.buffer='';this.blocked=false;this.latest=undefined;this.lastError=undefined;this.previewTicket=0
    this.startupPulses=new Set();this.startupMove=false;this.startupText=false;this.startupWheel=0
    // Appearance: `style` is a resolved palette payload, `view` selects the
    // keyboard panel or the Live2D model. Both are re-sent to every new display
    // process, and both are advisory: a panel that cannot apply one keeps running.
    this.styleSource=typeof options.style==='function'?options.style:()=>options.style
    this.viewSource=typeof options.view==='function'?options.view:()=>options.view
    this.style=undefined;this.styleKey=undefined;this.view=undefined;this.viewSent=undefined
    this.unsupported=new Set()
    this.preferences=options.preferences??new OverlayPreferences(this.settingsPath)
    this.protocolVersion=2;this.capabilities={};this.activated=false;this.activity=0
    this.visibilityHolds=0;this.deferModelStartup=0;this.nativeCaches=new WeakMap()
    this.runtime={phase:'not-started',renderer:null,visible:false,userHidden:false,adjusting:false,modelLoaded:false,loading:false,error:null}
    this.onActivity=undefined;this.onPreferences=undefined;this.onRealObservation=undefined;this.onMotionEvent=undefined
  }
  get enabled() { return this.enabledSource()!==false }
  observe(message) { if(!this.enabled||this.closed)return;if(this.realState.accept(message)){this.onRealObservation?.(message);if(this.state===this.realState)this.changed()} }
  beginReal() {
    if(!this.enabled||this.closed)return
    if(this.stopping){this.activity++;this.pendingActivity={kind:'real'};this.onActivity?.();this.preview.stop();this.state=this.realState;this.changed();return}
    if(this.stopped)return
    this.activity++;this.activated=true;this.onActivity?.();this.previewTicket++;this.preview.stop();this.state=this.realState;this.changed();void this.start() }
  simulate(actions,repeat,maxHoldMs,signal) {
    if(!this.enabled||this.closed||signal?.aborted)return
    if(this.stopping){if(this.pendingActivity?.kind!=='real'){this.activity++;this.pendingActivity={kind:'simulation',actions,repeat,maxHoldMs,signal};this.onActivity?.()}return}
    if(this.stopped)return
    this.activity++;this.activated=true;this.onActivity?.()
    const ticket=++this.previewTicket
    this.preview.stop();this.state=this.previewState;this.state.reset('simulation');this.changed()
    // Cold startup must not consume the entire short preview while the form compiles.
    void this.start().then(()=>{if(this.ready&&!this.closed&&!this.stopped&&ticket===this.previewTicket&&!signal?.aborted)this.preview.start(actions,repeat,maxHoldMs,signal)})
  }
  changed() {
    if(this.captureCount>0)this.onMotionEvent?.({kind:'capture-hidden'})
    const value=this.state.snapshot()
    if(!this.ready&&this.child&&this.state===this.realState){
      for(const p of value.pulses)this.startupPulses.add(p.id)
      if(value.moveMs>0)this.startupMove=true;if(value.textMs>0)this.startupText=true;if(value.wheelMs>0)this.startupWheel=value.wheelDirection
    }
    this.latest={kind:'state',...value,activated:this.activated&&this.visibilityHolds===0};this.flush()
  }
  flush() {
    if(!this.ready||!this.child||this.dead||this.blocked||!this.latest||(!this.activated&&this.protocolVersion<3))return
    const value=this.latest;this.latest=undefined
    try {this.blocked=!this.child.stdin.write(JSON.stringify(value)+'\n','utf8')}catch(error){this.failed(error)}
  }
  failed(error) {
    this.runtime={...this.runtime,phase:'error',visible:false,error:error.message};this.lastError=error.message;this.stopped=true;this.ready=false;this.preview.stop();this.onMotionEvent?.({kind:'unavailable'})
    this.state.status='unknown';this.warn('game player: overlay unavailable: '+error.message)
    for(const {reject} of this.pending.values())reject(error)
    this.pending.clear();this.rejectReady?.(error)
    // Do not kill/restart input helpers and do not silently allow an uncertain screenshot.
    try{this.child?.stdin.end()}catch{}
  }
  holdVisibility() {
    this.visibilityHolds++;this.changed();let released=false
    return()=>{if(released)return;released=true;this.visibilityHolds--;this.changed()}
  }
  async start({hidden=false,deferModel=this.deferModelStartup>0}={}) {
    if(!this.enabled||this.closed||this.stopped)return
    if(this.starting)return this.starting
    if(this.ready)return
    this.starting=(async()=>{
      this.runtime={...this.runtime,phase:'starting',error:null}
      // A new display process knows nothing about the previous one.
      this.styleKey=undefined;this.viewSent=undefined;this.preferencesSentRevision=undefined
      const userHidden=this.runtime.userHidden===true
      try {
        if(!this.powershell)throw new Error('The overlay requires Windows.')
        if(!this.useDesktop)this.warn('game player: Live2D runtime not built; using the keyboard display. See LIVE2D.md.')
        const native=this.useDesktop?desktopLaunch(this.desktop,['--parent',String(process.pid),'--settings',this.settingsPath,'--default-model',this.defaultModel,'--managed','true','--defer-model',String(deferModel)]):null
        this.child=this.useDesktop?this.spawn(native.command,native.args,{windowsHide:true,stdio:['pipe','pipe','pipe']}):this.spawn(this.powershell,['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',join(directory,'overlay-host.ps1'),'-ParentPid',String(process.pid),'-SettingsPath',this.settingsPath],{windowsHide:true,stdio:['pipe','pipe','pipe']})
        this.dead=false
        const child=this.child
        this.exit=new Promise(resolve=>{child.once('close',()=>{if(this.child===child)this.dead=true;const cache=this.nativeCaches.get(child);this.nativeCaches.delete(child);cleanupOverlayCache(this.settingsPath,cache).catch(error=>this.warn('game player: private cache retained after exit: '+error.message)).finally(resolve)});child.once('error',()=>{if(!child.pid&&this.child===child)this.dead=true;resolve()})})
        child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');let errors=''
        child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-2048)})
        child.stdin.on('drain',()=>{if(this.child!==child)return;this.blocked=false;this.flush()})
        child.stdin.on('error',error=>{if(this.child===child)this.failed(error)})
        child.on('error',error=>{if(this.child===child)this.failed(error)})
        child.on('exit',()=>{if(this.child!==child)return;this.dead=true;if(!this.closed&&!this.stopped)this.failed(new Error('Display process exited'+(errors?': '+errors.trim():'')))})
        const ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject})
        child.stdout.on('data',chunk=>{if(this.child===child)this.read(chunk,child)})
        let timeout
        try {await Promise.race([ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Display startup timed out before the renderer/model handshake.')),this.startupTimeoutMs)})])}finally{clearTimeout(timeout);this.rejectReady=undefined}
        if(this.closed||this.stopped)return
        this.ready=true
        await this.preferences.ready
        // The native window starts hidden. A capture already in flight takes priority.
        if(this.captureCount>0)await this.syncCapture()
        // Appearance before the first state, so the panel never paints once in a
        // stale theme or key-count preset and then switches.
        await this.syncPreferences()
        if(!deferModel&&this.capabilities.adaptation)await this.onInitializeModel?.()
        await this.syncView()
        await this.syncStyle()
        if(userHidden&&this.capabilities.management)await this.command({kind:'control',action:'hide'})
        if(this.state===this.realState){
          for(const id of this.startupPulses)this.state.pulse(id)
          const until=this.state.now()+180
          if(this.startupMove)this.state.moveUntil=until;if(this.startupText)this.state.textUntil=until
          if(this.startupWheel){this.state.wheelUntil=until;this.state.wheelDirection=this.startupWheel}
        }
        this.startupPulses.clear();this.startupMove=false;this.startupText=false;this.startupWheel=0
        if(!hidden||this.activated||this.protocolVersion>=3)this.changed()
        this.runtime={...this.runtime,phase:this.runtime.phase==='starting'?'ready':this.runtime.phase}
      }catch(error){
        const stopping=this.stopped
        if(!this.closed&&!stopping)this.failed(error)
        // Fall back once after an early executable/runtime failure. Wait for
        // the old process to exit before any new window may be created.
        if(this.useDesktop&&!this.closed&&!stopping){
          try{this.child?.stdin.end()}catch{}
          if(!this.dead)await Promise.race([this.exit,delay(1000)])
          if(!this.dead){try{this.child.kill()}catch{};await Promise.race([this.exit,delay(1000)])}
          if(this.dead){this.useDesktop=false;this.stopped=false;this.buffer='';this.child=undefined;this.blocked=false;this.starting=undefined;this.changed();await this.start({hidden,deferModel})}
        }
      }
    })()
    try{await this.starting}finally{this.starting=undefined}
  }
  read(chunk,child=this.child) {
    this.buffer+=chunk
    if(this.buffer.length>65536){this.failed(new Error('Oversized overlay message.'));return}
    for(;;){const at=this.buffer.indexOf('\n');if(at<0)return;const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1)
      try {
        const message=JSON.parse(line)
        if(message.kind==='warning'&&typeof message.message==='string'){this.warn('game player: '+message.message.slice(0,2048));continue}
        if(message.kind==='bounds'){this.setBounds(message.bounds);continue}
        if(message.kind==='affinity'&&typeof message.affinitySupported==='boolean'){this.affinity=message.affinitySupported;continue}
        if(message.kind==='status'&&message.state&&typeof message.state==='object'){
          if(typeof message.state.modelCapable==='boolean')this.capabilities.model=message.state.modelCapable
          if(typeof message.state.motionCapable==='boolean')this.capabilities.motions=message.state.motionCapable
          if(typeof message.state.adaptationCapable==='boolean')this.capabilities.adaptation=message.state.adaptationCapable
          if(typeof message.state.archiveCapable==='boolean')this.capabilities.archives=message.state.archiveCapable
          if(typeof message.state.adaptationCapable==='boolean')this.capabilities.handStyles=message.state.adaptationCapable
          if(message.state.modelLoaded===false&&message.state.error)this.onMotionEvent?.({kind:'unavailable'})
          if(message.cache&&child)this.nativeCaches.set(child,message.cache)
          this.runtime={...this.runtime,...message.state};if(message.state.phase==='ready'&&!message.state.error)this.lastError=null;this.renderer=message.state.renderer??this.renderer;continue
        }
        if(message.kind==='preferences-change'&&message.patch&&Number.isSafeInteger(message.revision)){
          Promise.resolve(this.onPreferences?.(message.patch,message.revision)).catch(error=>this.warn('game player: preference change failed: '+error.message));continue
        }
        if(message.kind==='ready'&&[2,3].includes(message.protocolVersion)){
          if(message.protocolVersion===3&&message.cache&&child)this.nativeCaches.set(child,message.cache)
          this.lastError=null;this.protocolVersion=message.protocolVersion;this.capabilities=message.capabilities??{}
          this.runtime={...this.runtime,renderer:message.renderer??'keyboard',modelLoaded:message.modelLoaded===true,phase:message.modelLoaded||(!message.error&&message.capabilities?.model)?'ready':'fallback',error:message.error??null,errorCode:message.errorCode??null};this.affinity=message.affinitySupported===true;this.renderer=message.renderer??'keyboard';this.setBounds(message.bounds);this.resolveReady?.();continue}
        if(message.kind==='motion-ended'){this.onMotionEvent?.(message);continue}
        if(message.kind==='closed'){this.onMotionEvent?.({kind:'unavailable'});this.runtime={...this.runtime,phase:'stopped',visible:false};this.stopped=true;this.ready=false;this.preview.stop();continue}
        if(message.kind==='metrics'&&typeof message.id==='string'){this.pending.get(message.id)?.resolve({...message,ok:true});continue}
        if(message.kind!=='ack'||typeof message.id!=='string'||typeof message.ok!=='boolean')throw new Error('Invalid overlay reply.')
        const pending=this.pending.get(message.id);if(!pending)continue
        if(message.ok)pending.resolve(message);else pending.reject(new Error(message.error??'Overlay command failed.'))
      }catch(error){this.failed(error);return}
    }
  }
  setBounds(b) {
    if(b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.width>0&&b.height>0)this.preview.bounds={x:b.x,y:b.y,width:b.width,height:b.height}
  }
  /** Warn once per rejected appearance value; a panel limitation must not spam. */
  unsupportedOnce(kind, key, reason) {
    const id = kind + '\u0000' + key
    if (this.unsupported.has(id)) return
    this.unsupported.add(id)
    this.warn('game player: overlay could not apply the ' + kind + (reason ? ' (' + reason + ')' : '') + '; it keeps the previous appearance.')
  }
  /**
   * Send the current appearance payload to the running display process.
   *
   * The Host owns the selection, the panel owns the drawing. A value that only
   * changes the palette must never restart the process or drop input state, so
   * the payload travels as a command and a panel that refuses it keeps drawing
   * exactly as before. Repeated calls with the same payload are no-ops.
   */
  async syncStyle() {
    let style
    try { style = this.styleSource() } catch (error) {
      this.warn('game player: overlay style could not be resolved: ' + (error?.message ?? error)); return
    }
    if (!style || typeof style !== 'object') return
    this.style = style
    if (!this.ready || !this.child || this.dead || this.stopped) return
    const key = JSON.stringify(style)
    if (this.styleKey === key) return
    try {
      const reply = await this.command({ kind: 'style', style })
      this.styleKey = key
      if (reply.applied === false) this.unsupportedOnce('style', key, reply.reason)
      else if (style.skin === 'custom' && reply.skinLoaded === false) this.unsupportedOnce('skin', key, 'the keyboard image is missing or unreadable')
    } catch (error) {
      this.warn('game player: overlay style could not be applied: ' + (error?.message ?? error))
    }
  }
  /**
   * Ask the display process for a view: `auto` keeps the locally saved view, `model`
   * and `keyboard` force one. A keyboard-only runtime answers applied:false.
   */
  async setViewIntent(view){this.manualView=view;return this.syncView()}
  async syncView({fromConfiguration=false}={}) {
    if(fromConfiguration)this.manualView=undefined
    let view
    try { view = this.manualView??this.viewSource() } catch (error) {
      this.warn('game player: overlay view could not be resolved: ' + (error?.message ?? error)); return
    }
    if (typeof view !== 'string') return
    this.view = view
    if (!this.ready || !this.child || this.dead || this.stopped) return
    if (this.viewSent === view) return
    try {
      const reply = await this.command({ kind: 'view', view })
      this.viewSent = view
      if (reply.applied === false) this.unsupportedOnce('view', view, reply.reason)
    } catch (error) {
      this.warn('game player: overlay view could not be applied: ' + (error?.message ?? error))
    }
  }
  async syncPreferences() {
    if(!this.ready||this.dead||this.protocolVersion<3||!this.capabilities.management)return
    const snapshot=this.preferences.snapshot();await this.command({kind:'preferences',...snapshot});this.preferencesSentRevision=snapshot.revision
  }
  command(value,{signal,timeoutMs=this.timeoutMs}={}) {
    if(signal?.aborted)return Promise.reject(signal.reason??new Error('Canceled.'))
    if(!this.child||this.dead)return Promise.reject(new Error('Overlay is not connected.'))
    if(this.pending.size>=64)return Promise.reject(new Error('Overlay command queue is full.'))
    const id='overlay-'+(++this.sequence)
    return new Promise((resolve,reject)=>{
      let timer
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(id)}
      const abort=()=>{
        cleanup();reject(signal.reason??new Error('Canceled.'))
        if(this.protocolVersion>=3)void this.command({kind:'cancel',target:id},{timeoutMs:2000}).catch(()=>{})
      }
      timer=setTimeout(()=>{cleanup();reject(new Error('Overlay command timed out.'));if(this.protocolVersion>=3)void this.command({kind:'cancel',target:id},{timeoutMs:2000}).catch(()=>{})},timeoutMs)
      this.pending.set(id,{resolve:m=>{cleanup();resolve(m)},reject:e=>{cleanup();reject(e)}})
      signal?.addEventListener('abort',abort,{once:true})
      try{if(!this.child.stdin.write(JSON.stringify({...value,id})+'\n','utf8'))this.blocked=true}catch(error){cleanup();reject(error)}
    })
  }
  /** Stop ONLY the display. The controller and real-input safety state remain reusable. */
  stopDisplay(reason='Display stopped.') {
    if(this.stopping)return this.stopping
    this.stopping=this.finishStop(reason).finally(()=>{
      this.stopping=undefined;const pending=this.pendingActivity;this.pendingActivity=undefined
      if(pending&&this.enabled&&!this.closed){if(pending.kind==='real')this.beginReal();else this.simulate(pending.actions,pending.repeat,pending.maxHoldMs,pending.signal)}
    })
    return this.stopping
  }
  async finishStop(reason) {
    this.stopped=true;this.ready=false;this.latest=undefined
    this.rejectReady?.(new Error(reason))
    if(this.starting)await this.starting
    const child=this.child
    if(child){
      if(!this.dead)try{child.stdin.end()}catch{}
      await Promise.race([this.exit??Promise.resolve(),delay(4000)])
      if(!this.dead){try{child.kill()}catch{};await Promise.race([this.exit??Promise.resolve(),delay(4000)])}
    }
    for(const {reject} of this.pending.values())reject(new Error(reason))
    this.pending.clear();if(this.child===child)this.child=undefined
    this.buffer='';this.blocked=false;this.dead=true;this.ready=false;this.stopped=false
    this.activated=false;this.renderer=undefined;this.runtime={...this.runtime,phase:'stopped',renderer:null,modelLoaded:false,visible:false,adjusting:false,loading:false,modelName:null,modelPath:null,modelSourcePath:null,modelEntry:null,modelKey:null,modelToken:null,modelProfilePath:null,sourceProof:null,adapterCatalog:null,motionSignature:null,motionCatalog:null,error:null,errorCode:null,stage:null}
  }
  syncCapture() {
    const run=async()=>{
      if(this.dead||!this.child)return
      if(!this.ready)throw new Error('Overlay capture exclusion is not confirmed.')
      if(this.trustCaptureAffinity&&this.affinity)return
      const hidden=this.captureCount>0
      const result=await this.command({kind:'capture',hidden})
      if(result.hidden!==hidden)throw new Error('Overlay returned an incorrect visibility acknowledgement.')
    }
    const result=this.captureQueue.then(run,run);this.captureQueue=result.catch(()=>{});return result
  }
  async capture(capture) {
    if(!this.enabled)return capture()
    if(this.closed&&this.child&&!this.dead)throw new Error('Overlay is still closing; capture exclusion is not confirmed.')
    this.captureCount++
    try {
      if(this.starting)await this.starting
      await this.syncCapture()
      return await capture()
    } finally {
      this.captureCount--
      if(this.captureCount===0)try{await this.syncCapture()}catch(error){this.warn('game player: overlay restore failed: '+error.message)}
    }
  }
  /**
   * Apply a live `overlayEnabled` change to this controller.
   *
   * Disabling closes the display process but keeps the controller reusable, so
   * enabling again needs no plugin remount: the next real input restarts the
   * panel. Nothing happens when the controller is already closed.
   */
  async syncEnabled() {
    if (this.closed) return
    this.previewTicket++
    this.preview.stop()
    this.stopped=false
    if (this.enabled) return
    this.activity++;this.onActivity?.()
    await this.stopDisplay('Overlay disabled.')
  }

  async close() {
    if(this.closed)return
    this.closed=true;this.pendingActivity=undefined;this.activity++;this.onActivity?.();this.previewTicket++;this.preview.stop()
    if(this.stopping)await this.stopping
    this.rejectReady?.(new Error('Overlay closed during startup.'))
    if(this.starting)await this.starting
    if(!this.child)return
    if(this.dead){await Promise.race([this.exit??Promise.resolve(),delay(4000)]);return}
    // EOF is an unconditional native shutdown signal, independent of UI replies.
    try{this.child.stdin.end()}catch{}
    await Promise.race([this.exit,delay(4000)])
    if(!this.dead){try{this.child.kill()}catch{};await Promise.race([this.exit,delay(4000)])}
    for(const {reject} of this.pending.values())reject(new Error('Overlay closed.'))
    this.pending.clear()
  }
}
