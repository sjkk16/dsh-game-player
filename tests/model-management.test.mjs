import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import {join,resolve,sep,basename} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {OverlayPreferences,migratePreferences,validatePreferenceRequest,validatePreferencePatch} from '../src/overlay-preferences.js'
import {OverlayManagement} from '../src/overlay-management.js'
import {OVERLAY_CONTRIBUTION} from '../src/overlay-remote.js'
import {resolveAdapter} from '../src/live2d/model-adapter.js'
let clientDefinition
const previousWindow=globalThis.window
globalThis.window={__ModuleLoader__:{load:value=>clientDefinition=value}}
await import('../client.js')
globalThis.window=previousWindow
const {OverlayUIController}=clientDefinition.factory(()=>({createElement(){}}))
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),tick=()=>new Promise(r=>setImmediate(r))
const defs={CatParamLeftHandDown:{min:0,max:1,default:0},ParamMouseX:{min:-30,max:30,default:0},ParamMouseY:{min:-30,max:30,default:0},ParamMouseLeftDown:{min:0,max:1,default:0},ParamMouseRightDown:{min:0,max:1,default:0},ParamAngleX:{min:-30,max:30,default:0},ParamBreath:{min:0,max:1,default:0}}
const key=p=>createHash('sha256').update(resolve(p).toLowerCase()).digest('hex')
async function fixture(run,options={}){
 const base=resolve('.qa'),dir=join(base,'model-management-'+randomUUID());await fs.mkdir(dir,{recursive:true});const first=join(dir,'first.model3.json'),second=join(dir,'second.model3.json'),native=join(dir,'mock-native.exe');await Promise.all([fs.writeFile(first,'{}'),fs.writeFile(second,'{}'),fs.writeFile(native,'')])
 const h={records:[],starts:0,stops:0,failWrite:false,failLoad:false,loadDelay:0,discoveryDelay:0,first,second,dir,current:null,staged:null}
 const io={...fs,writeFile:async(p,...args)=>{if(h.failWrite&&String(p).endsWith('.tmp'))throw Object.assign(Error('Disk denied'),{code:'EACCES'});return fs.writeFile(p,...args)}}
 const store=new OverlayPreferences(join(dir,'overlay.json'),{io});await store.ready
 const proof=async p=>{const s=await fs.stat(p,{bigint:true});return [{path:p,size:Number(s.size),mtime:String(s.mtimeNs/100n+621355968000000000n)}]}
 const wait=async(ms,signal)=>{if(!ms)return;await new Promise((r,j)=>{const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);r()},ms),abort=()=>{clearTimeout(timer);j(signal.reason)};if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true})})}
 const caps={management:true,model:true,picker:true,motions:true,archives:!options.old,adaptation:!options.old,handStyles:!options.old}
 const o={preferences:store,desktop:native,defaultModel:first,enabled:true,useDesktop:true,ready:false,dead:true,closed:false,stopped:false,child:null,activity:0,activated:false,deferModelStartup:0,visibilityHolds:0,captureCount:0,capabilities:caps,realState:{keys:new Set(),buttons:new Set(),session:null,status:'ready'},previewState:{reset(){}},state:{},runtime:{phase:'not-started',visible:false,modelLoaded:false},
  holdVisibility(){this.visibilityHolds++;return()=>this.visibilityHolds--},changed(){this.runtime.visible=this.ready&&this.activated&&!this.runtime.userHidden&&this.visibilityHolds===0},async syncPreferences(){this.preferencesSentRevision=store.revision},
  async start({deferModel=false}={}){if(this.ready)return;h.starts++;this.ready=true;this.dead=false;this.child={};this.runtime={...this.runtime,phase:'ready',modelLoaded:!deferModel,userHidden:false};if(!deferModel&&!h.current)h.current=await make(first,null,{},null);publish()},
  async stopDisplay(){if(this.ready)h.stops++;this.ready=false;this.dead=true;this.child=null;this.runtime={...this.runtime,visible:false,phase:'stopped'};h.staged=null},
  async command(data,{signal}={}){
   signal?.throwIfAborted();h.records.push(data)
   if(data.kind==='load-model'){await wait(h.loadDelay,signal);signal?.throwIfAborted();if(h.failLoad)throw Error('Broken model');h.staged=await make(data.modelPath,data.modelEntry,data.overrides??{},data.profilePath,data.profileOverride,data.adapter);return reply(h.staged)}
   if(data.kind==='commit-model'){if(!h.staged)throw Error('No staged model');h.current=h.staged;h.staged=null;this.runtime.modelLoaded=true;publish();return {ok:true}}
   if(data.kind==='cancel-load'||data.kind==='cancel'){h.staged=null;return {ok:true}}
   if(data.kind==='get-adapter'){if(options.old)throw Error('Unsupported old renderer');return reply(h.current)}
   if(data.kind==='get-motions')return{ok:true,modelToken:h.current?.token,signature:'motions',motions:[]}
   if(data.kind==='control'){if(data.action==='show')this.runtime.userHidden=false;if(data.action==='hide')this.runtime.userHidden=true;this.changed();return{ok:true}}
   if(data.kind==='preferences'){publish();return{ok:true}}
   return {ok:true}
  },
 }
 function publish(){if(h.current)o.runtime={...o.runtime,phase:'ready',renderer:'live2d',modelSourcePath:h.current.path,modelPath:h.current.path,modelEntry:h.current.entry,modelKey:h.current.key,modelToken:h.current.token,modelProfilePath:h.current.profilePath,adapterCatalog:h.current.adapter,motionSignature:h.current.signature,sourceProof:h.current.proof};o.changed()}
 async function make(path,entry,overrides,profilePath,profileOverride=false,localAdapter){const id=key(path),record=localAdapter??overrides[id]??{};const selectedProfile=profileOverride?profilePath:record.profilePath??profilePath;const profile=selectedProfile?JSON.parse(await fs.readFile(selectedProfile,'utf8')):{};const parameters=h.parametersByPath?.[path]??defs,styles=h.stylesByPath?.[path]??[{id:'default'},{id:'labels'},{id:'no-labels'}],a=resolveAdapter(parameters,{profile,adapterOverride:record});return{path,entry:entry??basename(path),key:id,token:randomUUID(),signature:JSON.stringify([path,entry,record,selectedProfile]),profilePath:selectedProfile??null,proof:await proof(path),adapter:{parameters:Object.entries(parameters).map(([id,v])=>({id,name:id,...v})),inputs:a.inputs,effects:a.effects,handStyles:styles,handStyle:styles.some(s=>s.id===(record.handStyle??'default'))?(record.handStyle??'default'):'default',warnings:[],handGroups:90,handCache:{entries:0,pixels:0},poseSupported:false}}}
 function reply(m){return{ok:true,modelToken:m.token,signature:m.signature,modelKey:m.key,modelSourcePath:m.path,modelEntry:m.entry,sourceProof:m.proof,adapter:m.adapter}}
 const utility=async(args,signal)=>{h.records.push({utility:args});if(args[0]==='--pick')return{path:h.picked??first};if(args[0]==='--discover-model'){await wait(h.discoveryDelay,signal);const paths=h.candidatePaths??[args[1]];return{candidates:await Promise.all(paths.map(async(p,i)=>{const s=await fs.stat(p);return{sourcePath:p,entry:basename(p),name:basename(p),error:null,fingerprint:String(s.size)+':'+s.mtimeMs,modelKey:key(p)}}))}};throw Error('Unexpected utility')};utility.supportsDiscovery=true
 const manager=new OverlayManagement(o,{utility,io});Object.assign(h,{store,overlay:o,manager,proof,select:async p=>{h.candidatePaths=[p];const c=await manager.models.discover(p,manager.signal());return manager.command({type:'selectModel',catalogGeneration:c.generation,modelId:c.items[0].id,revision:store.revision})}})
 try{await run(h)}finally{await manager.close();await o.stopDisplay();assert.ok(resolve(dir).startsWith(base+sep));await fs.rm(dir,{recursive:true,force:true})}
}
const readCatalog=async h=>{await h.manager.command('refreshAdapter');return (await h.manager.getState()).adapterCatalog}
test('settings/state reads do not launch a display or create preference files',()=>fixture(async h=>{const s=await h.manager.getState();assert.equal(h.starts,0);assert.equal(s.adapterCatalog,null);await assert.rejects(fs.readFile(h.store.path),{code:'ENOENT'})}))
test('cold parameter read validates hidden, retires the process and caches the directory',()=>fixture(async h=>{const a=await readCatalog(h);assert.ok(a.parameters.length);assert.equal(h.starts,1);assert.equal(h.overlay.ready,false);assert.equal(h.overlay.activated,false);assert.equal((await h.manager.getState()).adapterCatalog.generation,a.generation);await assert.rejects(fs.readFile(h.store.path),{code:'ENOENT'});assert.ok(h.records.every(x=>!['capture','input','screenshot'].includes(x.kind)))}))
test('old renderer refuses adaptation without fake successful reports',()=>fixture(async h=>{await assert.rejects(h.manager.command('refreshAdapter'),{code:'unsupported'});assert.equal(h.overlay.ready,false);assert.equal((await h.manager.getState()).adapterCatalog,null)},{old:true}))
test('disabled adaptation requests launch nothing',()=>fixture(async h=>{h.overlay.enabled=false;await assert.rejects(h.manager.command('refreshAdapter'),{code:'disabled'});assert.equal(h.starts,0)}))
test('manual mapping and style save update the global record and revision',()=>fixture(async h=>{const a=await readCatalog(h);await h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,bindings:{keyboard:{id:'ParamAngleX',reverse:true}},handStyle:'labels'}},h.store.revision);const r=h.store.value.globalAdapter;assert.equal(r.bindings.keyboard.id,'ParamAngleX');assert.equal(r.handStyle,'labels');assert.equal(h.overlay.ready,false);assert.equal((await h.manager.getState()).adapterCatalog.inputs[0].reverse,true);assert.equal(h.overlay.activated,false)}))
test('switching models shares global bindings and style without adding scoped records',()=>fixture(async h=>{const a=await readCatalog(h);await h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,bindings:{keyboard:{id:'ParamAngleX',reverse:false}},handStyle:'labels'}},0);await h.select(h.second);let s=await h.manager.getState();assert.equal(s.adapterCatalog.inputs[0].id,'ParamAngleX');assert.deepEqual(h.store.value.modelOverrides,{});assert.equal(h.store.value.globalAdapter.handStyle,'labels');await h.select(h.first);s=await h.manager.getState();assert.equal(s.adapterCatalog.inputs[0].id,'ParamAngleX');assert.equal(s.adapterCatalog.handStyle,'labels')}))
test('stale parameter directories never overwrite a new model selection',()=>fixture(async h=>{const old=await readCatalog(h);await h.select(h.second);const before=structuredClone(h.store.value);await assert.rejects(h.manager.updatePreferences({modelAdapter:{catalogGeneration:old.generation,handStyle:'labels'}},h.store.revision),{code:'stale_adapter_catalog'});assert.deepEqual(h.store.value,before)}))
test('preference conflicts preserve the other entrance new value',()=>fixture(async h=>{const a=await readCatalog(h);await h.store.update({widthDip:700},0);await assert.rejects(h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,handStyle:'labels'}},0),{code:'preference_conflict'});assert.equal(h.store.value.widthDip,700);assert.deepEqual(h.store.value.modelOverrides,{})}))
test('save failure cancels the staged model and preserves previous live state and preferences',()=>fixture(async h=>{await h.manager.command('show');const a=await readCatalog(h),before=structuredClone(h.store.value),token=h.current.token;h.failWrite=true;await assert.rejects(h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,handStyle:'labels'}},0),/Disk denied/);assert.deepEqual(h.store.value,before);assert.equal(h.current.token,token);assert.equal(h.staged,null);assert.equal(h.overlay.ready,true);assert.equal(h.overlay.activated,true);assert.ok(h.records.some(x=>x.kind==='cancel-load'))}))
test('missing, protected and auto-input-owned parameters are rejected before launching',()=>fixture(async h=>{const a=await readCatalog(h),n=h.starts;for(const patch of [{bindings:{keyboard:{id:'missing',reverse:false}}},{bindings:{keyboard:{id:'ParamMouseX',reverse:false}}},{effects:{headX:{ids:['ParamMouseX'],reverse:false}}}])await assert.rejects(h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,...patch}},0),{code:'invalid_adapter'});assert.equal(h.starts,n)}))
test('source changes invalidate directories and explicit reread obtains a fresh hidden model',()=>fixture(async h=>{const a=await readCatalog(h);await fs.appendFile(h.first,' ');await assert.rejects(h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,handStyle:'labels'}},0),{code:'stale_model_resources'});await h.manager.getState();const b=await readCatalog(h);assert.notEqual(a.generation,b.generation);assert.equal(h.overlay.ready,false);assert.equal((await h.manager.getState()).error,null)}))
test('multiple model discovery requires explicit selection without starting rendering',()=>fixture(async h=>{h.candidatePaths=[h.first,h.second];await h.manager.command('importModelFile');const s=await h.manager.getState();assert.equal(s.modelCatalog.items.length,2);assert.equal(h.starts,0);assert.equal(h.store.value.modelPath,null);await h.manager.command({type:'selectModel',catalogGeneration:s.modelCatalog.generation,modelId:s.modelCatalog.items[1].id,revision:0});assert.equal(h.store.value.modelPath,h.second);assert.equal((await h.manager.getState()).modelCatalog,null)}))
test('wrong model catalog, unknown ID and direct resource paths are not selectable',()=>fixture(async h=>{h.candidatePaths=[h.first,h.second];const c=await h.manager.models.discover(h.dir,h.manager.signal());for(const v of [{type:'selectModel',catalogGeneration:randomUUID(),modelId:'model-0',revision:0},{type:'selectModel',catalogGeneration:c.generation,modelId:'model-63',revision:0}])await assert.rejects(h.manager.command(v));assert.equal(h.starts,0);assert.throws(()=>validatePreferenceRequest({modelPath:h.second,modelEntry:'second.model3.json'}));assert.throws(()=>validatePreferenceRequest({modelOverrides:{}}))}))
test('cancel pending candidate selection works out of band and makes late results inert',()=>fixture(async h=>{const c=await h.manager.models.discover(h.first,h.manager.signal());h.discoveryDelay=60;const p=h.manager.command({type:'selectModel',catalogGeneration:c.generation,modelId:c.items[0].id,revision:0}),rejected=assert.rejects(p,{code:'canceled'});await tick();await h.manager.command('cancelLoad');await rejected;assert.equal(h.starts,0);assert.equal(h.store.value.modelPath,null);assert.equal(h.manager.models.candidates,null)}))
test('cancel hidden model load never commits or writes preferences',()=>fixture(async h=>{h.loadDelay=70;const p=h.manager.command('refreshAdapter'),rejected=assert.rejects(p,{code:'canceled'});for(let i=0;i<20&&!h.records.some(x=>x.kind==='load-model');i++)await tick();await h.manager.command('cancelLoad');await rejected;assert.equal(h.overlay.ready,false);assert.equal(h.staged,null);assert.ok(!h.records.some(x=>x.kind==='commit-model'));await assert.rejects(fs.readFile(h.store.path),{code:'ENOENT'})}))
test('new AI display demand during hidden validation keeps the renderer alive',()=>fixture(async h=>{h.loadDelay=30;const p=h.manager.command('refreshAdapter');for(let i=0;i<20&&!h.records.some(x=>x.kind==='load-model');i++)await tick();h.overlay.activity++;h.overlay.activated=true;await p;assert.equal(h.overlay.ready,true);assert.equal(h.overlay.activated,true)}))
test('hot parameter read preserves previous hidden visibility',()=>fixture(async h=>{await h.manager.command('show');await h.manager.command('hide');await readCatalog(h);assert.equal(h.overlay.ready,true);assert.equal(h.overlay.runtime.userHidden,true);assert.equal(h.overlay.runtime.visible,false)}))
test('v1 JSON imports global bindings and clear restores automatic detection',()=>fixture(async h=>{await readCatalog(h);const profile=join(h.dir,'adapter.json');await fs.writeFile(profile,JSON.stringify({version:1,bindings:{keyboard:'ParamAngleX'}}));h.picked=profile;await h.manager.command('importProfile');const a=(await h.manager.getState()).adapterCatalog;assert.equal(a.inputs[0].source,'manual');assert.equal(h.store.value.globalAdapter.bindings.keyboard.id,'ParamAngleX');await fs.unlink(profile);await h.select(h.second);await h.manager.command('clearProfile');assert.equal(h.store.value.profilePath,null);assert.equal(h.store.value.globalAdapter.bindings,undefined);assert.equal((await h.manager.getState()).adapterCatalog.inputs[0].id,'CatParamLeftHandDown')}))
test('restoring automatic detection preserves hand style and clears manual/JSON roles',()=>fixture(async h=>{let a=await readCatalog(h);await h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,bindings:{keyboard:{id:'ParamAngleX',reverse:true}},handStyle:'labels'}},0);a=(await h.manager.getState()).adapterCatalog;await h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,reset:true}},h.store.revision);assert.equal((await h.manager.getState()).adapterCatalog.inputs[0].id,'CatParamLeftHandDown');assert.equal(h.store.value.globalAdapter.handStyle,'labels')}))
test('unload clears old candidate and parameter catalogs',()=>fixture(async h=>{await readCatalog(h);await h.manager.models.discover(h.first,h.manager.signal());await h.manager.close();assert.equal(h.manager.models.cache,null);assert.equal(h.manager.models.candidates,null)}))
test('legacy preference migration preserves existing layout and adds empty scoped records without writing',()=>{const p=migratePreferences({version:3,view:'model',modelPath:'C:/model/pet.model3.json',widthDip:640,opacity:.7,x:-300,y:20});assert.equal(p.version,5);assert.equal(p.globalAdapter,null);assert.equal(p.widthDip,640);assert.equal(p.x,-300);assert.deepEqual(p.modelOverrides,{});assert.equal(p.modelEntry,null)})
test('stored model records have bounded safe keys and remain unavailable to raw RPC patches',()=>{const id='a'.repeat(64);assert.equal(validatePreferencePatch({modelOverrides:{[id]:{handStyle:'labels'}}}).modelOverrides[id].handStyle,'labels');assert.throws(()=>validatePreferencePatch({modelOverrides:{'../bad':{}}}));assert.throws(()=>validatePreferencePatch({modelOverrides:{[id]:{script:'x'}}}));assert.throws(()=>validatePreferenceRequest({modelOverrides:{[id]:{handStyle:'labels'}}}))})
test('the owner management contribution still exposes exactly three existing interfaces',()=>{assert.deepEqual(OVERLAY_CONTRIBUTION.invocations.map(x=>x.method),['getState','updatePreferences','command']);assert.equal(OVERLAY_CONTRIBUTION.model.services.length,0)})

