import assert from 'node:assert/strict'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { AUTHORIZED_WATERMARKS, watermarkCapability, verifyWatermarkCore, validateWatermarkChange, validateWatermarkRecords } from '../src/live2d/watermark.js'
import { OverlayPreferences, migratePreferences, validatePreferenceRequest } from '../src/overlay-preferences.js'
import { OverlayModels } from '../src/overlay-models.js'
import { OverlayManagement } from '../src/overlay-management.js'

const root=dirname(dirname(fileURLToPath(import.meta.url)))
const hashes=Object.keys(AUTHORIZED_WATERMARKS),hash=hashes[0],key='a'.repeat(64),other='b'.repeat(64),generation=randomUUID()
const record={mode:'hidden',mocHash:hash},parameters={Paramshuiying:{min:0,max:1,default:0}}
assert.deepEqual(Object.values(AUTHORIZED_WATERMARKS).map(v=>v.name),['清宵','达妮娅'])
assert.equal(hashes.length,2)
for(const h of hashes)assert.equal(watermarkCapability(h,parameters).supported,true)
for(const h of ['unknown','constructor','__proto__',hash.toUpperCase(),'0'.repeat(64)])assert.equal(watermarkCapability(h,parameters).supported,false)
for(const p of [{min:0,max:2,default:0},{min:0,max:1,default:1},{}])assert.equal(watermarkCapability(hash,{Paramshuiying:p}).supported,false)
assert.deepEqual(validateWatermarkChange({catalogGeneration:generation,mode:'hidden'}),{catalogGeneration:generation,mode:'hidden'})
for(const value of [{mode:'hidden'},{catalogGeneration:generation,mode:1},{catalogGeneration:generation,mode:'hidden',id:'Paramshuiying'},{catalogGeneration:generation,mode:'hidden',path:'C:/x'}])assert.throws(()=>validateWatermarkChange(value))
assert.throws(()=>validatePreferenceRequest({modelWatermarks:{[key]:record}}))
assert.throws(()=>validatePreferenceRequest({modelWatermark:{catalogGeneration:generation,mode:'hidden'},opacity:.5}))
assert.deepEqual(validateWatermarkRecords({[key]:record}),{[key]:record})
for(const records of [{bad:record},{[key]:{...record,mode:'default'}},{[key]:{...record,mocHash:'0'.repeat(64)}},{[key]:{...record,value:1}},Object.fromEntries(Array.from({length:33},(_,i)=>[i.toString(16).padStart(64,'0'),record]))])assert.throws(()=>validateWatermarkRecords(records))
const legacy=migratePreferences({version:4,widthDip:530,opacity:.7,x:-20,modelOverrides:{}})
assert.equal(legacy.widthDip,530);assert.equal(legacy.x,-20);assert.deepEqual(legacy.modelWatermarks,{})
const manager={store:{value:{modelWatermarks:{[other]:record}}},overlay:{}},models=new OverlayModels(manager)
models.cache={generation,modelKey:key,watermark:{supported:true,mocHash:hash}}
assert.deepEqual(models.watermarkPatch({catalogGeneration:generation,mode:'hidden'}).modelWatermarks,{[other]:record,[key]:record})
manager.store.value.modelWatermarks={[other]:record,[key]:record}
assert.deepEqual(models.watermarkPatch({catalogGeneration:generation,mode:'default'}).modelWatermarks,{[other]:record})
assert.throws(()=>models.watermarkPatch({catalogGeneration:randomUUID(),mode:'hidden'}),{code:'stale_adapter_catalog'})
models.cache.watermark.supported=false
assert.throws(()=>models.watermarkPatch({catalogGeneration:generation,mode:'hidden'}),{code:'unsupported'})
function fakeCore(h,{face=false,vertices=false,parts=false}={}){
 let value=.25
 return {getParameterValueByIndex:()=>value,setParameterValueByIndex:(_,v)=>{value=v},update(){},getPartCount:()=>1,getPartOpacityByIndex:()=>parts?1-value:1,getDrawableCount:()=>2,getDrawableId:i=>({getString:()=>i===0?AUTHORIZED_WATERMARKS[h].drawable:'face'}),getDrawableOpacity:i=>i===0?1-value:face?1-value:1,getDrawableVertices:()=>new Float32Array([0,0,1,vertices?1+value:1])}
}
for(const h of hashes){const core=fakeCore(h);assert.equal(verifyWatermarkCore(core,watermarkCapability(h,parameters),0).supported,true);assert.equal(core.getParameterValueByIndex(0),.25)}
for(const option of [{face:true},{vertices:true},{parts:true}]){const core=fakeCore(hash,option);assert.equal(verifyWatermarkCore(core,watermarkCapability(hash,parameters),0).reason,'validation_failed');assert.equal(core.getParameterValueByIndex(0),.25)}
const adapter=await readFile(join(root,'src/live2d/model-adapter.js'),'utf8'),motion=await readFile(join(root,'src/live2d/motions.js'),'utf8'),cursor=await readFile(join(root,'src/live2d/cursor-gaze.js'),'utf8')
assert.match(adapter,/PROTECTED_PARAMETERS=Object.freeze\(\['Paramshuiying'\]\)/)
assert.match(motion,/Watermark\/author switch is not a character motion/)
assert.match(cursor,/PROTECTED_PARAMETERS.includes\(id\)/)
const previousWindow=globalThis.window
let definition
try{
 globalThis.window={__ModuleLoader__:{load:value=>{definition=value}}}
 await import(pathToFileURL(join(root,'client.js')).href+'?watermark-regression='+randomUUID())
 const React={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)})},ui=definition.factory(()=>React)
 const collect=(node,predicate,out=[])=>{if(node&&typeof node==='object'){if(predicate(node))out.push(node);for(const child of node.children??[])collect(child,predicate,out)}return out}
 const button=(tree,name)=>collect(tree,node=>node.type==='button'&&node.props.key===name)[0]
 const props=()=>{const calls=[],value={enabled:true,modelLoaded:true,loading:false,capabilities:{watermark:true},adapterCatalog:{generation,watermark:{supported:true,mode:'default'}}};return{calls,value,state:{status:'ready',pending:''},manager:{set:(...args)=>calls.push(args),command:(...args)=>calls.push(args)},t:key=>key}}
 assert.equal(typeof ui.ModelWatermarkControls,'function')
 const p=props();let tree=ui.ModelWatermarkControls(p)
 assert.equal(button(tree,'hide').props.disabled,false);button(tree,'hide').props.onClick()
 assert.deepEqual(p.calls,[['modelWatermark',{catalogGeneration:generation,mode:'hidden'}]])
 assert.equal(button(tree,'restore').props.disabled,true)
 p.value.adapterCatalog.watermark.mode='hidden';tree=ui.ModelWatermarkControls(p)
 assert.equal(button(tree,'hide').props.disabled,true);assert.equal(button(tree,'restore').props.disabled,false)
 button(tree,'restore').props.onClick();assert.deepEqual(p.calls[1],['modelWatermark',{catalogGeneration:generation,mode:'default'}])
 for(const flag of ['motion','previewing','loading','watermarkBlocked']){const q=props();q.value[flag]=true;assert.equal(button(ui.ModelWatermarkControls(q),'hide').props.disabled,true)}
 for(const change of [q=>q.value.enabled=false,q=>q.state.pending='switch',q=>q.value.capabilities.watermark=false,q=>q.value.modelLoaded=false]){const q=props();change(q);assert.equal(button(ui.ModelWatermarkControls(q),'hide').props.disabled,true)}
 const q=props();q.value.adapterCatalog.watermark.supported=false;assert.equal(button(ui.ModelWatermarkControls(q),'hide'),undefined)
 const client=await readFile(join(root,'client.js'),'utf8'),library=client.indexOf("h(ModelLibraryControls,{key:'library'"),watermark=client.indexOf("h(ModelWatermarkControls,{key:'watermark'"),advanced=client.indexOf("h('details',{key:'advanced'",library)
 assert.ok(library<watermark&&watermark<advanced)
 for(const lang of ['zh','en'])for(const key of ['watermarkTitle','watermarkHide','watermarkRestore','watermarkUnsupported','watermarkBlocked','watermarkReason.not_authorized','watermarkReason.parameter_mismatch','watermarkReason.validation_failed'])assert.ok(ui.locales[lang]['local.'+key])
}finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow}
for(const status of ['unknown','locked','releasing','syncing']){
 const m=Object.create(OverlayManagement.prototype)
 Object.assign(m,{lifetime:new AbortController(),overlay:{enabled:true,closed:false,capabilities:{watermark:true},runtime:{},state:{status}},motions:{active:null},models:{},busy:null,load:null,manualPreview:null})
 await assert.rejects(m.updatePreferences({modelWatermark:{catalogGeneration:generation,mode:'hidden'}},0),{code:'busy'})
}
const base=join(root,'.qa','watermark-regression');await mkdir(base,{recursive:true});const fixture=await mkdtemp(join(base,'isolated-'))
try{
 const store=new OverlayPreferences(join(fixture,'overlay.json'));await store.ready
 await store.update({widthDip:520,modelWatermarks:{[key]:record}},0)
 const restarted=new OverlayPreferences(store.path);await restarted.ready
 assert.deepEqual(restarted.value.modelWatermarks,{[key]:record});assert.equal(restarted.value.widthDip,520)
 let committed=false,rolledBack=false
 const io={...await import('node:fs/promises'),rename:async()=>{throw Error('Injected atomic publish failure')}},failed=new OverlayPreferences(store.path,{io});await failed.ready
 await assert.rejects(failed.update({modelWatermarks:{}},failed.revision,async()=>({commit(){committed=true},rollback(){rolledBack=true}})))
 assert.ok(rolledBack&&!committed)
 const after=new OverlayPreferences(store.path);await after.ready;assert.deepEqual(after.value,restarted.value)
 for(const reason of ['cancel','timeout']){
  const local=new OverlayPreferences(join(fixture,reason+'.json'));await local.ready
  await local.update({modelPath:join(root,'index.js'),modelWatermarks:{[key]:record}},0)
  const calls=[],overlay={ready:true,dead:false,enabled:true,closed:false,activity:0,activated:false,capabilities:{watermark:true,management:true},runtime:{modelLoaded:true,userHidden:true},state:{status:'ready'},deferModelStartup:0}
  let started;const loading=new Promise(resolve=>{started=resolve})
  overlay.command=async(value,{signal}={})=>{calls.push(value.kind);if(value.kind==='get-watermark-gate')return{safe:true,modelToken:'current'};if(value.kind==='load-model'){started();return new Promise((_,reject)=>{const abort=()=>reject(Object.assign(Error('Canceled'),{code:'canceled'}));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true})})}return{}}
  const m=Object.create(OverlayManagement.prototype)
  Object.assign(m,{overlay,store:local,lifetime:new AbortController(),busy:null,load:null,manualPreview:null,motions:{active:null},ensureModelManagement:async()=>{},retireTemporary:async()=>{},models:{seenToken:'current',cache:{sourceProof:[]},snapshot(){},assertProof:async()=>{},watermarkPatch:()=>({modelWatermarks:{}})}})
  const before=structuredClone(local.value),keepAlive=setTimeout(()=>{},2000)
  try{const request=m.updatePreferences({modelWatermark:{catalogGeneration:generation,mode:'default'}},local.revision,reason==='timeout'?AbortSignal.timeout(100):undefined),rejected=assert.rejects(request,{code:'canceled'});await Promise.race([loading,request.then(()=>{throw Error('Expected pending model load')},error=>{throw error})]);if(reason==='cancel')m.load.abort();await rejected;assert.deepEqual(local.value,before);assert.equal(overlay.runtime.userHidden,true);assert.ok(!calls.includes('commit-model'));assert.equal(m.busy,null);assert.equal(m.load,null)}finally{clearTimeout(keepAlive)}
 }
}finally{if(!resolve(fixture).startsWith(resolve(base)+sep))throw Error('Unsafe fixture cleanup path');await rm(fixture,{recursive:true,force:true})}
console.log('Watermark regression passed: exact two-model authorization, Core proof/restoration, scoped persistence, UI controls, frozen-state guards and cancel/timeout rollback. Only mock models and isolated settings were used; no desktop runtime, actual models or real input were exercised.')
