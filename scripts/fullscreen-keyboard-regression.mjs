import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { OverlayController } from '../src/overlay.js'
import { PREFERENCE_DEFAULTS } from '../src/overlay-preferences.js'
import { InputDisplayDiagnostics } from '../src/input-display-diagnostics.js'
import { mapPose, displayText } from '../src/live2d/adapter.js'
import { actorText } from '../src/live2d/control-labels.js'
const root=dirname(dirname(fileURLToPath(import.meta.url))),groups=[]
async function test(name,run){await run();groups.push(name)}

function renderer(source,clock){
  let listener,parameter=0;const output=[],elements=new Map()
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',title:'',clientWidth:400,clientHeight:400,width:400,height:400,style:{setProperty(){}},classList:{toggle(){}},setAttribute(){},addEventListener(){},getContext:()=>({})});return elements.get(id)}
  class Scheduler{constructor(){this.visible=false;this.timer=null}touch(){}setVisible(v){this.visible=v}setAnimating(){}dispose(){}}
  const profile={bindings:{keyboard:'Keyboard'}},parameters={Keyboard:{min:0,max:1,default:0}}
  const scene={profile,parameters,parameterIndices:{Keyboard:0},manifest:{token:'fixture'},cursorGaze:{sequence:0,suspend(){}},completion:null,
    model:{core:()=>({getParameterValueByIndex:()=>parameter})},rememberState(){},resume(){},stopMotion(){},
    update(state){this.pose=mapPose(state,parameters,profile,this.pose,{a:65,w:87});parameter=this.pose.values.Keyboard??parameter},render(){}}
  const context=vm.createContext({InputDisplayDiagnostics,FrameScheduler:Scheduler,CursorProgress:class{update(){}},actorText,displayText,
    window:{chrome:{webview:{postMessage:m=>output.push(m),addEventListener:(_,fn)=>{listener=fn}}},addEventListener(){}},
    document:{querySelector:element,body:element('body')},performance:{now:clock},devicePixelRatio:1,
    ResizeObserver:class{observe(){}disconnect(){}},setTimeout:()=>1,clearTimeout(){},console,testScene:scene})
  vm.runInContext(source.replace(/^import .*$/gm,''),context)
  vm.runInContext('active=testScene',context)
  return {send:state=>listener({data:state}),draw:()=>vm.runInContext('draw(performance.now(),1/60)',context),value:()=>parameter,scene,
    diagnostics(){listener({data:{kind:'input-diagnostics',id:'fixture'}});return output.at(-1).inputDiagnostics}}
}
const rendererSource=await readFile(join(root,'desktop/renderer.js'),'utf8')
async function pipeline(run){
  let now=1000,humanSequence=0,aiSequence=0;const sent=[],view=renderer(rendererSource,()=>now)
  const o=new OverlayController({now:()=>now,preferences:{value:{...PREFERENCE_DEFAULTS,controlMode:'adaptive'}},powershell:'unused',spawn(){throw Error('Fixture cannot launch a process')}})
  o.capabilities={adaptiveControl:true,inputDiagnostics:true};o.ready=true;o.dead=false;o.activated=true
  o.child={stdin:{write:text=>{const m=JSON.parse(text);if(m.kind==='state'){sent.push(m);view.send(m)}else if(m.kind==='input-diagnostics')queueMicrotask(()=>o.read(JSON.stringify({kind:'ack',id:m.id,ok:true,inputDiagnostics:{desktop:{receivedSequence:sent.at(-1)?.displaySequence??0},renderer:view.diagnostics()}})+'\n'));return true}}}
  const human=(event,heldKeys=[],extra={})=>o.observeHuman({kind:'human-observation',session:'human-fixture',sequence:++humanSequence,source:'human',event,device:1,code:heldKeys[0]??65,amount:0,heldKeys,heldButtons:[],position:null,...extra})
  const ai=(event,heldKeys=[],extra={})=>o.observe({kind:'input-observation',session:'ai-fixture',sequence:++aiSequence,source:'worker',timestamp:now,ownerId:1,event,device:1,code:heldKeys[0]??65,amount:0,state:0,uncertain:false,heldKeys,heldButtons:[],position:null,...extra})
  const connectAI=()=>o.observe({kind:'observation-status',status:'connected',session:'ai-fixture'})
  o.observeHuman({kind:'human-observer-status',session:'human-fixture',status:'connected',keyboardBackend:'raw-input',rawRegistrationError:0})
  try{await run({o,human,ai,connectAI,view,sent,advance:ms=>{now+=ms}})}finally{o.child=null;await o.close()}
}

