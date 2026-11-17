// Real page + official Core in an invisible QA WebView. No OS input/capture.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {idleHarness,neutral} from './idle-render-harness.mjs'
import {decodePrivatePng,comparePrivatePng} from './private-png.mjs'
import {readQaPreferences,loadPreferenceModel} from './current-model-fixture.mjs'
const out=resolve(process.env.DSH_VIEWPORT_QA_DIR??'.qa/model-viewport-20261114/native');await mkdir(out,{recursive:true})
const h=await idleHarness(out),checks=[],reports=[],sleep=ms=>new Promise(r=>setTimeout(r,ms))
const check=(value,name)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
const preferences=(width,visible=true)=>h.call({kind:'preferences',preferences:{view:'model',widthDip:width,keyboardWidthDip:900,opacity:1,controlMode:'adaptive',modelInfoVisible:visible},revision:0})
const base={...neutral,controlMode:'adaptive',lastActor:'human'}
const watchdog=setTimeout(()=>h.child.kill(),180000)
try {
 const stored=await readQaPreferences()
 const models=[{name:'current',sourcePath:stored.modelPath,entry:stored.modelEntry},{name:'default',sourcePath:resolve('../Deepseek桌宠')}]
 for(const candidate of models){
  if(candidate.name==='current')await loadPreferenceModel(h,stored);else await h.load(candidate)
  for(const {width,dpr} of [{width:220,dpr:1},{width:239,dpr:1},{width:420,dpr:1},{width:1000,dpr:1},{width:239,dpr:1.5},{width:239,dpr:2}]){
   await preferences(width);await h.call({kind:'qa-layout',width,dpr});await sleep(120)
   const prefix=candidate.name+'-'+width+'-dpr'+String(dpr).replace('.','_')
   const first=await h.step(prefix+'-idle',0,base),layout=first.diagnostics.layout,projection=first.diagnostics.projection
   assert.equal(layout.viewport.dpr,dpr);check(Math.abs(layout.viewport.width-width)<=1&&Math.abs(layout.viewport.height-(width+76))<=1,'Actual hidden page uses requested logical dimensions '+prefix)
   check(Math.abs(layout.identity.height-28)<.1&&Math.abs(layout.statusPanel.height-48)<.1,'Identity/status slots stay 28/48 px '+prefix)
   check(Math.abs(layout.canvas.width-layout.canvas.height)<=1,'The model viewport remains square '+prefix)
   const assertStable=(f,name)=>{
    const l=f.diagnostics.layout
    assert.deepEqual(l.canvas,layout.canvas,name+' canvas changed');assert.deepEqual(l.hands,layout.hands,name+' hands changed');assert.deepEqual(f.diagnostics.projection,projection,name+' projection changed')
    assert.equal(l.statusPanel.height,48);assert.equal(l.horizontalOverflow,false);assert.ok(l.statusPanel.scrollWidth<=l.statusPanel.clientWidth,'status horizontal overflow')
    assert.equal(f.diagnostics.glError,0);assert.equal(f.diagnostics.nonfiniteVertices,0)
    reports.push({name,layout:l,projection:f.diagnostics.projection});return f
   }
   const held=assertStable(await h.step(prefix+'-active',6,{...base,keys:['ctrl','shift','a','w','s','d'],buttons:['left','right'],moveMs:100,wheelMs:100,wheelDirection:1,textMs:100}),prefix+' active')
   const afterglow=assertStable(await h.step(prefix+'-afterglow',0,{...base,pulses:[{id:'key:a',ms:50}]}),prefix+' afterglow')
   await sleep(80);assertStable(await h.call({kind:'qa-step',name:prefix+'-expiry',steps:0}),prefix+' expiry')
   assertStable(await h.step(prefix+'-rest',60,base),prefix+' stop input')
   const long=assertStable(await h.step(prefix+'-long',0,{...base,externalInput:true,humanError:'外部输入状态提示与一段没有分隔符的长内容 '+ 'long-unbroken-value'.repeat(30)}),prefix+' long text')
   check(long.diagnostics.layout.statusPanel.scrollHeight>48,'Long status is scrollable, not clipped '+prefix)
   await preferences(width,false)
   const hidden=assertStable(await h.step(prefix+'-hidden',0,{...base,externalInput:true}),prefix+' hide info')
   check(!hidden.diagnostics.layout.footer.visible&&hidden.diagnostics.layout.notes.visible&&!hidden.diagnostics.layout.capabilitiesVisible,'Hiding info preserves independent safety notes '+prefix)
   const locked=assertStable(await h.step(prefix+'-locked',0,{...base,status:'locked',humanError:'诊断提示 '.repeat(30)}),prefix+' locked')
   check(locked.diagnostics.layout.footer.visible&&locked.diagnostics.layout.activity.y<=locked.diagnostics.layout.statusPanel.y+8&&locked.diagnostics.layout.statusPanel.scrollTop===0,'Warning is visible first, including hidden-info mode '+prefix)
   const unknown=assertStable(await h.step(prefix+'-unknown',0,{...base,status:'unknown'}),prefix+' unknown')
   assert.deepEqual(unknown.values,locked.values,'Unknown freeze altered parameters')
   await preferences(width,true)
   assertStable(await h.step(prefix+'-visible',0,base),prefix+' show info')
   const png=decodePrivatePng(await readFile(join(out,prefix+'-visible.png')))
   check(png.width===layout.canvas.pixelWidth&&png.height===layout.canvas.pixelHeight,'Native canvas pixels match layout diagnostics '+prefix)
   check(held.diagnostics.viewMismatches.length===0&&afterglow.diagnostics.viewMismatches.length===0,'Core and framework state remain synchronized '+prefix)
  }
 }
 // Existing real-input freeze, motion and zero-time behavior still uses the unchanged pipeline.
 await h.load({sourcePath:resolve('../Deepseek桌宠')});await h.call({kind:'qa-layout',width:239});await sleep(120)
 const confirmed=await h.step('confirmed',6,{...base,mode:'real',keys:['a'],buttons:['left']})
 const frozen=await h.step('frozen',20,{...base,mode:'real',status:'unknown'});assert.deepEqual(frozen.values,confirmed.values);check(frozen.pose.frozen,'Real confirmed state is retained when input becomes unknown')
 const live=await h.step('live',60,base),zero=await h.call({kind:'qa-step',name:'zero',steps:0})
 const pixels=comparePrivatePng(await readFile(join(out,'live.png')),await readFile(join(out,'zero.png')))
 check(pixels.maxDelta<=1&&pixels.changedChannels<=pixels.totalChannels*1e-4,'Zero-time repaint preserves geometry and clipping')
 const catalog=await h.call({kind:'get-motions'}),motion=catalog.motions.find(m=>m.enabled);assert.ok(motion)
 await h.call({kind:'play-motion',token:catalog.modelToken,motionId:motion.id,ticket:randomUUID()})
 const moving=await h.step('motion',6,base);await h.call({kind:'stop-motion'});const stopped=await h.step('stopped',0,base)
 check(!!moving.motion&&!stopped.motion,'Authored motion playback and stop remain available')
 assert.deepEqual(moving.diagnostics.projection,stopped.diagnostics.projection);check(true,'Stopping a motion does not alter projection')
 const playing=await h.call({kind:'play-motion',token:catalog.modelToken,motionId:motion.id,ticket:randomUUID()})
 const finished=await h.call({kind:'qa-step',name:'finished',state:base,steps:Math.ceil(playing.durationMs/100)+1,dt:.1,drawEachFrame:true})
 check(!finished.motion,'Authored motion naturally completes and returns to idle')
 assert.deepEqual(finished.diagnostics.projection,stopped.diagnostics.projection);check(true,'Natural motion completion preserves model scale')
 const metrics=await h.call({kind:'metrics'});check(metrics.cursorSampling.reads===0&&!metrics.cursorSampling.timer,'QA never samples real system cursor')
 await assert.rejects(h.call({kind:'qa-layout',width:219}),/Invalid private viewport width/)
 await assert.rejects(h.call({kind:'qa-layout',width:1001}),/Invalid private viewport width/)
 check(true,'Private layout dimensions remain bounded')
 await assert.rejects(access(join(out,'unused-settings.json')));check(true,'QA does not generate or modify saved preferences')
} finally {
 clearTimeout(watchdog);const stderr=await h.close();await writeFile(join(out,'stderr.log'),stderr)
 await writeFile(join(out,'report.json'),JSON.stringify({checks,reports,gameCaptured:false,realInputInjected:false,userSettingsModified:false},null,2))
}
console.log(checks.length+' native viewport checks passed.')
