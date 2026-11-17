import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {idleHarness,neutral} from './idle-render-harness.mjs'
const baseline=process.argv.includes('--baseline'),stability=process.argv.includes('--stability')
const out=resolve(process.env.DSH_IDLE_QA_DIR??('.qa/idle-fix-0.3.1/'+(baseline?'baseline':stability?'stability':'continuous')));await mkdir(out,{recursive:true})
const h=await idleHarness(out),reports=[],checks=[],hashes=new Map()
const check=(value,name)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex')
const files=async dir=>{const list=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())list.push(...await files(p));else if(e.isFile())list.push(p)}return list}
const watchdog=setTimeout(()=>h.child.kill(),(stability?750:baseline?150:540)*1000)
try{
 const cats=h.discover('../cat');check(cats.length===5,'Five existing author ZIP candidates discovered read-only')
 for(const p of [...cats.map(c=>c.sourcePath),...await files(resolve('../Deepseek桌宠'))])hashes.set(p,await hash(p))
 const candidates=baseline?[cats.find(c=>c.name.startsWith('清宵'))]:stability?[cats.find(c=>c.name.startsWith('达妮娅'))]:[...cats,{name:'default',sourcePath:resolve('../Deepseek桌宠')}]
 for(let i=0;i<candidates.length;i++){
  const c=candidates[i],catalog=await h.load(c),durationMs=stability?600000:60000
  const before=await h.call({kind:'metrics'}),startIndex=h.events.length
  console.log('RUN '+c.name+' '+durationMs/1000+' wall-clock seconds, actual per-frame update/draw')
  const run=await h.call({kind:'qa-run',name:'model-'+i,durationMs,state:neutral,sampleMs:stability?[0,2000,5000,20000,60000,300000,600000]:[0,2000,3080,5000,20000,60000]},durationMs+60000)
  const samples=h.events.slice(startIndex).filter(e=>e.kind==='qa-run-sample'),after=await h.call({kind:'metrics'})
  const zero=await h.step('model-'+i+'-zero'),zeroDifferences=Object.entries(run.diagnostics.physicsOutputs).filter(([id,p])=>Math.abs(zero.values[id]-p.value)>1e-5)
  reports.push({name:c.name,catalog,before,run,samples,after,zero,zeroDifferences})
  if(!baseline)check(zeroDifferences.length===0,'Zero-time redraw preserves the last physics output for '+c.name)
  check(samples.length===(stability?7:6),'All elapsed-time private frames recorded for '+c.name)
  check(run.timing.elapsedMs>=durationMs&&run.timing.frames>=durationMs/1000*(stability?25:50),'Continuous wall-clock drawing occurred for '+c.name)
  if(!baseline){
   check(samples.every(s=>s.diagnostics.parameterViewAligned&&s.diagnostics.viewMismatches.length===0),'Core and Framework parameter views agree for '+c.name)
   check(samples.every(s=>s.diagnostics.nonfiniteVertices===0&&s.diagnostics.glError===0&&s.diagnostics.visibleDrawables>0),'Finite geometry and valid GL throughout '+c.name)
   check(run.timing.retainedSamples<=512,'Timing samples stay bounded for '+c.name)
   check(after.activeModels===1&&after.stagedModels===0&&after.textures===before.textures&&after.motions===before.motions&&after.handImages===0,'Model/texture/motion/hand resource counts stay stable for '+c.name)
   const initial=samples[0].values,allowed=new Set([...catalog.adapter.inputs.filter(x=>x.enabled).map(x=>x.id),...catalog.adapter.effects.filter(x=>x.enabled).flatMap(x=>x.ids),...Object.keys(samples[0].diagnostics.physicsOutputs)])
   check(samples.every(s=>Object.entries(s.values).every(([id,v])=>Number.isFinite(v)&&(allowed.has(id)||Math.abs(v-initial[id])<1e-5))),'Unowned appearance parameters do not drift for '+c.name)
   check(samples.every(s=>Object.entries(s.visual.parts).every(([id,v])=>Math.abs(v-samples[0].visual.parts[id])<1e-5)),'Idle part visibility is not changed for '+c.name)
  }
  console.log('RESULT '+JSON.stringify({name:c.name,fps:run.timing.actualFps,frameInterval:run.timing.frameInterval,update:run.timing.update,draw:run.timing.draw,viewMismatches:run.diagnostics.viewMismatches.length,physicsEnabled:run.diagnostics.physicsEnabled}))
 }
 for(const [p,before]of hashes)check(await hash(p)===before,'Original unchanged: '+p)
}finally{
 clearTimeout(watchdog);const stderr=await h.close();await writeFile(join(out,'stderr.log'),stderr);await writeFile(join(out,'report.json'),JSON.stringify({baseline,stability,checks,reports,desktopCaptured:false,realInputSent:false,inputHelperStarted:false},null,2))
}
console.log(checks.length+' actual private-canvas checks passed. Real visible host acceptance remains pending.')
