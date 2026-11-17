// DIP-specific regression using the official Core in an invisible owned WebView.
// Samples only our canvas and the user's chosen read-only model/settings snapshot.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,access} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {idleHarness,neutral} from './idle-render-harness.mjs'
import {readQaPreferences,loadPreferenceModel} from './current-model-fixture.mjs'
import {decodePrivatePng} from './private-png.mjs'
import {projectionFit} from '../src/live2d/projection.js'
const quick=process.argv.includes('--quick'),out=resolve(process.env.DSH_DIP_QA_DIR??'.qa/projection-dip-20261114/native')
await mkdir(out,{recursive:true});const settings=await readQaPreferences(),h=await idleHarness(out),samples=[],checks=[]
const watchdog=setTimeout(()=>h.child.kill(),600000),sleep=ms=>new Promise(r=>setTimeout(r,ms)),near=(a,b,eps=1e-4)=>assert.ok(Math.abs(a-b)<=eps,`${a} differs from ${b}`)
let frame=0,layouts=0,cursorSeq=0,completed=false
const states={idle:{...neutral,controlMode:settings.controlMode,lastActor:'human'},active:{...neutral,controlMode:settings.controlMode,lastActor:'human',keys:['ctrl','shift','a'],buttons:['left'],moveMs:100,wheelMs:100,wheelDirection:1}}
const check=(v,label)=>{assert.ok(v,label);checks.push(label);console.log('PASS '+label)}
const step=(state,steps=0)=>h.step('p-'+ ++frame,steps,state)
const physical=s=>{
 const l=s.diagnostics.layout,p=s.diagnostics.projection,c=l.canvas
 return {scaleX:p[0]*c.width/2,scaleY:p[5]*c.height/2,x:(1+p[12])*c.width/2+c.x,y:(1-p[13])*c.height/2+c.y}
}
const audit=s=>{
 const d=s.diagnostics,l=d.layout,c=l.canvas,p=d.projection,b=s.bounds,aspect=c.pixelWidth/c.pixelHeight
 assert.equal(d.glError,0);assert.equal(d.nonfiniteVertices,0);assert.deepEqual(d.viewMismatches,[])
 const fit=projectionFit(c.pixelWidth,c.pixelHeight,b,s.projection.autoFrame,1),scale=s.projection.scale,screen=physical(s)
 // Actual current model has the default unit author matrix. Author variants have separate production-method tests.
 near(Math.abs(p[0]),fit*scale);near(p[5],Math.abs(fit*scale)*aspect)
 near(Math.abs(screen.scaleX),screen.scaleY,.6)
 assert.deepEqual(l.hands,{x:c.x,y:c.y,width:c.width,height:c.height})
 assert.equal(l.horizontalOverflow,false);assert.ok(l.statusPanel.scrollWidth<=l.statusPanel.clientWidth)
 assert.equal(s.watermark.mode,settings.modelWatermarks?.[catalog.modelKey]?.mode??'default')
 const ext={width:Math.abs(p[0])*(b.maxX-b.minX),height:p[5]*(b.maxY-b.minY)}
 assert.ok(ext.width<=1.88*scale+1e-5&&ext.height<=1.88*scale+1e-5,'Auto-frame bounds exceed viewport fit; authored scale is not normalized away')
 if(!s.pose?.frozen)for(const [id,value]of Object.entries(d.cursorHandFollow.values))near(s.values[id],value)
 return {dip:l.viewport.width,dpr:l.viewport.dpr,canvas:c,screen,projectedExtent:ext,drawableBounds:d.drawableBounds,watermark:s.watermark.mode}
}
async function setLayout(width,dpr=1,height=width+76){
 await h.call({kind:'qa-layout',width,height,dpr});await sleep(20);layouts++
 const s=await step(states.idle)
 assert.equal(s.diagnostics.layout.viewport.width,width);assert.equal(s.diagnostics.layout.viewport.height,height);assert.equal(s.diagnostics.layout.viewport.dpr,dpr)
 return s
}
let catalog
try {
 catalog=await loadPreferenceModel(h,settings);check(true,'Current model, global adaptation and saved hidden-watermark mode match Host settings')
 const dips=quick?[220,221,238,239,240,299,300]:Array.from({length:81},(_,i)=>220+i),dprs=[1,1.25,1.5,1.75,2]
 for(const dpr of dprs){
  for(const dip of dips){
   const idle=await setLayout(dip,dpr),active=await step(states.active,1),rest=await step(states.idle,1)
   const a=audit(idle),b=audit(active),c=audit(rest)
   assert.deepEqual(a.screen,b.screen);assert.deepEqual(a.screen,c.screen);assert.deepEqual(a.canvas,b.canvas);assert.deepEqual(a.canvas,c.canvas)
   samples.push({kind:'dip',dip,dpr,...a,stable:true})
  }
  check(true,`${quick?'Boundary':'Every-DIP'} 220–300 scan at DPR ${dpr}: actual CSS-pixel scale, center, clipping and hands stay stable on input/idle changes`)
 }
 for(const dip of [420,1000])for(const dpr of dprs){const s=await setLayout(dip,dpr);samples.push({kind:'large',...audit(s)});const a=await step(states.active);assert.deepEqual(physical(a),physical(s))}
 check(true,'420/1000 DIP and all five scale factors preserve size on input changes')
 // Model-space bounds near-square vs non-square canvas catches the old reciprocal-aspect error.
 let overflowProofs=0
 for(const [width,height]of [[239,300],[239,260],[300,250],[260,400],[420,310]])for(const dpr of [1,1.25,2]){
  const s=await setLayout(width,dpr,height),a=audit(s),b=s.bounds,w=s.diagnostics.layout.canvas.pixelWidth,hp=s.diagnostics.layout.canvas.pixelHeight,spanY=b.maxY-b.minY
  const legacy=Math.min(2/(b.maxX-b.minX),2*(w/hp)/spanY)*.94
  if(legacy*(w/hp)*spanY>1.88+1e-5)overflowProofs++
  samples.push({kind:'non-square',height,...a,legacyExtentY:legacy*(w/hp)*spanY})
  const active=await step(states.active);assert.deepEqual(physical(active),a.screen)
 }
 check(overflowProofs>0,'Non-square native canvases reproduce the old height overflow and satisfy the corrected bound')
 // Around narrow text wrapping points, check expiry, long safety text and cursor-hand extremes.
 for(const dip of [220,221,230,238,239,240,250,260,280,299,300]){
  const reference=await setLayout(dip,1.25),screen=physical(reference)
  await step({...states.idle,pulses:[{id:'key:a',ms:25}]});await sleep(40)
  const expired=await h.call({kind:'qa-step',name:'expiry-'+dip,steps:0});assert.deepEqual(physical(expired),screen)
  const long=await step({...states.idle,humanError:'长诊断文字 '.repeat(60),externalInput:true});audit(long);assert.deepEqual(physical(long),screen)
  const confirmed=await step({...states.idle,mode:'real',keys:['a'],buttons:['left']},1)
  for(const status of ['unknown','locked']){const s=await step({...states.idle,mode:'real',status});audit(s);assert.deepEqual(physical(s),screen);assert.deepEqual(s.values,confirmed.values,'Frozen state must preserve the confirmed hand, not consume a new cursor target')}
  for(const [x,y] of [[-1,-1],[1,1]]){await h.call({kind:'qa-cursor',token:catalog.modelToken,sequence:++cursorSeq,valid:true,x,y});const s=await step(states.idle,60);audit(s);assert.deepEqual(physical(s),screen)}
 }
 check(true,'Adjacent narrow DIP values, expiry, safety messages, frozen states and hand extremes do not change physical model scale')
 await h.call({kind:'qa-cursor',token:catalog.modelToken,sequence:++cursorSeq,valid:true,x:0,y:0})
 const metrics=await h.call({kind:'metrics'});assert.equal(metrics.cursorSampling.reads,0);assert.equal(metrics.cursorSampling.timer,false)
 await assert.rejects(h.call({kind:'qa-layout',width:239,height:119}),/Invalid private viewport/)
 await assert.rejects(h.call({kind:'qa-layout',width:239,height:2001}),/Invalid private viewport/)
 await assert.rejects(access(join(out,'unused-settings.json')));check(true,'Bounded invisible QA: no real cursor sampling, input injection or settings writes')
 completed=true
 // Persist measured samples only; original ZIP and settings are never modified.
} finally {
 clearTimeout(watchdog);await writeFile(join(out,'stderr.log'),await h.close())
 await writeFile(join(out,'report.json'),JSON.stringify({ok:completed,quick,layouts,frames:frame,checks,samples,watermark:catalog?.adapter.watermark,realInputInjected:false,gameCaptured:false,userSettingsModified:false},null,2))
}
console.log(`Native DIP projection checks passed: ${layouts} layouts, ${frame} private canvas frames. Full scan: ${!quick}.`)
