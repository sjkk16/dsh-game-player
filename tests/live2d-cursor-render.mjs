// Synthetic cursor trajectories in hidden private model canvases. Never desktop pixels or OS input.
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {idleHarness,neutral} from './idle-render-harness.mjs'
import {comparePrivatePng} from './private-png.mjs'
const stability=process.argv.includes('--stability'),quick=process.argv.includes('--quick')
const out=resolve(process.env.DSH_CURSOR_QA_DIR??('.qa/cursor-follow-0.3.2/'+(quick?'transitions':stability?'stability':'continuous')));await mkdir(out,{recursive:true})
const h=await idleHarness(out),checks=[],reports=[],hashes=new Map()
const check=(v,name)=>{assert.ok(v,name);checks.push(name);console.log('PASS '+name)},hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex')
const files=async dir=>{let a=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())a.push(...await files(p));else if(e.isFile())a.push(p)}return a}
const watchdog=setTimeout(()=>h.child.kill(),(stability?750:quick?240:660)*1000)
let seq=0
const cursor=(token,x,y,extra={})=>h.call({kind:'qa-cursor',token,sequence:++seq,valid:true,x,y,...extra})
const headIds=catalog=>new Set(catalog.adapter.effects.filter(e=>e.enabled&&['headX','headY','headZ'].includes(e.role)).flatMap(e=>e.ids))
try{
 const cats=h.discover('../cat');check(cats.length===5,'Five original author ZIP candidates discovered read-only')
 for(const p of [...cats.map(c=>c.sourcePath),...await files(resolve('../Deepseek桌宠'))])hashes.set(p,await hash(p))
 const candidates=stability?[cats.find(c=>c.name.startsWith('达妮娅'))]:[...cats,{name:'default',sourcePath:resolve('../Deepseek桌宠')}]
 for(let i=0;i<candidates.length;i++){
  const c=candidates[i],catalog=await h.load(c),token=catalog.modelToken,heads=headIds(catalog)
  const origin=await h.step('m-'+i+'-origin');check(heads.size>0,'Verified visible head bindings exist for '+c.name)
  await cursor(token,-1,0);const left=await h.step('m-'+i+'-left',90)
  await cursor(token,1,0);const right=await h.step('m-'+i+'-right',90)
  const xId=catalog.adapter.effects.find(e=>e.role==='headX'&&e.enabled)?.ids[0],yId=catalog.adapter.effects.find(e=>e.role==='headY'&&e.enabled)?.ids[0]
  check(xId&&right.values[xId]>left.values[xId]+1e-3,'Actual head X parameters follow left/right system-cursor targets for '+c.name)
  const difference=comparePrivatePng(await readFile(join(out,'m-'+i+'-left.png')),await readFile(join(out,'m-'+i+'-right.png')))
  check(difference.changedChannels>difference.totalChannels*.001&&difference.maxDelta>1,'Continuously drawn head directions change actual pixels for '+c.name)
  await cursor(token,0,1);const up=await h.step('m-'+i+'-up',90);await cursor(token,0,-1);const down=await h.step('m-'+i+'-down',90)
  check(yId&&up.values[yId]>down.values[yId]+1e-3,'Actual head Y parameters follow up/down targets for '+c.name)
  const owned=new Set([...heads,...catalog.adapter.effects.filter(e=>e.enabled).flatMap(e=>e.ids),...Object.keys(down.diagnostics.physicsOutputs),...catalog.adapter.inputs.filter(e=>e.enabled&&['mouseX','mouseY'].includes(e.role)).map(e=>e.id)])
  check([left,right,up,down].every(s=>Object.entries(s.values).every(([id,v])=>owned.has(id)||Math.abs(v-origin.values[id])<1e-5)),'Cursor changes only enabled follow/effect axes, never click/key/style ownership for '+c.name)
  check([left,right,up,down].every(s=>Object.entries(s.visual.parts).every(([id,v])=>Math.abs(v-origin.visual.parts[id])<1e-5)),'Head following does not switch part visibility for '+c.name)
  const zero=await h.step('m-'+i+'-zero');const zeroPixels=comparePrivatePng(await readFile(join(out,'m-'+i+'-down.png')),await readFile(join(out,'m-'+i+'-zero.png')))
  assert.deepEqual(zero.values,down.values);check(zeroPixels.maxDelta<=2&&zeroPixels.changedChannels<=zeroPixels.totalChannels*1e-4,'Zero-time head repaint preserves geometry, masks and physics for '+c.name)
  await cursor('expired-model-token',1,1);const stale=await h.step('m-'+i+'-stale');assert.deepEqual(stale.values,zero.values);check(true,'Expired model cursor results cannot overwrite '+c.name)
  if(!quick){
   const durationMs=stability?600000:60000,before=await h.call({kind:'metrics'}),startIndex=h.events.length
   const sampleMs=stability?[0,2000,8000,12000,20000,30000,40000,59000,60000,180000,300000,599000,600000]:[0,2000,5000,8000,12000,20000,30000,40000,59000,60000]
   const run=await h.call({kind:'qa-run',name:'cursor-'+i,durationMs,state:neutral,cursorPath:'tour',sampleMs},durationMs+60000)
   const samples=h.events.slice(startIndex).filter(e=>e.kind==='qa-run-sample'),after=await h.call({kind:'metrics'})
   check(samples.length===sampleMs.length&&run.timing.elapsedMs>=durationMs,'All actual elapsed-time cursor frames recorded for '+c.name)
   check(run.timing.actualFps>=50&&run.timing.frames>=durationMs/1000*50,'No sustained idle FPS drop while cursor following for '+c.name)
   check(run.cursorAudit.frames===run.timing.frames&&run.cursorAudit.targets<=Math.ceil(durationMs/1000*30)+2,'Every frame evaluated; synthetic cursor sampled at most 30Hz for '+c.name)
   check(run.cursorAudit.maxAppearanceDrift<1e-5&&run.cursorAudit.maxPartDrift<1e-5&&run.cursorAudit.nonfiniteParameters===0,'No unauthorized appearance/part drift on any frame for '+c.name)
   check(run.cursorAudit.nonfiniteVertices===0&&run.cursorAudit.glErrors===0&&run.cursorAudit.geometryChecks>=durationMs/1000*3,'Periodic geometry and GL checks remain clean for '+c.name)
   check(samples.every(s=>s.diagnostics.parameterViewAligned&&s.diagnostics.viewMismatches.length===0&&s.diagnostics.nonfiniteVertices===0&&s.diagnostics.glError===0),'Sampled Core views, geometry and clipping stay synchronized for '+c.name)
   check(after.activeModels===1&&after.stagedModels===0&&after.textures===before.textures&&after.motions===before.motions&&after.handImages===before.handImages&&after.handPending===0&&run.timing.retainedSamples<=512,'Model/texture/hand/timing resources stay bounded for '+c.name)
   check(after.cursorSampling.reads===0&&!after.cursorSampling.timer,'Private canvas QA never polls the real system cursor for '+c.name)
   const last=await h.step('m-'+i+'-run-zero'),lastPixels=comparePrivatePng(await readFile(join(out,'cursor-'+i+'-'+(samples.length-1)+'.png')),await readFile(join(out,'m-'+i+'-run-zero.png')))
   check(lastPixels.maxDelta<=2&&lastPixels.changedChannels<=lastPixels.totalChannels*1e-4,'Final continuous-frame repaint is unchanged for '+c.name)
   reports.push({name:c.name,catalog,origin,left,right,up,down,zero,difference,zeroPixels,before,run,samples,after,lastPixels})
   console.log('RESULT '+JSON.stringify({name:c.name,fps:run.timing.actualFps,frames:run.timing.frames,targets:run.cursorAudit.targets,audit:run.cursorAudit}))
  }else reports.push({name:c.name,catalog,origin,left,right,up,down,zero,difference,zeroPixels})
 }
 if(quick){
  const catalog=await h.load({sourcePath:resolve('../Deepseek桌宠')}),token=catalog.modelToken
  await cursor(token,.7,-.6);const confirmed=await h.step('confirmed',90,{...neutral,mode:'real',keys:['a'],buttons:['left'],position:{x:.2,y:.3}})
  await cursor(token,-1,1);const frozen=await h.step('unknown',60,{...neutral,mode:'real',status:'unknown'});assert.deepEqual(frozen.values,confirmed.values);check(frozen.pose.frozen,'Cursor cannot bypass unknown input-state freeze')
  await h.step('preview',60,neutral);const locked=await h.step('locked',60,{...neutral,mode:'real',status:'locked'});assert.deepEqual(locked.values,confirmed.values);check(locked.pose.frozen,'Preview/cursor cannot poison the last confirmed real frame')
  const ready=await h.step('ready',30,{...neutral,mode:'real'});await new Promise(r=>setTimeout(r,1700));await cursor(token,1,-1)
  const expired=await h.call({kind:'qa-step',name:'heartbeat-expired',steps:60,dt:1/60,drawEachFrame:true});assert.deepEqual(expired.values,ready.values);check(expired.pose.frozen,'Cursor targets never refresh the AI-input heartbeat')
  await h.step('hidden',0,neutral,{visibility:false});const before=await h.call({kind:'metrics'});await new Promise(r=>setTimeout(r,350));const after=await h.call({kind:'metrics'});check(before.rendered===after.rendered&&!after.drawTimer&&!after.cursorSampling.timer&&after.cursorSampling.reads===0,'Hidden private display has zero continuous draws and zero cursor reads')
  const motions=await h.call({kind:'get-motions'}),first=motions.motions.filter(m=>m.enabled).sort((a,b)=>a.durationMs-b.durationMs)[0],ticket=randomUUID();check(!!first,'Default authored actions are still available')
  await h.call({kind:'play-motion',token,motionId:first.id,ticket});await cursor(token,-.5,.5);const playing=await h.step('playing',1);check(playing.motion?.ticket===ticket,'System-cursor messages do not cancel an explicit authored action')
  const stopped=await h.call({kind:'stop-motion'});await cursor(token,.5,-.5);const resumed=await h.step('resumed',90);check(!resumed.motion&&resumed.gaze.enabled&&resumed.gaze.x>.49,'Canceled action resumes smooth head following')
  await h.call({kind:'play-motion',token,motionId:first.id,ticket:randomUUID()});const ended=await h.step('ended',Math.min(1200,Math.ceil(first.durationMs/1000*60)+2));check(!ended.motion,'Authored action completes normally and returns to the idle pipeline')
  const replaced=await h.load(cats[0]);await cursor(token,1,1);const switched=await h.step('switched',30);check(!switched.gaze.enabled&&switched.values.CatParamLeftHandDown===0,'Model switching discards prior cursor, preview and input state')
  reports.push({confirmed,frozen,locked,ready,expired,playing,stopped,resumed,ended,switched})
 }
 for(const [p,before]of hashes)check(await hash(p)===before,'Original unchanged: '+p)
}finally{clearTimeout(watchdog);await writeFile(join(out,'stderr.log'),await h.close());await writeFile(join(out,'report.json'),JSON.stringify({stability,quick,checks,reports,desktopCaptured:false,realInputSent:false,inputHelperStarted:false,realCursorRead:false},null,2))}
console.log(checks.length+' private cursor-follow checks passed. User-visible host acceptance remains pending.')