await test('raw-only human long hold reaches the actual renderer dispatcher and pose adapter',()=>pipeline(({human,view,sent,advance})=>{
  human('down',[87]);view.draw();assert.equal(view.value(),1)
  for(let i=0;i<24;i++){advance(250);human('state',[87]);view.draw();assert.equal(view.value(),1)}
  human('up',[],{code:87});view.draw();assert.equal(view.value(),0);assert.equal(sent.at(-1).lastActor,'human')
  const d=view.diagnostics();assert.ok(d.received.messages>=26);assert.equal(d.model.keyboardBound,true);assert.equal(d.model.keyboardParameterValue,0)
}))
await test('AI ledger long hold remains independent of human hooks/raw delivery',()=>pipeline(({connectAI,ai,view,advance,sent})=>{
  connectAI();ai('down',[65]);view.draw();assert.equal(view.value(),1)
  for(let i=0;i<24;i++){advance(250);ai('state',[65]);view.draw();assert.equal(view.value(),1)}
  ai('up');view.draw();assert.equal(view.value(),0);assert.equal(sent.at(-1).lastActor,'ai')
}))
await test('human and AI own the same key independently; external injection never acquires it',()=>pipeline(({human,ai,connectAI,view,sent})=>{
  connectAI();ai('down',[65]);human('down',[65]);ai('up');view.draw();assert.equal(view.value(),1)
  human('up');view.draw();assert.equal(view.value(),0)
  const actor=sent.at(-1).lastActor;human('down',[65],{source:'external'});view.draw();assert.equal(view.value(),0)
  assert.equal(sent.at(-1).lastActor,actor);assert.equal(sent.at(-1).externalInput,true)
  ai('down',[65]);human('down',[65]);human('up');view.draw();assert.equal(view.value(),1);ai('up');view.draw();assert.equal(view.value(),0)
}))
await test('backpressure coalesces snapshots without losing a long hold or its final release',()=>pipeline(({o,human,view,sent,advance})=>{
  o.blocked=true;human('down',[87]);for(let i=0;i<12;i++){advance(250);human('state',[87])}
  o.blocked=false;o.flush();view.draw();assert.equal(view.value(),1);assert.deepEqual(sent.at(-1).keys,['w'])
  o.blocked=true;human('up',[],{code:87});human('state');o.blocked=false;o.flush();view.draw();assert.equal(view.value(),0)
  const d=o.inputDiagnostics.snapshot();assert.ok(d.merged.messages>d.sent.messages);assert.equal(d.sent.sequence,sent.at(-1).displaySequence)
}))
await test('stale/session-replaced human state clears without restarting input helpers',()=>pipeline(({o,human,view,advance})=>{
  human('down',[87]);view.draw();assert.equal(view.value(),1);advance(1600);o.changed();view.draw();assert.equal(view.value(),0)
  o.observeHuman({kind:'human-observer-status',session:'human-fixture',status:'stopped'});o.observeHuman({kind:'human-observer-status',session:'new-session',status:'connected'})
  human('down',[87]);view.draw();assert.equal(view.value(),0)
  o.observeHuman({kind:'human-observation',session:'new-session',sequence:1,source:'human',event:'down',device:1,code:87,amount:0,heldKeys:[87],heldButtons:[],position:null})
  view.draw();assert.equal(view.value(),1)
}))
await test('gaps repair complete state; unknown/locked safety cannot be overridden by humans',()=>pipeline(({human,connectAI,ai,view,sent})=>{
  human('down',[87]);human('state',[],{sequence:99,resync:true});view.draw();assert.equal(view.value(),0)
  connectAI();ai('fault',[65],{state:2,uncertain:true});view.draw();assert.equal(view.value(),0);assert.equal(sent.at(-1).status,'unknown')
  ai('state',[],{locked:true});human('down',[87],{sequence:100});view.draw();assert.equal(view.value(),0);assert.equal(sent.at(-1).status,'locked');assert.equal(view.scene.pose.frozen,true)
}))
await test('on-demand diagnostics correlate stages without exposing identities or input history',()=>pipeline(async({o,human,view,sent})=>{
  human('down',[87]);view.draw();const d=await o.getInputDiagnostics()
  assert.equal(d.controller.human.keyCount,1);assert.equal(d.controller.sent.sequence,sent.at(-1).displaySequence)
  assert.equal(d.native.desktop.receivedSequence,d.controller.sent.sequence);assert.equal(d.native.renderer.model.keyboardParameterValue,1)
  assert.equal(d.native.renderer.received.sequence,d.controller.sent.sequence)
  assert.doesNotMatch(JSON.stringify(d),/heldKeys|"keys"|"code"|"text"|"history"/)
  o.capabilities.inputDiagnostics=false;assert.equal((await o.getInputDiagnostics()).native,null)
}))
await test('diagnostic storage is bounded and cannot retain caller-provided text',()=>{
  let now=0;const d=new InputDisplayDiagnostics(()=>now)
  for(let i=0;i<10000;i++)d.record('human',{heldKeys:[65],text:'not retained',sequence:i})
  d.record('arbitrary',{keys:[65]});now=250;assert.equal(d.stages.size,1);assert.deepEqual(d.snapshot().human,{messages:10000,sequence:9999,keyCount:1,status:null,ageMs:250})
})
await test('native implementation uses a nonexclusive background receiver, not focus/input injection',async()=>{
  const raw=await readFile(join(root,'desktop/RawKeyboard.cs'),'utf8'),observer=await readFile(join(root,'desktop/HumanInputObserver.cs'),'utf8')
  assert.match(raw,/InputSink = 0x100/);assert.match(raw,/Flags = InputSink \| DeviceNotify/);assert.match(raw,/Parent = new IntPtr\(-3\)/)
  assert.doesNotMatch(raw,/SetForegroundWindow|SendInput|ToUnicode|GetClipboard|RIDEV_EXINPUTSINK|RIDEV_NOLEGACY/)
  assert.match(observer,/KeyboardObservationRules.AcceptHook\(rawRegistered,source\)/);assert.match(observer,/rawKeys.Remove\(device\)/)
  assert.match(observer,/connected&&!announced/);assert.doesNotMatch(observer,/GetForegroundWindow|GetAsyncKeyState/)
})
console.log(JSON.stringify({ok:true,groups:groups.length,scenarios:groups,hooksInstalled:false,inputInjected:false,gameValidated:false},null,2))
