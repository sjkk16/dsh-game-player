import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {idleHarness,neutral} from './idle-render-harness.mjs'
import {comparePrivatePng} from './private-png.mjs'
const baseline=process.argv.includes('--baseline'),out=resolve(process.env.DSH_TRANSITION_QA_DIR??('.qa/idle-fix-0.3.1/'+(baseline?'zero-baseline':'transitions')));await mkdir(out,{recursive:true})
const h=await idleHarness(out),checks=[],reports=[]
const check=(v,name)=>{assert.ok(v,name);checks.push(name);console.log('PASS '+name)},hash=async name=>createHash('sha256').update(await readFile(join(out,name+'.png'))).digest('hex')
const watchdog=setTimeout(()=>h.child.kill(),180000)
try{
 const cats=h.discover('../cat'),c=cats.find(c=>c.name.startsWith('清宵'));await h.load(c)
 const run=await h.call({kind:'qa-run',name:'zero',durationMs:4000,state:neutral,sampleMs:[0,3080,4000]},20000),zero=await h.step('zero-redraw'),diff=Object.entries(run.diagnostics.physicsOutputs).filter(([id,p])=>Math.abs(zero.values[id]-p.value)>1e-5)
 const pixelDifference=comparePrivatePng(await readFile(join(out,'zero-2.png')),await readFile(join(out,'zero-redraw.png'))),pixelsEqual=pixelDifference.maxDelta<=1&&pixelDifference.changedChannels<=pixelDifference.totalChannels*1e-4;reports.push({run,zero,zeroDifferences:diff,pixelsEqual,pixelDifference})
 if(baseline){check(diff.length>0,'Old runtime reproduces physics loss on zero-time redraw');check(!pixelsEqual,'Old runtime changes rendered pixels during a zero-time redraw')}
 else{
  check(diff.length===0,'Zero-time redraw does not reset physical output')
  check(pixelsEqual,'Identical state repaints identical geometry, clipping masks and pixels')
  const held=await h.step('held',6,{...neutral,mode:'real',keys:['a'],buttons:['left'],position:{x:1,y:0}})
  check(held.values.CatParamLeftHandDown===1&&held.values.ParamMouseLeftDown===1,'Confirmed synthetic input retains its dedicated bindings')
  const frozen=await h.step('frozen',20,{...neutral,mode:'real',status:'unknown'});assert.deepEqual(frozen.values,held.values);check(frozen.pose.frozen,'Unknown status freezes the confirmed visual state')
  await h.step('preview',20,{...neutral,position:{x:0,y:1}})
  const locked=await h.step('locked',20,{...neutral,mode:'real',status:'locked'});assert.deepEqual(locked.values,held.values);check(locked.pose.frozen,'Preview does not poison the last confirmed real state')
  await h.call({kind:'qa-prepare',state:{...neutral,mode:'real'}})
  const released=await h.step('released',0,{...neutral,mode:'real',status:'unknown'});check(released.values.CatParamLeftHandDown===0&&released.values.ParamMouseLeftDown===0,'Confirmed hidden releases update frozen input correctly')
  await h.step('hide',0,neutral,{visibility:false});const before=await h.call({kind:'metrics'});await new Promise(r=>setTimeout(r,500));const after=await h.call({kind:'metrics'});check(after.rendered===before.rendered&&!after.drawTimer,'Hidden model retains no continuous draw request')
  const noEffects={...c,adapter:{effects:Object.fromEntries(['blink','breath','headX','headY','headZ','bodyX','bodyY','bodyZ'].map(role=>[role,{ids:[]}]))}};await h.load(noEffects)
  const staticBefore=await h.step('static-before'),staticAfter=await h.step('static-after',600);assert.ok(Object.entries(staticAfter.values).every(([id,v])=>Math.abs(v-staticBefore.values[id])<1e-7));const control=comparePrivatePng(await readFile(join(out,'static-before.png')),await readFile(join(out,'static-after.png')));check(control.maxDelta<=1&&control.changedChannels<=control.totalChannels*1e-4,'No-effects control remains visually stable over ten simulated seconds, drawing every frame')
  let sixty,fifteen;for(const fps of [60,15]){await h.load(c);const f=await h.step('rate-'+fps,fps*2,neutral,{dt:1/fps});if(fps===60)sixty=f;else fifteen=f}
  check(Math.abs(sixty.physicsSeconds-fifteen.physicsSeconds)<1e-6&&sixty.physicsSteps===120&&fifteen.physicsSteps===30,'One author-FPS physics call per rendered frame advances equal physical time at 15/60 FPS')
  await h.load({sourcePath:resolve('../Deepseek桌宠')});const catalog=await h.call({kind:'get-motions'});check(catalog.motions.some(m=>m.enabled),'Default authored motions remain available')
  const first=catalog.motions.find(m=>m.enabled),ticket=randomUUID();await h.call({kind:'play-motion',token:catalog.modelToken,motionId:first.id,ticket});const motion=await h.step('motion',30);check(motion.motion?.ticket===ticket,'Explicit authored motion still advances')
  await h.call({kind:'stop-motion'});const stopped=await h.step('stopped');check(!stopped.motion,'Stopping motion returns to the idle pipeline')
  const changing=h.call({kind:'qa-run',name:'canceled',durationMs:60000,state:neutral,sampleMs:[0]},70000).then(()=>false,()=>true);await new Promise(r=>setTimeout(r,100));await h.call({kind:'qa-run-cancel'});check(await changing,'Private continuous runs are bounded and cancelable')
  await h.load(c);const switched=await h.step('switched');check(switched.values.CatParamLeftHandDown===0&&switched.diagnostics.viewMismatches.length===0,'Switching models cannot reuse prior motion/input parameter state')
  reports.push({held,frozen,locked,released,staticBefore,staticAfter,sixty,fifteen,motion,stopped,switched})
 }
}finally{clearTimeout(watchdog);await writeFile(join(out,'stderr.log'),await h.close());await writeFile(join(out,'report.json'),JSON.stringify({baseline,checks,reports,desktopCaptured:false,realInputSent:false,inputHelperStarted:false},null,2))}
console.log(checks.length+' native private transition checks passed.')
