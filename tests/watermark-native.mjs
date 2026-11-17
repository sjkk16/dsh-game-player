// Real hidden WebView/Core; synthetic cursor targets only, never OS input or desktop pixels.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {idleHarness,neutral} from './idle-render-harness.mjs'
import {comparePrivatePng} from './private-png.mjs'
import {OverlayPreferences} from '../src/overlay-preferences.js'
import {OverlayManagement} from '../src/overlay-management.js'
import {OverlayModels} from '../src/overlay-models.js'
import {AUTHORIZED_WATERMARKS} from '../src/live2d/watermark.js'
const out=resolve(process.env.DSH_WATERMARK_QA_DIR??'.qa/watermark-0.3.4/native');await mkdir(out,{recursive:true})
const h=await idleHarness(out,process.env.DSH_IDLE_DESKTOP_DLL),checks=[],reports=[];const check=(v,n)=>{assert.ok(v,n);checks.push(n);console.log('PASS '+n)}
const deadline=setTimeout(()=>h.child.kill(),300000)
const stagedLoad=async(c,watermarks={})=>{const r=await h.call({kind:'load-model',modelPath:c.sourcePath,modelEntry:c.entry,watermarks});await h.call({kind:'commit-model'});return r}
try{
 const cats=h.discover('../cat'),allowed=cats.filter(c=>/清宵|达妮娅/.test(c.name));check(allowed.length===2,'Two authorized author models discovered read-only')
 for(const c of cats){const a=await stagedLoad(c);check(a.adapter.watermark.supported===allowed.includes(c),'Only the exact two content hashes are eligible: '+c.name)}
 for(let i=0;i<allowed.length;i++){
  const c=allowed[i],base='model-'+i,a=await stagedLoad(c),w=a.adapter.watermark,record={[a.modelKey]:{mode:'hidden',mocHash:w.mocHash}};
  check(Object.hasOwn(AUTHORIZED_WATERMARKS,w.mocHash)&&w.mode==='default','Content hash and default validated '+c.name)
  const defaults=await h.step(base+'-default');const hidden=await stagedLoad(c,record),hiddenFrame=await h.step(base+'-hidden');
  check(hidden.adapter.watermark.mode==='hidden'&&hiddenFrame.values.Paramshuiying===1,'Native load confirms hidden mode '+c.name)
  check(JSON.stringify(defaults.bounds)===JSON.stringify(hiddenFrame.bounds),'Author framing unchanged '+c.name)
  check(JSON.stringify(defaults.visual.parts)===JSON.stringify(hiddenFrame.visual.parts),'Part state unchanged '+c.name)
  const diff=comparePrivatePng(await readFile(join(out,base+'-default.png')),await readFile(join(out,base+'-hidden.png')));check(diff.changedChannels>100,'Real model pixels remove author overlay '+c.name)
  for(const status of ['unknown','locked']){const f=await h.step(base+'-'+status,10,{...neutral,mode:'real',status});check(f.values.Paramshuiying===1&&f.pose.frozen,'Frozen frames retain static preference without unfreezing '+status+' '+c.name)}
  const before=await h.call({kind:'metrics'}),start=h.events.length;
  const run=await h.call({kind:'qa-run',name:base+'-continuous',durationMs:60000,state:neutral,cursorPath:'tour',sampleMs:[0,2000,5000,20000,60000]},125000);
  const after=await h.call({kind:'metrics'}),samples=h.events.slice(start).filter(m=>m.kind==='qa-run-sample');
  check(run.timing.elapsedMs>=60000&&run.timing.frames>=3300,'60 seconds of actual per-frame drawing '+c.name)
  check(samples.length===5&&samples.every(s=>s.values.Paramshuiying===1),'Hidden mode stable at start/2/5/20/60 seconds '+c.name)
  check(run.cursorAudit.maxAppearanceDrift<1e-5&&run.cursorAudit.maxPartDrift<1e-5&&run.cursorAudit.nonfiniteVertices===0&&run.cursorAudit.glErrors===0,'No unrelated appearance/parts/geometry/GL drift '+c.name)
  check(after.textures===before.textures&&after.activeModels===1&&after.stagedModels===0&&after.cursorSampling.reads===0,'Bounded resources and zero real cursor reads '+c.name)
  await h.step(base+'-hide',0,neutral,{visibility:false});const paused=await h.call({kind:'metrics'});await new Promise(r=>setTimeout(r,300));const stopped=await h.call({kind:'metrics'});check(stopped.rendered===paused.rendered&&!stopped.cursorSampling.timer,'Hidden zero continuous drawing/sampling '+c.name)
  await stagedLoad(c,record);const resumed=await h.step(base+'-resume');check(resumed.values.Paramshuiying===1,'Reload/resume restores own preference '+c.name)
  await stagedLoad(c);const restored=await h.step(base+'-restored');check(restored.values.Paramshuiying===0,'Restore author default '+c.name)
  await assert.rejects(stagedLoad(c,{[a.modelKey]:{mode:'hidden',mocHash:'0'.repeat(64)}}));check(true,'Changed saved content rejected rather than silently hidden '+c.name)
  reports.push({name:c.name,mocHash:w.mocHash,diff,run,samples,before,after})
 }
 // Real settings transaction drives native preload, commit, confirmation and rollback.
 const c=allowed[0],store=new OverlayPreferences(join(out,'transaction-settings.json'));await store.ready;await store.update({modelPath:c.sourcePath,modelEntry:c.entry},store.revision)
 const overlay={ready:true,dead:false,enabled:true,activity:0,activated:false,deferModelStartup:0,capabilities:{management:true,adaptation:true,archives:true,watermark:true},state:neutral,realState:{session:null},runtime:{},defaultModel:c.sourcePath,changed(){},holdVisibility(){return()=>{}}};
 const sync=()=>{overlay.runtime=h.events.filter(e=>e.kind==='status').at(-1)?.state??overlay.runtime}
 let failCommit=false
 overlay.command=async(value)=>{if(failCommit&&value.kind==='commit-model'){failCommit=false;throw Error('Injected commit confirmation failure')}const r=await h.call(value);sync();return r}
 const m=Object.create(OverlayManagement.prototype);Object.assign(m,{store,overlay,io:await import('node:fs/promises'),lifetime:new AbortController(),busy:null,load:null,manualPreview:null,lastError:null,motions:{active:null,invalidate(){}},ensureModelManagement:async()=>{},retireTemporary:async()=>{}});m.models=new OverlayModels(m)
 await stagedLoad(c);sync();m.models.accept(await h.call({kind:'get-adapter'}));const initial=store.revision
 await m.updatePreferences({modelWatermark:{catalogGeneration:m.models.cache.generation,mode:'hidden'}},initial)
 check(store.value.modelWatermarks[m.models.cache.modelKey].mode==='hidden','RPC validates and atomically persists the actual native hidden result')
 await h.step('real-confirmed-input',1,{...neutral,mode:'real',keys:['a']});await new Promise(r=>setTimeout(r,1700));
 const gate=await h.call({kind:'get-watermark-gate',token:m.models.seenToken});check(!gate.safe,'Renderer-expired real heartbeat blocks watermark edits even if Host status is stale');
 await assert.rejects(m.updatePreferences({modelWatermark:{catalogGeneration:m.models.cache.generation,mode:'default'}},store.revision),{code:'busy'});check(true,'Watermark RPC does not refresh a stale AI input heartbeat');
 await h.step('confirmed-input-recovered',0,neutral);
 const disk=new OverlayPreferences(store.path);await disk.ready;check(JSON.stringify(disk.value.modelWatermarks)===JSON.stringify(store.value.modelWatermarks),'Real restart/re-read preserves watermark records')
 await assert.rejects(m.updatePreferences({modelWatermark:{catalogGeneration:m.models.cache.generation,mode:'default'}},initial),{code:'preference_conflict'});check(true,'Old preference revision cannot overwrite newer mode')
 const previous=structuredClone(store.value);failCommit=true;await assert.rejects(m.updatePreferences({modelWatermark:{catalogGeneration:m.models.cache.generation,mode:'default'}},store.revision));check(JSON.stringify(store.value)===JSON.stringify(previous),'Commit failure rolls back the entire persisted preference value')
 const actual=await h.call({kind:'get-adapter'});check(actual.adapter.watermark.mode==='hidden','Commit failure restores the previous real native model')
 sync();m.models.accept(actual);overlay.state={status:'locked'};await assert.rejects(m.updatePreferences({modelWatermark:{catalogGeneration:m.models.cache.generation,mode:'default'}},store.revision),{code:'busy'});check(true,'Public switch cannot bypass locked state')
 overlay.state=neutral;await m.updatePreferences({modelWatermark:{catalogGeneration:m.models.cache.generation,mode:'default'}},store.revision);check(Object.keys(store.value.modelWatermarks).length===0,'Restore default removes only the selected saved record')
 check((await h.call({kind:'metrics'})).cursorSampling.reads===0,'All native checks perform zero GetCursorPos calls')
}finally{clearTimeout(deadline);await writeFile(join(out,'stderr.log'),await h.close());await writeFile(join(out,'report.json'),JSON.stringify({checks,reports,realCursorReads:0,inputHelperStarted:false,desktopCaptured:false,realInputSent:false},null,2))}
console.log(checks.length+' watermark native checks passed; field acceptance remains pending.')
