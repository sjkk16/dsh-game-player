import * as fs from 'node:fs/promises'
import {existsSync} from 'node:fs'
import { dirname, join, resolve, normalize, isAbsolute, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { preferenceError } from './overlay-preferences.js'
const digest = value => createHash('sha256').update(value).digest('hex')
const canonical = value => typeof value === 'string' ? normalize(value).replaceAll('\\','/').toLowerCase() : null
const hashId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const safeEntry = value => typeof value === 'string' && value.length <= 4096 && value.toLowerCase().endsWith('.model3.json') && !/^[\\/]|[:%?#\0]/.test(value) && !value.replaceAll('\\','/').split('/').some(p=>p==='..'||p==='')
const aborted = signal => signal?.throwIfAborted()
const error = (code,message) => preferenceError(code,message)
const same = (a,b) => canonical(a)===canonical(b)
const LIMIT = 32, MAX_BYTES = 512*1024*1024
/** An owner-only, managed library. Index writes never change display preferences. */
export class ModelLibrary {
  constructor(manager) {
    this.manager=manager;this.io=manager.io;this.path=join(dirname(manager.store.path),'library.json');this.root=join(dirname(manager.store.path),'models')
    this.index={version:1,revision:0,items:[]};this.failure=null;this.catalog=null;this.selecting=false;this.previousActive=null;this.ready=this.refresh()
  }
  validate(raw) {
    if(!raw||raw.version!==1||!Number.isSafeInteger(raw.revision)||raw.revision<0||!Array.isArray(raw.items)||raw.items.length>LIMIT-1)throw error('invalid_library','The model library index is invalid; restore its backup before adding models.')
    const ids=new Set()
    for(const item of raw.items){
      if(!item||Object.keys(item).some(k=>!['id','bundleId','entry','name','kind','modelKey'].includes(k))||!hashId(item.id)||!hashId(item.bundleId)||!hashId(item.modelKey)||!safeEntry(item.entry)||!['zip','directory'].includes(item.kind)||typeof item.name!=='string'||!item.name.trim()||item.name.length>128||item.id!==digest(item.bundleId+'\0'+item.entry.toLowerCase())||ids.has(item.id))throw error('invalid_library','Unsafe or duplicate model library entry.')
      ids.add(item.id)
    }
    return raw
  }
  async read() {
    try { const stat=await this.io.lstat(this.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024||!same(await this.io.realpath(this.path),join(await this.io.realpath(dirname(this.path)),'library.json')))throw error('invalid_library','Invalid model library index file.');return this.validate(JSON.parse((await this.io.readFile(this.path,'utf8')).replace(/^\uFEFF/,''))) }
    catch(e){if(e.code==='ENOENT')return {version:1,revision:0,items:[]};throw e}
  }
  async refresh() {
    try {this.index=await this.read();this.failure=null;const parent=await this.io.realpath(dirname(this.path)).catch(e=>{if(e.code==='ENOENT')return dirname(this.path);throw e});this.root=join(parent,'models');if(existsSync(this.root)&&!same(await this.io.realpath(this.root),this.root))throw error('unsafe_library_path','The model library directory must not be a link.')}
    catch(e){this.failure=e.message}
  }
  source(item){return join(this.root,item.bundleId,item.kind==='zip'?'source.zip':'content')}
  /**
   * The built-in pet is a fixed directory, never a library entry, so it has no
   * removable record. Offer it only while its manifest is on disk: an emptied
   * or half-copied directory must not surface as a selectable model that can
   * never load, and must not be reported as the active one either.
   */
  defaultAvailable(){return existsSync(join(this.manager.overlay.defaultModel,'img','standard','cat_model','deepseek.model3.json'))}
  active() {
    const p=this.manager.store.value,o=this.manager.overlay
    if(!p.modelPath||same(p.modelPath,o.defaultModel))return this.defaultAvailable()?'builtin-default':null
    return this.index.items.find(item=>same(this.source(item),p.modelPath)&&item.entry.toLowerCase()===(p.modelEntry??'').toLowerCase())?.id??null
  }
  snapshot() {
    const active=this.selecting?this.previousActive:this.active(),o=this.manager.overlay
    const items=[...(this.defaultAvailable()?[{id:'builtin-default',name:'Deepseek · 默认桌宠',builtin:true,available:true}]:[]),...this.index.items.map(item=>({id:item.id,name:item.name,builtin:false,entry:item.entry,available:existsSync(this.source(item))}))]
    return {modelLibrary:{revision:this.index.revision,items},activeModelId:active,libraryError:this.failure,libraryCatalog:this.catalog?{generation:this.catalog.generation,items:this.catalog.items.map(({id,name,entry,error})=>({id,name,entry,enabled:!error,error}))}:null}
  }
  requireAlive(){if(this.manager.lifetime.signal.aborted||this.manager.overlay.closed)throw error('unavailable','Plugin has been unloaded.');if(this.failure)throw error('invalid_library',this.failure)}
  async ensureRoot(){await this.io.mkdir(dirname(this.path),{recursive:true});this.root=join(await this.io.realpath(dirname(this.path)),'models');await this.io.mkdir(this.root,{recursive:true});if(!same(await this.io.realpath(this.root),this.root)||(await this.io.lstat(this.root)).isSymbolicLink())throw error('unsafe_library_path','The model library directory must not be a link.')}
  async checkedTree(path) {
    const absolute=resolve(path),boundary=resolve(this.root)+sep,name=absolute.substring(boundary.length)
    if(!absolute.startsWith(boundary)||!(/^([a-f0-9]{64}|\.staging-[a-f0-9]{32})$/.test(name)))throw error('unsafe_library_path','Refusing removal outside the managed package boundary.')
    const pending=[absolute];let count=0
    while(pending.length){const p=pending.pop(),s=await this.io.lstat(p);if(s.isSymbolicLink()||!same(await this.io.realpath(p),p))throw error('unsafe_library_path','Linked library resources cannot be removed.');if(++count>4096)throw error('unsafe_library_path','Unexpected library tree size.');if(s.isDirectory())for(const n of await this.io.readdir(p))pending.push(join(p,n))}
    return absolute
  }
  async removeTree(path){try{const approved=await this.checkedTree(path);await this.io.rm(approved,{recursive:true,force:true,maxRetries:3,retryDelay:100})}catch(e){if(e.code!=='ENOENT')throw e}}
  async lockIndex(signal){
    await this.ensureRoot();const path=this.path+'.lock',header=JSON.stringify({version:1,pid:process.pid,token:randomUUID()});let handle
    for(let n=0;n<20;n++){
      aborted(signal)
      try{handle=await this.io.open(path,'wx');try{await handle.writeFile(header)}catch(e){await handle.close();await this.io.unlink(path);throw e}break}
      catch(e){
        if(e.code!=='EEXIST')throw e
        try{
          const stat=await this.io.lstat(path),text=stat.size<=4096?await this.io.readFile(path,'utf8'):null
          if(!stat.isSymbolicLink()&&same(await this.io.realpath(path),join(dirname(this.root),'library.json.lock'))&&text){
            const owner=JSON.parse(text);if(owner.version===1&&Number.isSafeInteger(owner.pid)&&owner.pid>0&&owner.pid<=2147483647&&typeof owner.token==='string'&&/^[a-f0-9-]{36}$/.test(owner.token)){
              let dead=false;try{process.kill(owner.pid,0)}catch(cause){dead=cause.code==='ESRCH'}
              if(dead&&await this.io.readFile(path,'utf8')===text){await this.io.unlink(path);continue}
            }
          }
        }catch(stale){if(stale.code!=='ENOENT'&&!(stale instanceof SyntaxError))throw stale}
        await new Promise(r=>setTimeout(r,50))
      }
    }
    if(!handle)throw error('library_conflict','Another Host is changing the model library; retry shortly.')
    return async()=>{try{await handle.close()}finally{const current=await this.io.readFile(path,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e});if(current===header)await this.io.unlink(path)}}
  }
  async write(items,expectedRevision,{signal,heldLock=false}={}) {
    const unlock=heldLock?null:await this.lockIndex(signal),temporary=this.path+'.'+randomUUID()+'.tmp'
    try {aborted(signal);const disk=await this.read();if(disk.revision!==expectedRevision){this.index=disk;throw error('library_conflict','The library changed; refresh and retry.')}const next=this.validate({version:1,revision:expectedRevision+1,items});await this.io.writeFile(temporary,JSON.stringify(next,null,2),{flag:'wx'});aborted(signal);await this.io.rename(temporary,this.path);this.index=next;this.failure=null}
    finally {try{await this.io.unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e})}finally{await unlock?.()}}
  }
  checkEpoch(epoch){if(epoch!==(this.manager.cancelGeneration??0))throw error('canceled','Operation canceled.')}
  async beginAdd(action,signal) {
    const epoch=this.manager.cancelGeneration??0
    await this.ready;await this.refresh();this.checkEpoch(epoch);this.requireAlive();const m=this.manager
    if(m.busy||m.load)throw error('busy','Another desktop operation is active.')
    if(!m.utilitySupportsLibrary)throw error('unsupported','Install the 0.3.0 desktop runtime to add managed models.')
    const controller=new AbortController(),combined=AbortSignal.any([m.signal(signal),controller.signal]);m.busy='picking';m.load=controller
    try {const selected=await m.utility(['--pick',action==='addLibraryFolder'?'model-folder':'model-file'],combined);if(!selected.path)return;m.busy='discovering';const catalog=await m.models.discover(selected.path,combined);aborted(combined);this.catalog={generation:catalog.generation,items:catalog.items};m.models.cancelSelection()}
    finally{if(m.load===controller)m.load=null;if(['picking','discovering'].includes(m.busy))m.busy=null}
  }
  cancel(){this.catalog=null}
  async packageHash(directory,isZip){
    const hash=createHash('sha256');hash.update(isZip?'zip\0':'directory\0');const root=isZip?directory:join(directory,'content'),names=[]
    if(isZip)names.push('source.zip');else{const queue=[root];while(queue.length){const parent=queue.pop();for(const n of await this.io.readdir(parent)){const p=join(parent,n),s=await this.io.lstat(p);if(s.isSymbolicLink()||!same(await this.io.realpath(p),p))throw error('unsafe_library_path','Linked library resource.');if(s.isDirectory())queue.push(p);else names.push(p.substring(root.length+1).replaceAll('\\','/'));if(names.length+queue.length>2048)throw error('invalid_library_source','Too many package resources.')}}}
    let size=0;for(const name of names.sort()){const bytes=await this.io.readFile(join(root,name));size+=bytes.length;if(size>MAX_BYTES)throw error('invalid_library_source','Managed package exceeds the resource budget.');hash.update(name+'\0'+digest(bytes)+'\0')}return hash.digest('hex')
  }
  async stage(candidate,signal) {
    const m=this.manager,descriptor=await m.utility(['--describe-model-source',candidate.sourcePath],AbortSignal.any([signal,AbortSignal.timeout(10000)]));aborted(signal)
    if(!descriptor||typeof descriptor.zip!=='boolean'||!Array.isArray(descriptor.files)||descriptor.files.length>2048||typeof descriptor.root!=='string'||!isAbsolute(candidate.sourcePath)||!descriptor.zip&&!isAbsolute(descriptor.root))throw error('invalid_library_source','Invalid source manifest.')
    await this.ensureRoot();const staging=join(this.root,'.staging-'+randomUUID().replaceAll('-',''));await this.io.mkdir(staging)
    let total=0,published,createdPackage=false
    const hasher=createHash('sha256');hasher.update(descriptor.zip?'zip\0':'directory\0')
    try {
      const names=descriptor.zip?['source.zip']:[...descriptor.files].sort()
      if(!names.length)throw error('invalid_library_source','The model package is empty.')
      for(const name of names){
        aborted(signal)
        if(typeof name!=='string'||name.length>4096||/^[\\/]|[:\0]/.test(name)||name.replaceAll('\\','/').split('/').some(p=>!p||p==='..'||p==='.')||!descriptor.zip&&name.endsWith('/'))throw error('invalid_library_source','Invalid relative model resource.')
        const from=descriptor.zip?candidate.sourcePath:join(descriptor.root,name),before=await this.io.stat(from,{bigint:true})
        if(!before.isFile()||before.size>BigInt(descriptor.zip?256*1024*1024:MAX_BYTES)||!same(await this.io.realpath(from),from)||(await this.io.lstat(from)).isSymbolicLink())throw error('invalid_library_source','Linked or oversized source resources are not supported.')
        total+=Number(before.size);if(total>MAX_BYTES)throw error('invalid_library_source','Model package exceeds 512 MiB.')
        const bytes=await this.io.readFile(from),after=await this.io.stat(from,{bigint:true});aborted(signal)
        if(BigInt(bytes.length)!==before.size||after.size!==before.size||after.mtimeNs!==before.mtimeNs)throw error('stale_model_resources','Model resources changed while copying; add again.')
        hasher.update(name.replaceAll('\\','/')+'\0'+digest(bytes)+'\0')
        const target=descriptor.zip?join(staging,'source.zip'):join(staging,'content',name);await this.io.mkdir(dirname(target),{recursive:true});await this.io.writeFile(target,bytes,{flag:'wx'})
      }
      const bundleId=hasher.digest('hex'),destination=join(this.root,bundleId);let created=false
      try{await this.io.lstat(destination)}catch(e){if(e.code!=='ENOENT')throw e;await this.io.rename(staging,destination);created=true;published=destination;createdPackage=true}
      if(!created){await this.checkedTree(destination);if(await this.packageHash(destination,descriptor.zip)!==bundleId)throw error('stale_model_resources','Managed package content changed; repair or remove the existing entry before re-adding.');await this.removeTree(staging)}
      const kind=descriptor.zip?'zip':'directory',source=join(destination,kind==='zip'?'source.zip':'content')
      const validated=await m.utility(['--discover-model',source],AbortSignal.any([signal,AbortSignal.timeout(10000)]));aborted(signal)
      const model=validated.candidates?.find(item=>item.entry.toLowerCase()===candidate.entry.toLowerCase())
      if(!model||model.error||!hashId(model.modelKey))throw error('model_discovery_failed',model?.error??'Copied model did not pass validation.')
      return {record:{id:digest(bundleId+'\0'+model.entry.toLowerCase()),bundleId,entry:model.entry,name:candidate.name.slice(0,128),kind,modelKey:model.modelKey},created,destination}
    } catch(e){await this.removeTree(staging).catch(()=>{});if(createdPackage){const disk=await this.read().catch(()=>null);if(disk&&!disk.items.some(i=>join(this.root,i.bundleId)===published))await this.removeTree(published).catch(()=>{})}throw e}
  }
  async add(action,signal) {
    const epoch=this.manager.cancelGeneration??0
    await this.ready;await this.refresh();this.checkEpoch(epoch);this.requireAlive();const m=this.manager,catalog=this.catalog
    if(m.busy||m.load)throw error('busy','Another desktop operation is active.')
    if(!catalog||action.catalogGeneration!==catalog.generation)throw error('stale_model_catalog','The model candidates changed; add again.')
    if(action.libraryRevision!==this.index.revision)throw error('library_conflict','The model library changed; refresh and retry.')
    const candidates=action.modelIds.map(id=>catalog.items.find(item=>item.id===id));if(candidates.some(c=>!c||c.error))throw error('invalid_model_selection','Choose valid model candidates.')
    const controller=new AbortController(),combined=AbortSignal.any([m.signal(signal),controller.signal]);m.busy='copyingModels';m.load=controller;const staged=[];let unlock
    try {
      unlock=await this.lockIndex(combined);this.checkEpoch(epoch);const disk=await this.read();if(disk.revision!==action.libraryRevision)throw error('library_conflict','The model library changed; refresh and retry.');this.index=disk
      for(const candidate of candidates){const fresh=await m.utility(['--discover-model',candidate.sourcePath],AbortSignal.any([combined,AbortSignal.timeout(10000)]));aborted(combined);const current=fresh.candidates?.find(c=>same(c.sourcePath,candidate.sourcePath)&&c.entry.toLowerCase()===candidate.entry.toLowerCase());if(!current||current.error||current.fingerprint!==candidate.fingerprint)throw error('stale_model_catalog','The source model changed; add again.');staged.push(await this.stage(candidate,combined))}
      aborted(combined);if(this.catalog!==catalog)throw error('stale_model_catalog','Model addition was canceled.')
      const items=[...this.index.items];for(const {record} of staged)if(!items.some(item=>item.id===record.id))items.push(record)
      if(items.length>LIMIT-1)throw error('library_full','The model library supports 32 entries including the default model.')
      if(items.length!==this.index.items.length)await this.write(items,action.libraryRevision,{signal:combined,heldLock:true})
      this.catalog=null;return staged.map(s=>s.record)
    }catch(e){const disk=await this.read().catch(()=>null);if(disk)for(const s of staged)if(s.created&&!disk.items.some(i=>i.bundleId===s.record.bundleId))await this.removeTree(s.destination).catch(()=>{});throw e}
    finally{try{await unlock?.()}finally{if(m.load===controller)m.load=null;if(m.busy==='copyingModels')m.busy=null}}
  }
  async select(action,signal,{preferences={},heldLock=false,allowBusy=false}={}) {
    const epoch=this.manager.cancelGeneration??0
    await this.ready;await this.refresh();this.checkEpoch(epoch);this.requireAlive();const m=this.manager;m.requireEnabled()
    if((m.busy&&!allowBusy)||m.load||m.manualPreview||m.motions.active)throw error('busy','Another model or preview operation is active.')
    let unlock;m.busy='selectingLibrary';this.previousActive=this.active();this.selecting=true
    try {
      unlock=heldLock?null:await this.lockIndex(m.signal(signal));this.checkEpoch(epoch);this.index=await this.read()
      if(action.libraryRevision!==this.index.revision)throw error('library_conflict','The model library changed; refresh and retry.')
      const item=action.modelId==='builtin-default'?null:this.index.items.find(i=>i.id===action.modelId)
      if(!item&&action.modelId!=='builtin-default')throw error('invalid_model_selection','This model is no longer in the library.')
      this.checkEpoch(epoch);m.busy=null
      await m.applyPreferences({modelPath:item?this.source(item):null,modelEntry:item?.entry??null,profilePath:null,view:'model',...preferences},action.revision,m.signal(signal),{showAfterCommit:true});m.lastError=null
    }finally{this.selecting=false;try{await unlock?.()}finally{if(m.busy==='selectingLibrary')m.busy=null}}
  }
  async remove(action,signal) {
    const epoch=this.manager.cancelGeneration??0
    await this.ready;await this.refresh();this.checkEpoch(epoch);this.requireAlive();const m=this.manager
    if(m.busy||m.load||m.manualPreview||m.motions.active)throw error('busy','Another desktop operation is active.')
    let unlock;m.busy='removingModel'
    try {
      unlock=await this.lockIndex(m.signal(signal));this.checkEpoch(epoch);this.index=await this.read();await m.store.refresh()
      if(action.libraryRevision!==this.index.revision)throw error('library_conflict','The model library changed; refresh and retry.')
      if(action.revision!==m.store.revision)throw error('preference_conflict','Display preferences changed; refresh and retry.')
      const item=this.index.items.find(i=>i.id===action.modelId);if(!item)throw error('invalid_model_selection','The default or missing model cannot be removed.')
      if(this.active()===item.id)await this.select({...action,modelId:'builtin-default'},signal,{heldLock:true,allowBusy:true})
      m.busy='removingModel';this.checkEpoch(epoch);aborted(signal)
      await this.write(this.index.items.filter(i=>i.id!==item.id),action.libraryRevision,{signal,heldLock:true})
      if(!this.index.items.some(i=>i.bundleId===item.bundleId)&&!same(m.overlay.runtime.modelSourcePath,this.source(item)))await this.removeTree(join(this.root,item.bundleId))
    }finally{try{await unlock?.()}finally{if(m.busy==='removingModel')m.busy=null}}
  }
  async restore(signal) {
    const epoch=this.manager.cancelGeneration??0
    await this.ready;await this.refresh();this.checkEpoch(epoch);this.requireAlive();const m=this.manager,o=m.overlay;await m.store.ready
    if(!o.enabled||o.closed||signal?.aborted)return
    let id=this.active()
    if(!id&&m.store.value.modelPath){
      const p=m.store.value,oldPath=p.modelPath,oldEntry=p.modelEntry,reply=await m.utility(['--discover-model',oldPath],AbortSignal.any([m.signal(signal),AbortSignal.timeout(10000)]));const candidate=reply.candidates?.find(c=>!c.error&&(!oldEntry||c.entry.toLowerCase()===oldEntry.toLowerCase()))
      this.checkEpoch(epoch);if(!candidate)throw error('model_discovery_failed','The previously selected model is unavailable; select a model from the library.')
      const generation=randomUUID();this.catalog={generation,items:[{...candidate,id:'model-0'}]};const [entry]=await this.add({catalogGeneration:generation,modelIds:['model-0'],libraryRevision:this.index.revision},m.signal(signal))
      // Adapter migration is performed by the Host transaction against the original model.
      // Keep legacy records dormant; do not clone model-specific adapters or profile files.
      id=entry.id
    }
    // Nothing to restore: no library model is active and the built-in pet is
    // gone. Selecting it anyway would only ask the display to load a manifest
    // that is not on disk.
    if(!id&&!this.defaultAvailable())return
    this.checkEpoch(epoch);await this.select({modelId:id??'builtin-default',libraryRevision:this.index.revision,revision:m.store.revision},m.signal(signal))
  }
}
