import { randomUUID } from 'node:crypto'
import { preferenceError } from './overlay-preferences.js'
import { requireModelSelection } from './model-selection.js'
const canceled=()=>preferenceError('canceled','Motion preview canceled.')
/** Uses only the display controller. No capture, bridge, or helper dependency. */
export class OverlayMotions {
  constructor(manager){this.manager=manager;this.overlay=manager.overlay;this.cache=null;this.seenToken=null;this.loadedSource=null;this.active=null}
  source(){const p=this.manager.store.value;return this.manager.models?.source()??JSON.stringify([p.modelPath??this.overlay.defaultModel,p.profilePath??null])}
  invalidate(){this.cache=null;this.seenToken=this.overlay.runtime.modelToken??null}
  accept(reply){
    if(typeof reply.signature!=='string'||typeof reply.modelToken!=='string'||!Array.isArray(reply.motions)||reply.motions.length>64)throw preferenceError('unsupported','This renderer does not provide a validated motion catalog.')
    const source=this.source(),items=reply.motions.map(x=>({id:x.id,name:x.name,enabled:x.enabled===true,error:x.error??null,durationMs:x.durationMs,originalDurationMs:x.originalDurationMs}))
    if(items.some(x=>typeof x.id!=='string'||!/^motion-[0-9]{1,2}$/.test(x.id)||typeof x.name!=='string'||x.name.length>128||x.enabled&&(!Number.isFinite(x.durationMs)||x.durationMs<=0||x.durationMs>10000)))throw preferenceError('unsupported','Invalid motion catalog reply.')
    if(!this.cache||this.cache.source!==source||this.cache.signature!==reply.signature||JSON.stringify(this.cache.items)!==JSON.stringify(items))this.cache={generation:randomUUID(),source,signature:reply.signature,items}
    this.seenToken=reply.modelToken;this.loadedSource=source;return this.cache
  }
  snapshot(){
    const o=this.overlay;if(this.cache&&this.cache.source!==this.source()){this.invalidate();this.active?.controller.abort(preferenceError('stale_motion_catalog','The model selection changed.'))}
    if(o.ready&&o.runtime.modelLoaded&&o.capabilities.motions&&o.runtime.modelToken&&o.runtime.modelToken!==this.seenToken&&o.runtime.motionSignature&&Array.isArray(o.runtime.motionCatalog))this.accept({modelToken:o.runtime.modelToken,signature:o.runtime.motionSignature,motions:o.runtime.motionCatalog})
    return {motionCatalog:this.cache?{generation:this.cache.generation,items:this.cache.items}:null,motion:this.active?{id:this.active.id,name:this.active.name,phase:this.active.phase,durationMs:this.active.durationMs,startedAt:this.active.startedAt}:null}
  }
  event(message){
    const a=this.active;if(!a)return
    if(message.kind==='capture-hidden'){a.controller.abort(canceled());return}
    if(message.kind==='unavailable'){a.controller.abort(preferenceError('unavailable','The motion renderer stopped.'));return}
    if(message.ticket===a.ticket&&message.token===a.token){if(message.reason==='hidden'){a.hiddenByRuntime=true;a.hiddenState=this.overlay.runtime.userHidden;}a.finish(message)}
  }
  async ready(signal){
    const m=this.manager,o=this.overlay;await m.ensureModelManagement(signal)
    if(!o.capabilities.motions)throw preferenceError('unsupported','Motion playback requires the updated Live2D renderer; the keyboard fallback does not support it.')
    if(m.models){await m.models.ready(signal,{needAdapter:false});signal.throwIfAborted();return o.command({kind:'get-motions'},{signal})}
    const p=m.store.value,modelPath=requireModelSelection(p.modelPath,o.defaultModel),chosen=modelPath.replace(/\\/g,'/').replace(/\/$/,'').toLowerCase(),actual=o.runtime.modelPath?.replace(/\\/g,'/').toLowerCase()
    const pathMatches=actual?(chosen.endsWith('.model3.json')?actual===chosen:actual.startsWith(chosen+'/')):!this.loadedSource||this.loadedSource===this.source()
    const profileMatches=o.runtime.modelProfilePath===undefined?true:(o.runtime.modelProfilePath??null)===(p.profilePath??null)
    if(!o.runtime.modelLoaded||!pathMatches||!profileMatches){await o.command({kind:'load-model',modelPath,profilePath:p.profilePath},{signal});await o.command({kind:'commit-model'},{signal})}
    signal.throwIfAborted();return o.command({kind:'get-motions'},{signal})
  }
  async refresh(signal){
    const m=this.manager,o=this.overlay,wasRunning=o.ready&&!o.dead,activity=o.activity,controller=new AbortController()
    m.busy='loading';m.load=controller;o.deferModelStartup++;const release=o.runtime.modelLoaded?()=>{}:o.holdVisibility()
    const combined=AbortSignal.any([signal,controller.signal])
    try{this.accept(await this.ready(combined))}
    finally{if(combined.aborted&&o.ready)await o.command({kind:'cancel-load'}).catch(()=>{});m.load=null;m.busy=null;try{await m.retireTemporary(wasRunning,activity)}finally{o.deferModelStartup--;release()}}
  }
  async stop(){const a=this.active;if(a){a.controller.abort(canceled());await a.done}}
  async play(request,signal){
    const m=this.manager,o=this.overlay;m.requireEnabled();this.snapshot()
    const expected=this.cache,item=expected?.items.find(x=>x.id===request.motionId)
    if(!expected||request.catalogGeneration!==expected.generation)throw preferenceError('stale_motion_catalog','The model or motion catalog changed. Read the available motions again.')
    if(!item?.enabled)throw preferenceError('motion_unavailable',item?.error??'This model does not provide that motion.')
    if(!m.canPreview())throw preferenceError('unsafe_preview','Real input is held or its release is unconfirmed.')
    if(o.captureCount>0)throw preferenceError('busy','Motion preview is unavailable while the display is hidden for capture.')
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]),ticket=randomUUID()
    const a={controller,ticket,id:item.id,name:item.name,phase:'loading',durationMs:item.durationMs,token:null,startedAt:null}
    let finish;const ended=new Promise(resolve=>{finish=resolve});a.finish=finish
    let resolveDone;a.done=new Promise(resolve=>{resolveDone=resolve});this.active=a;m.manualPreview=controller
    const wasRunning=o.ready&&!o.dead,previous=o.state,activated=o.activated,userHidden=o.runtime.userHidden,activity=o.activity
    let timer,abort;const aborted=new Promise((_,reject)=>{abort=()=>reject(combined.reason??canceled())});combined.addEventListener('abort',abort,{once:true});aborted.catch(()=>{})
    const release=o.holdVisibility();o.deferModelStartup++
    try{
      o.stopped=false;const reply=await this.ready(combined)
      if(this.source()!==expected.source){this.invalidate();throw preferenceError('stale_motion_catalog','The model selection changed during hidden validation.')}
      const actual=this.accept(reply)
      if(reply.signature!==expected.signature||JSON.stringify(actual.items)!==JSON.stringify(expected.items))throw preferenceError('stale_motion_catalog','Model resources changed during hidden validation. Read the motion catalog again.')
      combined.throwIfAborted();m.requireEnabled();if(o.captureCount>0)throw preferenceError('busy','The display is temporarily hidden for capture.');if(!m.canPreview())throw preferenceError('unsafe_preview','Real input began while the model was loading.')
      a.token=reply.modelToken;o.state=o.previewState;o.previewState.reset('simulation');o.activated=true;o.changed()
      await o.command({kind:'view',view:'model'},{signal:combined});await o.command({kind:'control',action:'show'},{signal:combined});release()
      const started=await o.command({kind:'play-motion',token:a.token,motionId:a.id,ticket},{signal:combined})
      combined.throwIfAborted();a.phase='playing';a.startedAt=Date.now();a.durationMs=Math.min(10000,started.durationMs??item.durationMs)
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(preferenceError('motion_timeout','The motion did not finish within its bounded preview budget.')),a.durationMs+1200)})
      const result=await Promise.race([ended,aborted,timeout]);if(result.reason!=='finished'&&result.reason!=='stopped')throw canceled()
    }finally{
      clearTimeout(timer);combined.removeEventListener('abort',abort)
      if(combined.aborted&&o.ready&&o.capabilities.management)await o.command({kind:'cancel-load'}).catch(()=>{})
      if(o.ready&&o.capabilities.motions)await o.command({kind:'stop-motion',ticket,reason:'cleanup'}).catch(()=>{})
      release();o.deferModelStartup--
      if(this.active===a){this.active=null;if(m.manualPreview===controller)m.manualPreview=null}
      try{
        if(o.activity===activity&&!o.closed){o.preview.stop();o.state=previous;o.activated=activated;o.changed();if(wasRunning&&o.ready&&o.capabilities.management){o.viewSent=undefined;await o.syncView();await o.command({kind:'control',action:(a.hiddenByRuntime?a.hiddenState:userHidden)?'hide':'show'}).catch(()=>{})}else if(!wasRunning)await o.stopDisplay()}
        else if(o.ready&&!o.closed){o.viewSent=undefined;await o.syncView()}
      }finally{resolveDone()}
    }
  }
}
