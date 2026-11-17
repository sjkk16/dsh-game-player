// Full native timer -> bounded channel -> WebView -> receipts, with a synthetic source only.
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {idleHarness,neutral} from './idle-render-harness.mjs'
import {comparePrivatePng} from './private-png.mjs'
const models=process.argv.includes('--models')||process.argv.includes('--all'),stability=process.argv.includes('--stability')||process.argv.includes('--all')
const out=resolve(process.env.DSH_CHANNEL_QA_DIR??'.qa/cursor-stall-0.3.3/'+(process.argv.includes('--all')?'all':models?'models':stability?'stability':'channel'))
await mkdir(out,{recursive:true});const h=await idleHarness(out),checks=[],reports=[],sleep=ms=>new Promise(r=>setTimeout(r,ms))
const check=(v,name)=>{assert.ok(v,name);checks.push(name);console.log('PASS '+name)}
const watchdog=setTimeout(()=>h.child.kill(),(models?480000:0)+(stability?690000:0)+240000)
const config=x=>h.call({kind:'qa-cursor-channel',...x}),metrics=()=>h.call({kind:'metrics'})
const pressureDone=async()=>{let m;for(let i=0;i<40;i++){m=await metrics();if(!m.cursorSampling.pressure?.running)return m;await sleep(50)}throw Error('Bounded native pressure did not finish: '+JSON.stringify(m.cursorSampling))}
const run=(name,durationMs,sampleMs=[0,durationMs],state=neutral)=>h.call({kind:'qa-run',name,durationMs,state,cursorPath:'native',sampleMs},durationMs+60000)
try{
 const cats=h.discover('../cat');check(cats.length===5,'Five author ZIP models are read-only candidates')
 await h.load({sourcePath:resolve('../Deepseek桌宠')})
 await config({enabled:true,tour:false,valid:true,x:-1,y:0,dropTargets:1,dropAcks:1})
 let start=h.events.length;const trial=run('fault-pressure',8000,[0,500,1000,2000,4000,6000,8000]);trial.catch(()=>{})
 await sleep(700);await config({valid:true,x:1,y:0})
 for(const [priority,durationMs] of [['Input',500],['Render',1500],['Input',3000]]){
  await h.call({kind:'qa-cursor-pressure',priority,durationMs});await sleep(durationMs+100)
  const m=await pressureDone(),p=m.cursorSampling.pressure;console.log('PRESSURE '+JSON.stringify(m.cursorSampling))
  check(!p.running&&p.normalSamples>=durationMs/1000*20,priority+' pressure preserves Normal-priority native sampling for '+durationMs+'ms')
  check(p.backgroundTicks<=1,'Legacy Background sampler is starved under '+priority+' pressure')
  check(m.cursorSampling.maxSampleGapMs<=100,'Native sampling stays below a 100ms gap under '+priority+' pressure')
 }
 const trialResult=await trial,m=await metrics(),samples=h.events.slice(start).filter(x=>x.kind==='qa-run-sample')
 check(m.cursorSampling.reads===0&&m.cursorSampling.samples>150,'Full native pipeline uses the synthetic source, zero OS cursor reads')
 check(m.cursorSampling.targetRecoveries>=1&&m.cursorSampling.ackRecoveries>=1,'Lost target and lost receipt recover through renderer progress')
 check(m.cursorSampling.queued<=1,'Native channel has at most one pending target')
 const changed=comparePrivatePng(await readFile(join(out,'fault-pressure-1.png')),await readFile(join(out,'fault-pressure-6.png')))
 check(changed.changedChannels>changed.totalChannels*.001,'Recovered native target changes actual private model pixels')
 check(trialResult.cursorAudit.nonfiniteParameters===0&&trialResult.cursorAudit.glErrors===0,'Pressure/fault frames preserve finite geometry and GL state')
 reports.push({name:'fault-pressure',native:m.cursorSampling,timing:trialResult.timing})
 // Run all requested pressure durations for both priorities.
 for(const [priority,durationMs] of [['Render',500],['Input',1500],['Render',3000]]){
  const drawing=run('pressure-'+priority+'-'+durationMs,durationMs+500)
  await h.call({kind:'qa-cursor-pressure',priority,durationMs});await sleep(durationMs+80);const p=(await pressureDone()).cursorSampling.pressure
  check(!p.running&&p.backgroundTicks<=1&&p.normalSamples>=durationMs/1000*20,'Old/new priority comparison '+priority+' '+durationMs+'ms');await drawing
 }
 await h.call({kind:'control',action:'hide'});const hidden=await metrics();await run('hidden-channel',500);const held=await metrics()
 check(!held.cursorSampling.timer&&held.cursorSampling.samples===hidden.cursorSampling.samples,'Hidden native sampler performs zero reads or synthetic sampling')
 await h.call({kind:'control',action:'show'});await run('resume-channel',700);const resumed=await metrics()
 check(resumed.cursorSampling.samples>held.cursorSampling.samples&&resumed.cursorSampling.reads===0,'Same-model show resumes the fenced channel without real cursor access')

 const real=await run('native-real-confirmed',500,[500],{...neutral,mode:'real',keys:['a'],buttons:['left'],position:{x:.2,y:.3}})
 const confirmed=h.events.filter(e=>e.kind==='qa-run-sample'&&e.name==='native-real-confirmed-0').at(-1)
 await config({valid:true,x:-1,y:1});await run('native-unknown',500,[500],{...neutral,mode:'real',status:'unknown'})
 const unknown=h.events.filter(e=>e.kind==='qa-run-sample'&&e.name==='native-unknown-0').at(-1)
 assert.deepEqual(unknown.values,confirmed.values);check(unknown.pose.frozen,'Native progress/targets cannot bypass unknown-state freeze')
 await run('native-preview',500);await run('native-locked',500,[500],{...neutral,mode:'real',status:'locked'})
 const locked=h.events.filter(e=>e.kind==='qa-run-sample'&&e.name==='native-locked-0').at(-1)
 assert.deepEqual(locked.values,confirmed.values);check(locked.pose.frozen,'Native progress/preview cannot poison the last confirmed real frame')
 await run('native-motion-ready',300);const motions=await h.call({kind:'get-motions'}),motion=motions.motions.filter(m=>m.enabled).sort((a,b)=>a.durationMs-b.durationMs)[0]
 if(!motion)throw Error('Default model requires an authored action');await h.call({kind:'play-motion',token:motions.modelToken,motionId:motion.id,ticket:randomUUID()})
 await config({valid:true,x:1,y:-1});await run('native-playing',100,[100]);const playing=h.events.filter(e=>e.kind==='qa-run-sample'&&e.name==='native-playing-0').at(-1)
 check(!!playing.motion,'Native cursor targets and progress do not cancel authored actions');await h.call({kind:'stop-motion'});await run('native-action-resumed',500,[500]);const afterMotion=h.events.filter(e=>e.kind==='qa-run-sample'&&e.name==='native-action-resumed-0').at(-1)
 check(!afterMotion.motion&&afterMotion.gaze.x>.8,'Action cancellation restores native head following')
 await h.call({kind:'play-motion',token:motions.modelToken,motionId:motion.id,ticket:randomUUID()});await run('native-action-finished',Math.min(10500,motion.durationMs+300));check(!h.events.filter(e=>e.kind==='qa-run-sample'&&e.name==='native-action-finished-1').at(-1).motion,'Authored action finishes normally with the native channel active')
 await config({enabled:false});const stop=await metrics();await run('stopped-channel',500);const stopped=await metrics()
 check(!stopped.cursorSampling.timer&&stopped.cursorSampling.samples===stop.cursorSampling.samples,'Explicit QA stop cancels the single sampler')
 const candidates=models?[...cats,{name:'default',sourcePath:resolve('../Deepseek桌宠')}]:[]
 if(stability)candidates.push(process.env.DSH_CURSOR_STABILITY_MODEL==='default'?{name:'default',sourcePath:resolve('../Deepseek桌宠'),stability:true}:{...cats.find(c=>c.name.startsWith('达妮娅')),stability:true})
 for(let i=0;i<candidates.length;i++){
  const c=candidates[i],catalog=await h.load(c),duration=c.stability?600000:60000,name='native-model-'+i
  await config({enabled:true,tour:true,dropAcks:0,dropTargets:0});const before=await metrics(),at=h.events.length
  const sampleMs=c.stability?[0,2000,5000,8000,12000,20000,30000,40000,59000,60000,180000,300000,599000,600000]:[0,2000,5000,8000,12000,20000,30000,40000,59000,60000]
  const result=await run(name,duration,sampleMs),after=await metrics(),frames=h.events.slice(at).filter(x=>x.kind==='qa-run-sample'),a=result.cursorAudit
  check(result.timing.elapsedMs>=duration&&frames.length===sampleMs.length,'Actual elapsed-time per-frame native tour completed for '+c.name+' '+duration+'ms')
  check(result.timing.actualFps>=55,'Visible-target 60FPS private drawing remains stable for '+c.name)
  check(after.cursorSampling.samples>=duration/1000*25&&after.cursorSampling.maxSampleGapMs<=100,'Native 30Hz monotonic sampler remains continuous for '+c.name)
  check(after.cursorSampling.maxWaitMs<=250&&after.cursorSampling.targetRecoveries===0,'Normal native delivery has no >250ms waits or fallback for '+c.name)
  check(after.cursorSampling.reads===0&&after.cursorSampling.queued<=1,'No OS cursor read or queue growth for '+c.name)
  check(a.frames===result.timing.frames&&a.nonfiniteParameters===0&&a.nonfiniteVertices===0&&a.glErrors===0,'Every frame and periodic geometry audited for '+c.name)
  check(a.maxAppearanceDrift<1e-5&&a.maxPartDrift<1e-5,'No unauthorized appearance or part-opacity drift for '+c.name)
  const axes=catalog.adapter.inputs.filter(e=>e.enabled&&['mouseX','mouseY'].includes(e.role))
  check(axes.length===2&&a.handOutOfRange===0&&a.maxHandError<1e-4,'Every drawn frame uses the bounded system-cursor hand pose for '+c.name)
  check(frames.every(f=>Object.entries(f.diagnostics.cursorHandFollow.values).every(([id,v])=>Math.abs(f.values[id]-v)<1e-4)),'Sampled hand pose matches the smoothed native cursor for '+c.name)
  for(const axis of axes)check(Math.abs(frames[2].values[axis.id]-frames[4].values[axis.id])>1e-3,'Native hand axis '+axis.role+' moves for '+c.name)
  const pixels=comparePrivatePng(await readFile(join(out,name+'-2.png')),await readFile(join(out,name+'-3.png')))
  check(pixels.changedChannels>pixels.totalChannels*.001,'Native horizontal direction changes actual pixels for '+c.name)
  const x=catalog.adapter.effects.find(e=>e.role==='headX'&&e.enabled)?.ids[0],y=catalog.adapter.effects.find(e=>e.role==='headY'&&e.enabled)?.ids[0]
  check(x&&Math.abs(frames[2].values[x]-frames[3].values[x])>1e-3&&y&&Math.abs(frames[0].values[y]-frames[4].values[y])>1e-3,'Native horizontal and vertical head parameters change for '+c.name)
  for(const key of ['textures','activeModels','handImages','handPixels','motions'])check(after[key]===before[key],'Resource '+key+' stays constant for '+c.name)
  reports.push({name:c.name,durationMs:duration,timing:result.timing,audit:a,native:after.cursorSampling});console.log('RESULT '+JSON.stringify(reports.at(-1)));await config({enabled:false})
 }
}finally{clearTimeout(watchdog);await writeFile(join(out,'stderr.log'),await h.close());await writeFile(join(out,'report.json'),JSON.stringify({checks,reports,realCursorReads:0,desktopCaptured:false,realInputSent:false,inputHelperStarted:false,syntheticSource:true,nativeSamplingAndTransport:true,privateCanvasNotFieldAcceptance:true},null,2))}
console.log('Native cursor channel checks: '+checks.length)