async function autosaveClient(h){
 const client=new OverlayUIController({document:{visibilityState:'hidden'}}),calls=[]
 client.attach({rpc:{call:async(_base,endpoint,envelope,signal)=>{
  if(endpoint.endsWith('/getState'))return {ok:true,value:await h.manager.getState()}
  assert.ok(endpoint.endsWith('/updatePreferences'));calls.push(envelope.args)
  let success=true,error
  try{await h.manager.updatePreferences(envelope.args.patch,envelope.args.revision,signal)}catch(reason){success=false;error={code:reason.code??'operation_failed',message:reason.message}}
  return {ok:true,value:{success,error,state:await h.manager.getState()}}
 }}})
 client.accept(await h.manager.getState(),0,client.generation)
 return {client,calls,edit:patch=>client.set('modelAdapter',{catalogGeneration:client.snapshot.value.adapterCatalog.generation,...patch})}
}
test('client autosave persists real global adapter records and a recreated manager restores them',()=>fixture(async h=>{
 const catalog=await readCatalog(h),ui=await autosaveClient(h)
 try{
  assert.equal(await ui.edit({effects:{headX:{ids:['ParamAngleX'],reverse:true}},bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:true}},handStyle:'labels'}),true)
  assert.equal(ui.client.snapshot.adapterSave.status,'saved');assert.equal(ui.calls.length,1)
  const restoredStore=new OverlayPreferences(h.store.path);await restoredStore.ready
  assert.deepEqual(restoredStore.value.modelOverrides,h.store.value.modelOverrides)
  const restarted=new OverlayManagement({...h.overlay,preferences:restoredStore},{utility:h.manager.utility,io:h.manager.io})
  try{
   await restarted.command('refreshAdapter')
   const state=await restarted.getState(),record=state.preferences.globalAdapter
   assert.equal(record.bindings.keyboard.reverse,true);assert.equal(record.effects.headX.reverse,true);assert.equal(record.handStyle,'labels')
   assert.equal(state.adapterCatalog.inputs.find(row=>row.role==='keyboard').reverse,true)
   assert.equal(state.adapterCatalog.handStyle,'labels')
  }finally{await restarted.close()}
 }finally{ui.client.detach()}
}))
test('client disk-write failure keeps the old native model and retries its retained draft',()=>fixture(async h=>{
 await h.manager.command('show');await readCatalog(h);const ui=await autosaveClient(h)
 try{
  assert.equal(await ui.edit({handStyle:'labels'}),true)
  const before=structuredClone(h.store.value),token=h.current.token;h.failWrite=true
  assert.equal(await ui.edit({effects:{headX:{ids:['ParamAngleX'],reverse:true}}}),false)
  assert.equal(ui.client.snapshot.adapterSave.status,'failed');assert.deepEqual(h.store.value,before);assert.equal(h.current.token,token)
  const restored=new OverlayPreferences(h.store.path);await restored.ready;assert.deepEqual(restored.value,before)
  assert.equal(h.staged,null);assert.equal(h.overlay.ready,true);assert.equal(ui.calls.length,2)
  h.failWrite=false;assert.equal(await ui.client.retryAdapter(),true);assert.equal(ui.client.snapshot.adapterSave.status,'saved')
  assert.equal(h.store.value.globalAdapter.effects.headX.reverse,true)
 }finally{ui.client.detach()}
}))
test('client native-commit failure rolls back disk and applied model without reporting saved',()=>fixture(async h=>{
 await h.manager.command('show');await readCatalog(h);const ui=await autosaveClient(h)
 try{
  assert.equal(await ui.edit({handStyle:'labels'}),true)
  const before=structuredClone(h.store.value),token=h.current.token,command=h.overlay.command;let fail=true
  h.overlay.command=async function(data,...args){if(data.kind==='commit-model'&&fail){fail=false;throw Error('Native apply failed')}return command.call(this,data,...args)}
  assert.equal(await ui.edit({bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:true}}}),false)
  assert.notEqual(ui.client.snapshot.adapterSave.status,'saved');assert.deepEqual(h.store.value,before);assert.equal(h.current.token,token)
  const restored=new OverlayPreferences(h.store.path);await restored.ready;assert.deepEqual(restored.value,before)
  assert.equal(h.staged,null);assert.equal(h.overlay.ready,true);assert.ok(h.records.some(record=>record.kind==='cancel-load'))
 }finally{ui.client.detach()}
}))

