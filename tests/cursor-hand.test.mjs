import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {SystemCursorGaze,cursorHandYCorrection} from '../src/live2d/cursor-gaze.js'
const p=(min=-30,max=30,def=0)=>({min,max,default:def})
const parameters={ParamMouseX:p(),ParamMouseY:p(),customX:p(-10,30,5),customY:p(0,1,.25),Paramshuiying:p(0,1,0),fixed:p(1,1,1)}
const profile={bindings:{mouseX:'ParamMouseX',mouseY:'ParamMouseY'},reverse:{}}
const setup=()=>new SystemCursorGaze(parameters,{roles:{},reverse:{},reserved:new Set()},'model')
const target=(sequence=1,x=1,y=1)=>({token:'model',sequence,valid:true,x,y})
const settle=g=>{for(let i=0;i<120;i++)g.update(1/60)}
test('hand starts at actual default even before the first native target',()=>{const g=setup();assert.deepEqual(g.handValues(profile),{ParamMouseX:0,ParamMouseY:0});assert.equal(g.initialized,false)})
test('both hand axes use the already smoothed system cursor, with upward Y conversion',()=>{const g=setup();g.accept(target());settle(g);const v=g.handValues(profile);assert.ok(v.ParamMouseX>29.999&&v.ParamMouseY< -29.999)})
test('repeated hand reads never advance smoothing, sequences or clocks',()=>{const g=setup();g.accept(target());g.update(.01);const before={x:g.x,y:g.y,sequence:g.sequence},v=g.handValues(profile);for(let i=0;i<1000;i++)assert.deepEqual(g.handValues(profile),v);assert.deepEqual({x:g.x,y:g.y,sequence:g.sequence},before)})
test('asymmetric ranges center on native default and use each side independently',()=>{const g=setup(),custom={bindings:{mouseX:'customX',mouseY:'customY'}};assert.deepEqual(g.handValues(custom),{customX:5,customY:.25});assert.deepEqual(g.handValues(custom,{x:1,y:-1}),{customX:30,customY:1});assert.deepEqual(g.handValues(custom,{x:-1,y:1}),{customX:-10,customY:0})})
test('manual reversal and legacy Y inversion are each honored once',()=>{const g=setup();assert.deepEqual(g.handValues({...profile,reverse:{mouseX:true,mouseY:true}},{x:1,y:1}),{ParamMouseX:-30,ParamMouseY:30});assert.equal(g.handValues({...profile,invertY:true},{x:0,y:1}).ParamMouseY,30)})
test('unsupported, fixed, protected or conflicting bindings never receive cursor writes',()=>{const g=setup();for(const id of ['missing','fixed','Paramshuiying'])assert.deepEqual(g.handValues({bindings:{mouseX:id}}),{});assert.deepEqual(g.handValues({bindings:{mouseX:'ParamMouseX',left:'ParamMouseX'}}),{});assert.deepEqual(g.handValues({bindings:{mouseX:'ParamMouseX',mouseY:'ParamMouseX'}}),{})})
test('a missing axis does not disable an independently supported axis',()=>{const g=setup(),q={bindings:{mouseX:'ParamMouseX'}};assert.deepEqual(g.handValues(q,{x:1,y:1}),{ParamMouseX:30});assert.equal(g.handAxes(q)[1].enabled,false);assert.ok(g.handAxes(q)[1].error)})
test('pure envelope measurements clamp extrema without changing controller state',()=>{const g=setup();assert.deepEqual(g.handValues(profile,{x:2,y:-2}),{ParamMouseX:30,ParamMouseY:30});assert.deepEqual(g.handValues(profile,{x:NaN,y:Infinity}),{ParamMouseX:0,ParamMouseY:0});assert.equal(g.x,0);assert.equal(g.sequence,0)})
test('invalid native reads smoothly return hands to native default',()=>{const g=setup();g.accept(target());settle(g);g.accept({token:'model',sequence:2,valid:false});g.update(1/60);assert.ok(g.handValues(profile).ParamMouseX>0);settle(g);assert.ok(Math.abs(g.handValues(profile).ParamMouseX)<1e-6)})
test('suspension holds the last legal hand and resumes toward the latest target',()=>{const g=setup();g.accept(target());g.update(.05);const v=g.handValues(profile);g.suspend();for(let i=0;i<60;i++)g.update(1/60);assert.deepEqual(g.handValues(profile),v);g.accept(target(2,-1,-1));g.update(.01);assert.ok(g.handValues(profile).ParamMouseX<v.ParamMouseX)})
test('unknown/locked/motion suspension cannot advance the hand smoothing',()=>{const g=setup();g.accept(target());g.update(.05);const v=g.handValues(profile);g.accept(target(2,-1,-1));for(let i=0;i<60;i++)g.update(1/60,true);assert.deepEqual(g.handValues(profile),v)})
test('new scenes cannot inherit old targets and rebinding cannot emit old parameter IDs',()=>{const a=setup(),b=setup();a.accept(target());settle(a);assert.deepEqual(b.handValues(profile),{ParamMouseX:0,ParamMouseY:0});const v=a.handValues({bindings:{mouseX:'customX'}});assert.deepEqual(Object.keys(v),['customX']);assert.equal(b.accept({...target(),token:'old'}),false)})
test('hand mapping is frame-rate independent and never mutates parameter/profile definitions',()=>{const snapshot=structuredClone({parameters,profile});const run=fps=>{const g=setup();g.accept(target());for(let i=0;i<fps;i++)g.update(1/fps);return g.handValues(profile)};for(const [id,value]of Object.entries(run(30)))assert.ok(Math.abs(value-run(60)[id])<1e-9&&Math.abs(value-run(120)[id])<1e-9);assert.deepEqual({parameters,profile},snapshot)})
test('display pose applies system hand twice around physics without contaminating confirmed AI state',async()=>{const s=await readFile('desktop/model-scene.js','utf8');assert.ok(s.includes('displayPoseValues(pose){return {...pose.values,...this.cursorGaze.handValues(this.profile)}}'));assert.equal(s.split('this.apply(this.displayPoseValues(this.pose))').length-1,2);assert.ok(s.includes('delete confirmedValues[id]'));assert.ok(s.includes('this.realPose={...this.pose,values:{...this.pose.values}}'));assert.ok(s.indexOf('this.model.step(dt)')<s.lastIndexOf('this.apply(this.displayPoseValues(this.pose))'))})
test('measured automatic hand direction differs per model while explicit reversal stays authoritative',()=>{const g=setup(),q={...profile,cursorHandDirections:{mouseX:1,mouseY:1}};assert.deepEqual(g.handValues(q,{x:1,y:1}),{ParamMouseX:30,ParamMouseY:30});assert.deepEqual(g.handValues({...q,reverse:{mouseY:true}},{x:1,y:1}),{ParamMouseX:30,ParamMouseY:-30});assert.deepEqual(g.handValues(profile,{x:1,y:1}),{ParamMouseX:30,ParamMouseY:-30})})
test('a measured mirrored X direction can preserve physical screen movement before manual reversal',()=>{const g=setup(),q={...profile,cursorHandDirections:{mouseX:-1,mouseY:1}};const v=g.handValues(q,{x:1,y:1});assert.ok(v.ParamMouseX<0&&v.ParamMouseX*-1>0);assert.ok(g.handValues({...q,reverse:{mouseX:true}},{x:1,y:1}).ParamMouseX>0)})
test('live cursor-derived values stay in private QA diagnostics, not public adapter metadata',async()=>{const s=await readFile('desktop/model-scene.js','utf8'),report=s.slice(s.indexOf(' cursorHandReport(){'),s.indexOf(' adapterReport(){'));assert.ok(!report.includes('handValues('));assert.ok(s.includes('cursorHandFollow:{...this.cursorHandReport(),values:this.cursorGaze.handValues(this.profile)}'))})
test('0.3.6 reverses only the corrected built-in hand Y, not gaze/head/X or unrelated models',()=>{const g=new SystemCursorGaze({...parameters,ParamAngleY:p()},{roles:{headY:['ParamAngleY']},reverse:{},reserved:new Set(['ParamMouseX','ParamMouseY'])},'model');g.accept(target());settle(g);const plain={...profile,cursorHandDirections:{mouseX:1,mouseY:-1}},fixed={...plain,cursorHandYCorrection:-1};const original=g.handValues(plain),corrected=g.handValues(fixed);assert.ok(g.y>.999&&g.headValues().ParamAngleY>10.49);assert.equal(original.ParamMouseX,corrected.ParamMouseX);assert.ok(original.ParamMouseY< -29.999&&corrected.ParamMouseY>29.999);assert.equal(g.handValues({...plain,cursorHandYCorrection:1}).ParamMouseY,original.ParamMouseY);assert.ok(g.handValues({...fixed,reverse:{mouseY:true}}).ParamMouseY< -29.999)})

