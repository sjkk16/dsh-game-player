import { randomUUID } from 'node:crypto'
import { normalize } from 'node:path'
import { preferenceError,validatePreferencePatch } from './overlay-preferences.js'
import { mergeGlobalAdapter } from './live2d/global-adapter.js'
import { validateAdapterAgainstCatalog } from './live2d/model-adapter.js'
import {validateWatermarkChange,validateWatermarkRecords,validateWatermarkCatalog} from './live2d/watermark.js'
const canonical=p=>typeof p==='string'?normalize(p).replaceAll('\\','/').replace(/\/$/,'').toLowerCase():null
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)
/** Candidate discovery and parameter catalogs are display-only; never import the input bridge. */
export class OverlayModels {
 constructor(manager){this.manager=manager;this.overlay=manager.overlay;this.cache=null;this.candidates=null;this.seenToken=null;this.loadedSource=null;this.proofAt=0;this.proofTask=null;this.reloadRequired=false}
 selection(p=this.manager.store.value){return JSON.stringify([canonical(p.modelPath??this.overlay.defaultModel),p.modelEntry??null])}
 currentKey(p=this.manager.store.value){if(this.cache?.selection===this.selection(p))return this.cache.modelKey;const o=this.overlay;if(canonical(o.runtime.modelSourcePath)===canonical(p.modelPath??o.defaultModel))return o.runtime.modelKey??null;return null}
 source(p=this.manager.store.value){const key=this.currentKey(p);return JSON.stringify([this.selection(p),p.globalAdapter,p.globalAdapter===null?[p.profilePath,p.modelOverrides]:null,key?p.modelWatermarks?.[key]??null:null])}
 invalidate(){this.cache=null;this.seenToken=this.overlay.runtime.modelToken??null;this.loadedSource=null;this.proofAt=0}
 cancelSelection(){this.candidates=null}
 async assertProof(proof){
  if(!Array.isArray(proof)||proof.length>257)throw preferenceError('unsupported','Renderer does not provide bounded model resource stamps.')
  for(const p of proof){
   if(!plain(p)||typeof p.path!=='string'||typeof p.mtime!=='string'||!/^\d{1,19}$/.test(p.mtime)||!Number.isSafeInteger(p.size)||p.size<0)throw preferenceError('unsupported','Invalid model resource stamp.')
   validatePreferencePatch({modelPath:p.path})
   let s;try{s=await this.manager.io.stat(p.path,{bigint:true})}catch{throw preferenceError('stale_model_resources','Model resources disappeared; import or reload the model again.')}
   const ticks=s.mtimeNs!==undefined?s.mtimeNs/100n+621355968000000000n:BigInt(Math.round(Number(s.mtimeMs)*10000))+621355968000000000n
   if(Number(s.size)!==p.size||ticks!==BigInt(p.mtime))throw preferenceError('stale_model_resources','Model resources changed; read or reload them again.')
  }
 }
 async checkProof(){
  if(!this.cache||!this.cache.sourceProof?.length||Date.now()-this.proofAt<1000)return
  if(this.proofTask)return this.proofTask
  const cache=this.cache;this.proofAt=Date.now()
  this.proofTask=this.assertProof(cache.sourceProof).catch(error=>{if(this.cache===cache){this.invalidate();this.reloadRequired=true;this.manager.motions.invalidate();this.manager.motions.active?.controller.abort(error);this.manager.lastError=error.message}}).finally(()=>{this.proofTask=null})
  return this.proofTask
 }
 validate(reply){
  const a=reply.adapter,key=reply.modelKey
  if(!plain(a)||typeof reply.modelToken!=='string'||typeof reply.signature!=='string'||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||!Array.isArray(a.parameters)||a.parameters.length>512||!Array.isArray(a.inputs)||a.inputs.length>7||!Array.isArray(a.effects)||a.effects.length>8||!Array.isArray(a.handStyles)||a.handStyles.length>3)throw preferenceError('unsupported','Renderer does not provide a validated parameter catalog.')
  const parameters=a.parameters.map(p=>({id:p.id,name:String(p.name??p.id).slice(0,64),min:p.min,max:p.max,default:p.default}))
  if(parameters.some(p=>typeof p.id!=='string'||p.id.length>128||![p.min,p.max,p.default].every(Number.isFinite)||p.min>p.default||p.default>p.max)||new Set(parameters.map(p=>p.id)).size!==parameters.length)throw preferenceError('unsupported','Invalid Core parameter catalog.')
  if(a.handStyles.some(s=>!['default','labels','no-labels'].includes(s.id)))throw preferenceError('unsupported','Invalid hand style catalog.')
  return {...a,parameters}
 }
 accept(reply){
  const a=this.validate(reply),parameters=a.parameters,key=reply.modelKey
  const selection=this.selection(),sourceProof=reply.sourceProof??[],stable=JSON.stringify([parameters,a.inputs,a.effects,a.handStyles,a.handStyle,a.warnings,a.poseSupported,a.watermark])
  const source=this.source()
  const previous=this.cache?.source===source&&this.cache?.modelKey===key?this.cache:null
  const same=this.cache&&this.cache.source===source&&this.cache.signature===reply.signature&&this.cache.stable===stable
  this.cache={generation:same?this.cache.generation:randomUUID(),selection,source,modelKey:key,signature:reply.signature,stable,sourceProof,parameters,inputs:structuredClone(a.inputs),effects:structuredClone(a.effects),handStyles:structuredClone(a.handStyles),handStyle:a.handStyle??'default',watermark:a.watermark?validateWatermarkCatalog(a.watermark):null,warnings:[...(a.warnings??[])].slice(0,132),handGroups:a.handGroups??0,handCache:a.handCache??null,poseSupported:a.poseSupported===true,globalAdapter:structuredClone(reply.globalAdapter??this.manager.store.value.globalAdapter??previous?.globalAdapter??{}),fallbacks:structuredClone(reply.fallbacks??previous?.fallbacks??[])}
  this.loadedSource=source;this.seenToken=reply.modelToken;this.reloadRequired=false;this.manager.lastError=null;return this.cache
 }
 snapshot(){
  const o=this.overlay
  if(this.cache&&this.cache.source!==this.source()){this.invalidate();this.reloadRequired=true}
  if(o.ready&&o.runtime.modelLoaded&&o.capabilities.adaptation&&o.runtime.modelToken!==this.seenToken&&o.runtime.adapterCatalog&&o.runtime.modelKey)this.accept({modelToken:o.runtime.modelToken,signature:o.runtime.motionSignature,modelKey:o.runtime.modelKey,adapter:o.runtime.adapterCatalog,sourceProof:o.runtime.sourceProof})
  if(this.cache&&o.runtime.modelToken===this.seenToken&&o.runtime.adapterCatalog?.handCache)this.cache.handCache=structuredClone(o.runtime.adapterCatalog.handCache)
  const adapter=this.cache?Object.fromEntries(Object.entries(this.cache).filter(([key])=>!['selection','source','signature','stable','sourceProof'].includes(key))):null
  return {adapterCatalog:adapter,modelCatalog:this.candidates?{generation:this.candidates.generation,items:this.candidates.items.map(({id,name,entry,error})=>({id,name,entry,enabled:!error,error}))}:null}
 }
 async discover(selection,signal){
  validatePreferencePatch({modelPath:selection});const reply=await this.manager.utility(['--discover-model',selection],AbortSignal.any([signal,AbortSignal.timeout(10000)]))
  if(!Array.isArray(reply.candidates)||reply.candidates.length>64)throw preferenceError('unsupported','The native file picker does not support ZIP/model discovery.')
  const items=reply.candidates.map((c,i)=>{
   if(!plain(c)||typeof c.sourcePath!=='string'||typeof c.entry!=='string'||typeof c.name!=='string'||c.name.length>128||c.entry.length>4096||typeof c.fingerprint!=='string'||typeof c.modelKey!=='string')throw preferenceError('unsupported','Invalid model candidate reply.')
   validatePreferencePatch({modelPath:c.sourcePath});if(c.entry)validatePreferencePatch({modelEntry:c.entry})
   return {...c,id:'model-'+i,name:c.name.slice(0,128)}
  })
  if(!items.some(x=>!x.error))throw preferenceError('model_discovery_failed',items[0]?.error??'No valid standard Live2D model was found.')
  this.candidates={generation:randomUUID(),items};return this.candidates
 }
 async select(action,signal){
  const m=this.manager;m.requireEnabled();if(m.busy||m.load||m.manualPreview||m.motions.active)throw preferenceError('busy','Another display operation is active.')
  const catalog=this.candidates;if(!catalog||action.catalogGeneration!==catalog.generation)throw preferenceError('stale_model_catalog','The model candidates changed; import again.')
  const candidate=catalog.items.find(x=>x.id===action.modelId)
  if(!candidate||candidate.error)throw preferenceError('invalid_model_selection','Select an available model from the current catalog.')
  const controller=new AbortController(),combined=AbortSignal.any([signal??m.signal(),controller.signal]);m.busy='selectingModel';m.load=controller
  try{
   const check=await m.utility(['--discover-model',candidate.sourcePath],AbortSignal.any([combined,AbortSignal.timeout(10000)]));combined.throwIfAborted()
   const current=check.candidates?.find(x=>canonical(x.sourcePath)===canonical(candidate.sourcePath)&&x.entry.toLowerCase()===candidate.entry.toLowerCase())
   if(this.candidates!==catalog||!current||current.error||current.fingerprint!==candidate.fingerprint){this.candidates=null;throw preferenceError('stale_model_catalog','Selected model resources changed; import again.')}
   m.busy=null;m.load=null
   await m.applyPreferences({modelPath:candidate.sourcePath,modelEntry:candidate.entry,profilePath:null},action.revision,combined)
   if(this.candidates===catalog)this.candidates=null
  }finally{if(m.load===controller)m.load=null;if(m.busy==='selectingModel')m.busy=null}
 }
  watermarkPatch(change){
   const value=validateWatermarkChange(change),c=this.cache;if(!c||c.generation!==value.catalogGeneration)throw preferenceError('stale_adapter_catalog','Read current model parameters again.');
   if(!c.watermark?.supported)throw preferenceError('unsupported','This model has no authorized validated watermark switch.');
   const records={...(this.manager.store.value.modelWatermarks??{})};if(value.mode==='hidden')records[c.modelKey]={mode:'hidden',mocHash:c.watermark.mocHash};else delete records[c.modelKey];return {modelWatermarks:validateWatermarkRecords(records)};
  }
 adapterPatch(change){
  const cache=this.cache;if(!cache||change.catalogGeneration!==cache.generation)throw preferenceError('stale_adapter_catalog','Read the current model parameters first.')
  // Newly selected IDs must belong to the editing catalog, even though existing globals may fall back.
  const explicit={...change}
  for(const kind of ['bindings','effects'])if(change[kind])explicit[kind]=Object.fromEntries(Object.entries(change[kind]).filter(([,b])=>b===null||(kind==='bindings'?b.id:b.ids)))
  validateAdapterAgainstCatalog(explicit,cache)
  const ownerIds=cache.inputs.map(input=>Object.prototype.hasOwnProperty.call(change.bindings??{},input.role)?change.bindings[input.role]?.id:input.enabled?input.id:null).filter(Boolean),owners=new Set(ownerIds)
  if(owners.size!==ownerIds.length)throw preferenceError('invalid_adapter','Multiple input roles cannot own the same parameter.')
  for(const binding of Object.values(change.effects??{}))if(binding?.ids?.some(id=>owners.has(id)))throw preferenceError('invalid_adapter','Decoration cannot own an input-bound parameter.')
  const record=mergeGlobalAdapter(this.manager.store.value.globalAdapter??cache.globalAdapter,change)
  return {globalAdapter:record,profilePath:null}
 }
 async ready(signal,{needAdapter=true}={}){
  const m=this.manager,o=this.overlay;await m.ensureModelManagement(signal)
  if(needAdapter&&!o.capabilities.adaptation)throw preferenceError('unsupported','Parameter adaptation requires the 0.2.5 Live2D renderer; this fallback/old renderer cannot provide it.')
  if(o.runtime.sourceProof?.length)try{await this.assertProof(o.runtime.sourceProof)}catch{this.reloadRequired=true}
  const p=m.store.value,chosen=canonical(p.modelPath??o.defaultModel),actual=canonical(o.runtime.modelSourcePath??o.runtime.modelPath)
  const pathMatches=actual?(actual===chosen||!chosen.endsWith('.zip')&&!chosen.endsWith('.model3.json')&&actual.startsWith(chosen+'/')):!this.loadedSource||this.loadedSource===this.source()
  const entryMatches=!p.modelEntry||p.modelEntry===o.runtime.modelEntry,profileMatches=o.runtime.modelProfilePath===undefined||(o.runtime.modelProfilePath??null)===(p.profilePath??null)
  if(this.reloadRequired||!o.runtime.modelLoaded||!pathMatches||!entryMatches||!profileMatches||!this.loadedSource||this.loadedSource!==this.source()){
   if(chosen.endsWith('.zip')&&!o.capabilities.archives)throw preferenceError('unsupported','ZIP models require the updated renderer.')
   try{const prepared=await m.stageModel(structuredClone(p),signal);await o.command({kind:'commit-model'},{signal});if(o.capabilities.adaptation)this.accept(prepared);else this.loadedSource=this.source();m.motions.invalidate();this.reloadRequired=false}catch(error){await o.command({kind:'cancel-load'}).catch(()=>{});throw error}
  }
 }
 async refresh(signal){
  const m=this.manager,o=this.overlay;m.requireEnabled();const running=o.ready&&!o.dead,activity=o.activity
  m.busy='readingAdapter';m.load=new AbortController();const controller=m.load,combined=AbortSignal.any([signal??m.signal(),controller.signal]);o.deferModelStartup++;const release=o.runtime.modelLoaded?()=>{}:o.holdVisibility()
  try{
   if(this.cache)await this.assertProof(this.cache.sourceProof).catch(()=>{this.invalidate();this.reloadRequired=true})
   await this.ready(combined);const reply=await o.command({kind:'get-adapter'},{signal:combined});combined.throwIfAborted();await this.assertProof(reply.sourceProof??[]);this.accept(reply)
  }finally{if(combined.aborted)await o.command({kind:'cancel-load'}).catch(()=>{});if(m.load===controller)m.load=null;if(m.busy==='readingAdapter')m.busy=null;try{await m.retireTemporary(running,activity)}finally{o.deferModelStartup--;release()}}
 }
}