test('rapid client autosaves survive real manager catalog regeneration and preserve the last roles',()=>fixture(async h=>{
 await h.manager.command('show');await readCatalog(h);const ui=await autosaveClient(h);h.loadDelay=20
 try{
  const pending=ui.edit({handStyle:'labels'});await tick()
  void ui.edit({bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:true}}})
  void ui.edit({effects:{headX:{ids:['ParamAngleX'],reverse:true}}})
  assert.equal(await pending,true);assert.equal(ui.calls.length,2)
  assert.notEqual(ui.calls[0].patch.modelAdapter.catalogGeneration,ui.calls[1].patch.modelAdapter.catalogGeneration)
  assert.equal(ui.client.snapshot.adapterSave.status,'saved')
  const restored=new OverlayPreferences(h.store.path);await restored.ready
  const record=restored.value.globalAdapter
  assert.equal(record.bindings.keyboard.reverse,true);assert.equal(record.effects.headX.reverse,true);assert.equal(record.handStyle,'labels')
 }finally{ui.client.detach()}
}))

async function legacyPreferences(h,record,{profilePath=null,others={}}={}){
 const raw={...h.store.value,version:4,modelPath:h.first,modelEntry:basename(h.first),profilePath,modelOverrides:{...others,[key(h.first)]:record},revision:0};delete raw.globalAdapter
 await fs.writeFile(h.store.path,JSON.stringify(raw));await h.store.refresh();return raw
}
test('v4 reading is non-writing and migration uses only the originally selected model',()=>fixture(async h=>{
 const old=await legacyPreferences(h,{bindings:{mouseY:{id:'ParamMouseY',reverse:true}},handStyle:'labels'},{others:{[key(h.second)]:{bindings:{keyboard:{id:'ParamAngleX',reverse:true}},handStyle:'no-labels'}}}),before=await fs.readFile(h.store.path,'utf8')
 await h.manager.getState();assert.equal(await fs.readFile(h.store.path,'utf8'),before);assert.equal(h.store.value.globalAdapter,null)
 await h.select(h.second)
 assert.deepEqual(h.store.value.globalAdapter,{bindings:{mouseY:{id:'ParamMouseY',reverse:true}},handStyle:'labels'});assert.deepEqual(h.store.value.modelOverrides,old.modelOverrides)
 assert.equal(h.current.adapter.inputs.find(i=>i.role==='keyboard').id,'CatParamLeftHandDown');assert.equal(h.current.adapter.inputs.find(i=>i.role==='mouseY').reverse,true)
 const restored=new OverlayPreferences(h.store.path);await restored.ready;assert.equal(restored.value.version,5);assert.deepEqual(restored.value.globalAdapter,h.store.value.globalAdapter)
}))
test('migration merges current JSON below manual settings and retires the active file dependency',()=>fixture(async h=>{
 const profile=join(h.dir,'legacy.json');await fs.writeFile(profile,JSON.stringify({version:1,bindings:{keyboard:'CatParamLeftHandDown',mouseY:'ParamMouseY'},invertY:true}))
 const old=await legacyPreferences(h,{bindings:{keyboard:{id:'ParamAngleX',reverse:true}},handStyle:'labels'},{profilePath:profile})
 await h.manager.applyPreferences({globalAdapter:null},h.store.revision,h.manager.signal())
 assert.equal(h.store.value.profilePath,null);assert.equal(h.store.value.globalAdapter.bindings.keyboard.id,'ParamAngleX');assert.equal(h.store.value.globalAdapter.bindings.mouseY.reverse,true);assert.deepEqual(h.store.value.modelOverrides,old.modelOverrides)
 await fs.unlink(profile);await h.select(h.second);assert.equal(h.current.adapter.inputs.find(i=>i.role==='keyboard').id,'ParamAngleX')
}))
test('unreadable legacy JSON blocks migration without rewriting old disk or choosing another record',()=>fixture(async h=>{
 await legacyPreferences(h,{handStyle:'labels'},{profilePath:join(h.dir,'missing.json'),others:{[key(h.second)]:{handStyle:'no-labels'}}});const before=await fs.readFile(h.store.path,'utf8')
 await assert.rejects(h.manager.applyPreferences({globalAdapter:null},h.store.revision,h.manager.signal()),{code:'ENOENT'})
 assert.equal(await fs.readFile(h.store.path,'utf8'),before);assert.equal(h.store.value.globalAdapter,null);assert.equal(h.staged,null)
}))
test('migration disk failure preserves the old format and retry migrates atomically',()=>fixture(async h=>{
 await legacyPreferences(h,{bindings:{mouseY:{id:'ParamMouseY',reverse:true}}});const before=await fs.readFile(h.store.path,'utf8');h.failWrite=true
 await assert.rejects(h.manager.applyPreferences({globalAdapter:null},h.store.revision,h.manager.signal()),/Disk denied/);assert.equal(await fs.readFile(h.store.path,'utf8'),before);assert.equal(h.store.value.globalAdapter,null)
 h.failWrite=false;await h.manager.applyPreferences({globalAdapter:null},h.store.revision,h.manager.signal());assert.equal(h.store.value.globalAdapter.bindings.mouseY.reverse,true)
}))
test('v5 ignores dormant per-model records even when they contain styles and JSON paths',()=>fixture(async h=>{
 await h.store.update({modelOverrides:{[key(h.first)]:{handStyle:'labels',profilePath:join(h.dir,'gone.json'),bindings:{keyboard:{id:'ParamAngleX',reverse:true}}}}},0)
 const a=await readCatalog(h);assert.equal(a.handStyle,'default');assert.equal(a.inputs[0].id,'CatParamLeftHandDown');assert.deepEqual(a.globalAdapter,{})
}))
test('another model falls back without changing global IDs, direction or artwork; switching back restores them',()=>fixture(async h=>{
 const second={...defs};delete second.ParamMouseY;second.PARAM_MOUSE_Y={min:-30,max:30,default:0};h.parametersByPath={[h.second]:second};h.stylesByPath={[h.second]:[{id:'default'}]}
 let a=await readCatalog(h);await h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,bindings:{mouseY:{id:'ParamMouseY',reverse:true}},handStyle:'labels'}},h.store.revision);const saved=structuredClone(h.store.value.globalAdapter),count=h.records.length
 await h.select(h.second);a=(await h.manager.getState()).adapterCatalog
 assert.equal(a.inputs.find(i=>i.role==='mouseY').id,'PARAM_MOUSE_Y');assert.equal(a.inputs.find(i=>i.role==='mouseY').reverse,true);assert.equal(a.handStyle,'default');assert.equal(a.fallbacks.length,2);assert.deepEqual(a.globalAdapter,saved);assert.deepEqual(h.store.value.globalAdapter,saved)
 assert.ok(h.records.slice(count).filter(r=>r.kind==='load-model').length<=2)
 await h.select(h.first);a=(await h.manager.getState()).adapterCatalog;assert.equal(a.inputs.find(i=>i.role==='mouseY').id,'ParamMouseY');assert.equal(a.handStyle,'labels');assert.deepEqual(a.fallbacks,[])
}))
test('global explicit disable and automatic reversal survive switching and recreated management',()=>fixture(async h=>{
 const a=await readCatalog(h);await h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,bindings:{keyboard:null,mouseY:{reverse:true}}}},h.store.revision)
 await h.select(h.second);assert.equal(h.current.adapter.inputs[0].enabled,false);assert.equal(h.current.adapter.inputs.find(i=>i.role==='mouseY').reverse,true)
 const restored=new OverlayPreferences(h.store.path);await restored.ready;assert.deepEqual(restored.value.globalAdapter.bindings.mouseY,{reverse:true});assert.equal(restored.value.globalAdapter.bindings.keyboard,null)
}))
test('global JSON import replaces only inputs, ignores omitted roles, and preserves effects and hand style',()=>fixture(async h=>{
 let a=await readCatalog(h);await h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,bindings:{left:null},effects:{headX:null},handStyle:'labels'}},h.store.revision)
 const profile=join(h.dir,'global.json');await fs.writeFile(profile,JSON.stringify({version:1,bindings:{keyboard:'MissingOnThisModel'},invertY:true}));h.picked=profile;await h.manager.command('importProfile')
 assert.equal(h.store.value.globalAdapter.bindings.left,undefined);assert.deepEqual(h.store.value.globalAdapter.bindings.mouseY,{reverse:true});assert.equal(h.store.value.globalAdapter.effects.headX,null);assert.equal(h.store.value.globalAdapter.handStyle,'labels');assert.equal(h.current.adapter.inputs[0].id,'CatParamLeftHandDown')
 await fs.unlink(profile);await h.manager.command('clearProfile');assert.equal(h.store.value.globalAdapter.bindings,undefined);assert.equal(h.store.value.globalAdapter.effects.headX,null);assert.equal(h.store.value.globalAdapter.handStyle,'labels')
}))
test('unchanged global requests and already automatic reset do not increment revision or stage native models',()=>fixture(async h=>{
 let a=await readCatalog(h),n=h.records.length,revision=h.store.revision;await h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,reset:true}},revision);assert.equal(h.store.revision,revision);assert.equal(h.records.filter(r=>r.kind==='load-model').length,h.records.slice(0,n).filter(r=>r.kind==='load-model').length)
 await h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,handStyle:'labels'}},revision);a=(await h.manager.getState()).adapterCatalog;revision=h.store.revision;n=h.records.length
 await h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,handStyle:'labels'}},revision);assert.equal(h.store.revision,revision);assert.equal(h.records.length,n)
}))
test('a success acknowledgement without the requested effective state is rejected before disk commit',()=>fixture(async h=>{
 const a=await readCatalog(h),original=h.overlay.command.bind(h.overlay);h.overlay.command=async(data,options)=>{const reply=await original(data,options);if(data.kind==='load-model'&&data.adapter?.handStyle==='labels')reply.adapter.handStyle='default';return reply}
 await assert.rejects(h.manager.updatePreferences({modelAdapter:{catalogGeneration:a.generation,handStyle:'labels'}},h.store.revision),{code:'invalid_adapter'});assert.deepEqual(h.store.value.globalAdapter,{});assert.equal(h.staged,null);await assert.rejects(fs.readFile(h.store.path),{code:'ENOENT'})
}))
test('raw global records cannot be selected by public RPC and corrupt persisted globals are reported',()=>fixture(async h=>{
 assert.throws(()=>validatePreferenceRequest({globalAdapter:{handStyle:'labels'}}),{code:'invalid_preferences'})
 await fs.writeFile(h.store.path,JSON.stringify({version:5,globalAdapter:{bindings:{keyboard:{id:'Paramshuiying',reverse:false}}}}));const restored=new OverlayPreferences(h.store.path);await restored.ready;assert.match(restored.error,/Protected/)
}))