const builtinHash='9c455e9bfe672951e234ecc74b2f71fa3fe98eea67ebdd0cb43bed41599d64d0'
test('0.3.7 keeps every built-in Y correction branch exactly as 0.3.6',()=>{
 const g=setup()
 for(const id of ['ParamMouseY','customY',null,undefined])for(const reverse of [false,true]){
  const original={bindings:{mouseY:id},reverse:{mouseY:reverse},cursorHandYCorrection:id==='ParamMouseY'?-1:1}
  const current={...original,cursorHandYCorrection:cursorHandYCorrection(builtinHash,id)}
  assert.equal(current.cursorHandYCorrection,original.cursorHandYCorrection)
  for(const y of [-1,0,1])assert.deepEqual(g.handValues(current,{x:0,y}),g.handValues(original,{x:0,y}))
 }
})
test('0.3.7 reverses only non-default mouse-hand Y before the unchanged manual reverse flag',()=>{
 const g=new SystemCursorGaze({...parameters,ParamAngleY:p()},{roles:{headY:['ParamAngleY']},reverse:{},reserved:new Set()},'model')
 g.accept(target());settle(g);const head=g.headValues(),snapshot=structuredClone(parameters)
 for(const hash of ['other-model','',undefined])for(const reverse of [false,true])for(const y of [-1,0,1]){
  const old={...profile,reverse:{mouseY:reverse},cursorHandDirections:{mouseX:1,mouseY:-1},cursorHandYCorrection:1}
  const current={...old,cursorHandYCorrection:cursorHandYCorrection(hash,'ParamMouseY')}
  const a=g.handValues(old,{x:1,y}),b=g.handValues(current,{x:1,y})
  assert.equal(current.cursorHandYCorrection,-1);assert.equal(b.ParamMouseX,a.ParamMouseX);assert.ok(Math.abs(b.ParamMouseY+a.ParamMouseY)<1e-9)
  assert.equal(current.reverse.mouseY,reverse)
 }
 assert.deepEqual(g.headValues(),head);assert.deepEqual(parameters,snapshot)
})
test('non-default custom/asymmetric Y ranges correct around Core defaults, not zero',()=>{
 const g=setup(),q={bindings:{mouseY:'customY'},cursorHandYCorrection:cursorHandYCorrection('custom-model','customY')}
 assert.equal(g.handValues(q,{x:0,y:0}).customY,.25)
 assert.equal(g.handValues(q,{x:0,y:1}).customY,1)
 assert.equal(g.handValues({...q,reverse:{mouseY:true}},{x:0,y:1}).customY,0)
})
test('non-default Y correction does not enable absent, protected, fixed or owned parameters',()=>{
 const g=setup()
 for(const id of [null,'missing','fixed','Paramshuiying'])assert.deepEqual(g.handValues({bindings:{mouseY:id},cursorHandYCorrection:cursorHandYCorrection('other',id)},{x:0,y:1}),{})
 const q={bindings:{mouseY:'ParamMouseY',left:'ParamMouseY'},cursorHandYCorrection:cursorHandYCorrection('other','ParamMouseY')}
 assert.deepEqual(g.handValues(q,{x:0,y:1}),{})
})
test('the scene uses the content-aware helper rather than model names or preference writes',async()=>{
 const s=await readFile('desktop/model-scene.js','utf8')
 assert.ok(s.includes('cursorHandYCorrection(this.mocHash,this.profile.bindings.mouseY)'))
 const correction=s.slice(s.indexOf(' calibrateCursorHandAxes(){'),s.indexOf(' measureCursorHandBounds(){'))
 assert.ok(!correction.includes('manifest.name'));assert.ok(!correction.includes('profile.reverse='));assert.ok(!correction.includes('invertY='))
})

test('authored physics dependency graphs are private QA diagnostics, not public model metadata',async()=>{
 const s=await readFile('desktop/model-scene.js','utf8')
 const qa=s.slice(s.indexOf(' qaSnapshot(){'),s.indexOf(' cursorHandReport(){'))
 const reports=s.slice(s.indexOf(' cursorHandReport(){'),s.indexOf(' release(){'))
 assert.ok(qa.includes('physicsDependencies:dependencies'));assert.ok(!reports.includes('physicsDependencies'))
})