test('global JSON import before reading any catalog migrates and preserves legacy effect/style preferences',()=>fixture(async h=>{
 await legacyPreferences(h,{effects:{headX:null},handStyle:'labels'});const profile=join(h.dir,'new-global.json');await fs.writeFile(profile,JSON.stringify({version:1,bindings:{keyboard:'CatParamLeftHandDown'},invertY:true}));h.picked=profile
 await h.manager.command('importProfile');assert.equal(h.store.value.globalAdapter.handStyle,'labels');assert.equal(h.store.value.globalAdapter.effects.headX,null);assert.deepEqual(h.store.value.globalAdapter.bindings.mouseY,{reverse:true})
 const revision=h.store.revision;await h.manager.command('importProfile');assert.equal(h.store.revision,revision)
}))
test('clear profile before reading the old catalog preserves legacy effects and artwork',()=>fixture(async h=>{
 await legacyPreferences(h,{bindings:{mouseY:{id:'ParamMouseY',reverse:true}},effects:{headX:null},handStyle:'labels'})
 await h.manager.command('clearProfile');assert.deepEqual(h.store.value.globalAdapter,{effects:{headX:null},handStyle:'labels'});assert.equal(h.current.adapter.inputs.find(i=>i.role==='mouseY').reverse,false)
}))
test('an imported JSON changing during native validation cannot be committed',()=>fixture(async h=>{
 await readCatalog(h);const profile=join(h.dir,'changing-global.json');await fs.writeFile(profile,JSON.stringify({version:1,bindings:{keyboard:'CatParamLeftHandDown'}}));h.picked=profile
 const command=h.overlay.command.bind(h.overlay);let changed=false;h.overlay.command=async(data,options)=>{const result=await command(data,options);if(!changed&&data.kind==='load-model'){changed=true;await fs.writeFile(profile,JSON.stringify({version:1,bindings:{keyboard:'ParamAngleX'},invertY:true}))}return result}
 await assert.rejects(h.manager.command('importProfile'),{code:'stale_model_resources'});assert.deepEqual(h.store.value.globalAdapter,{});assert.equal(h.staged,null);await assert.rejects(fs.readFile(h.store.path),{code:'ENOENT'})
}))
test('invalid and oversized global JSON files are rejected before native loading',()=>fixture(async h=>{
 const profile=join(h.dir,'invalid-global.json');h.picked=profile;await fs.writeFile(profile,JSON.stringify({version:2,bindings:{keyboard:'X'}}));await assert.rejects(h.manager.command('importProfile'),{code:'invalid_adapter'});assert.equal(h.starts,0)
 await fs.writeFile(profile,' '.repeat(1048577));await assert.rejects(h.manager.command('importProfile'),{code:'invalid_adapter'});assert.equal(h.starts,0)
}))
