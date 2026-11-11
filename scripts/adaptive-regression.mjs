import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { AdaptiveDisplayState, actorText } from '../src/control-adaptive.js'
import { footerPresentation } from '../src/live2d/control-labels.js'
import { InputDisplayState } from '../src/overlay-state.js'
import { OverlayController } from '../src/overlay.js'
import { OverlayManagement } from '../src/overlay-management.js'
import { OverlayPreferences, PREFERENCE_DEFAULTS, migratePreferences, validatePreferenceRequest } from '../src/overlay-preferences.js'
const root=dirname(dirname(fileURLToPath(import.meta.url))),groups=[]
async function test(name,run){await run();groups.push(name)}
let now=1000,sequence=0
const state=()=>({mode:'real',status:'ready',keys:[],buttons:[],pulses:[],position:null,moveMs:0,textMs:0,wheelMs:0,wheelDirection:0})
const human=(event='state',extra={})=>({kind:'human-observation',session:'fixture',sequence:++sequence,source:'human',event,device:1,code:65,amount:0,heldKeys:[],heldButtons:[],position:null,...extra})
const connect=a=>a.observeHuman({kind:'human-observer-status',session:'fixture',status:'connected'})
await test('sticky last actor and non-input exclusion',()=>{
 const a=new AdaptiveDisplayState(()=>now);connect(a);assert.equal(actorText(a.lastActor),'控制自适应模式')
 a.observeHuman(human('down',{heldKeys:[65]}));assert.equal(actorText(a.lastActor),'人控制')
 now+=60000;a.observeHuman(human());assert.equal(actorText(a.snapshot(state()).lastActor),'人控制')
 a.observeAI({kind:'input-observation',event:'move',uncertain:false},state());assert.equal(actorText(a.lastActor),'AI控制')
 for(const event of ['state','fault'])a.observeAI({kind:'input-observation',event},state())
 a.observeHuman(human('state'));a.observeHuman(human('move',{source:'external',device:2}));assert.equal(a.lastActor,'ai')
 a.observeHuman(human('up'));assert.equal(a.lastActor,'human')
 a.observeAI({kind:'input-observation',event:'down',device:3,uncertain:false},state());assert.equal(a.lastActor,'ai')
 now+=3600000;assert.equal(a.snapshot(state(),{...state(),mode:'simulation'}).lastActor,'ai')
})
await test('two owners retain same held key and mouse button',()=>{
 const a=new AdaptiveDisplayState(()=>now);connect(a);a.observeHuman(human('down',{heldKeys:[65],heldButtons:[0]}))
 const ai={...state(),keys:['a'],buttons:['left']};assert.deepEqual(a.snapshot(ai).keys,['a']);assert.deepEqual(a.snapshot(ai).buttons,['left'])
 a.observeAI({kind:'input-observation',event:'up'},state());assert.deepEqual(a.snapshot(state()).keys,['a']);assert.deepEqual(a.snapshot(state()).buttons,['left'])
 a.observeHuman(human('up'));assert.deepEqual(a.snapshot(ai).keys,['a']);assert.deepEqual(a.snapshot(ai).buttons,['left'])
 assert.deepEqual(a.snapshot(state()).keys,[]);assert.deepEqual(a.snapshot(state()).buttons,[])
})
await test('mouse position wheel sided modifiers and keypad Enter',()=>{
 const a=new AdaptiveDisplayState(()=>now);connect(a);a.observeAI({kind:'input-observation',event:'move'},state());now++
 a.observeHuman(human('move',{device:2,position:{x:.2,y:.8},heldKeys:[160,163,256]}));assert.deepEqual(a.snapshot({...state(),position:{x:.9,y:.1}}).position,{x:.2,y:.8});assert.deepEqual(a.snapshot(state()).keys,['lshift','rctrl','numenter'])
 a.observeHuman(human('wheel',{device:2,amount:-120}));assert.equal(a.snapshot(state()).wheelDirection,-1)
 a.observeAI({kind:'input-observation',event:'move'},state());assert.deepEqual(a.snapshot({...state(),position:{x:.9,y:.1}}).position,{x:.9,y:.1})
 a.observeHuman(human('move',{device:2,position:{x:.4,y:.6}}));assert.deepEqual(a.snapshot({...state(),position:{x:.9,y:.1}}).position,{x:.4,y:.6})
 a.observeAI({kind:'input-observation',event:'wheel'},state());a.observeHuman(human('wheel',{device:2,amount:-120}));assert.equal(a.snapshot({...state(),wheelMs:180,wheelDirection:1}).wheelDirection,-1)
})
await test('independent source health sequence repair and lifecycle',()=>{
 const a=new AdaptiveDisplayState(()=>now);connect(a);a.observeHuman(human('down',{heldKeys:[65]}));const actor=a.lastActor
 assert.equal(a.observeHuman(human('down',{sequence:-1})),false);assert.equal(a.observeHuman(human('down',{heldKeys:[999]})),false);assert.equal(a.observeHuman(human('down',{code:-1})),false);assert.equal(a.lastActor,actor)
 a.observeHuman(human('state',{sequence:sequence+5,resync:true}));assert.deepEqual(a.snapshot(state()).keys,[])
 a.observeAI({kind:'input-observation',event:'state'},state());now+=2000;a.observeHuman(human());assert.equal(a.snapshot(state()).status,'unknown')
 assert.equal(a.snapshot({...state(),status:'locked'}).status,'locked')
 a.observeHuman({kind:'human-observer-status',session:'fixture',status:'stopped'});assert.equal(a.lastActor,actor);assert.deepEqual(a.snapshot(state()).keys,[])
 const quiet=new AdaptiveDisplayState(()=>now);connect(quiet);now+=100000;quiet.observeHuman(human());assert.equal(quiet.snapshot(state()).status,'ready')
 quiet.observeHuman(human('down',{heldKeys:[65]}));now+=1600;assert.deepEqual(quiet.snapshot(state()).keys,[]);assert.ok(quiet.humanError)
})
await test('preference defaults validation persistence and atomic rollback',async()=>{
 assert.equal(migratePreferences({version:4}).controlMode,'ai-only');assert.equal(migratePreferences({}).modelInfoVisible,true)
 assert.deepEqual(validatePreferenceRequest({controlMode:'adaptive',modelInfoVisible:false}),{controlMode:'adaptive',modelInfoVisible:false})
 for(const bad of [{controlMode:'mixed'},{modelInfoVisible:0},{lastActor:'ai'}])assert.throws(()=>validatePreferenceRequest(bad),{code:'invalid_preferences'})
 const base=join(root,'.qa','adaptive-regression');await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(join(base,'isolated-')),file=join(directory,'preferences.json')
 const store=new OverlayPreferences(file);await store.ready;await store.update({controlMode:'adaptive',modelInfoVisible:false},0)
 const restarted=new OverlayPreferences(file);await restarted.ready;assert.equal(restarted.value.controlMode,'adaptive');assert.equal(restarted.value.modelInfoVisible,false);assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(file,'utf8')),'lastActor'),false)
 const failed=new OverlayPreferences(file,{io:{...fs,rename:async()=>{throw Error('Synthetic atomic save failure')}}});await failed.ready;let rolledBack=false
 await assert.rejects(failed.update({controlMode:'ai-only'},failed.revision,async()=>({rollback(){rolledBack=true}})));assert.equal(rolledBack,true)
 const after=new OverlayPreferences(file);await after.ready;assert.equal(after.value.controlMode,'adaptive')
})
await test('controller human input cannot change AI ledger or launch helpers',async()=>{
 const written=[],effects=[],o=new OverlayController({now:()=>now,preferences:{value:{...PREFERENCE_DEFAULTS,controlMode:'adaptive'}},powershell:'unused',spawn:()=>{throw Error('No process may start in fixture')}})
 try{o.capabilities={adaptiveControl:true};o.ready=true;o.dead=false;o.activated=true;o.child={stdin:{write:text=>{written.push(JSON.parse(text));return true}}};o.onMotionEvent=e=>effects.push(e.kind)
  o.observeHuman({kind:'human-observer-status',session:'fixture',status:'connected'});o.observeHuman(human('down',{heldKeys:[65]}))
  assert.equal(o.realState.keys.size,0);assert.equal(o.realState.session,undefined);assert.equal(written.at(-1).lastActor,'human');assert.deepEqual(written.at(-1).keys,['a']);assert.ok(effects.includes('human-input'))
  o.observeHuman({kind:'human-observer-status',session:'fixture',status:'stopped'});assert.equal(o.adaptive.lastActor,'human');assert.deepEqual(written.at(-1).keys,[])
 }finally{o.child=null;await o.close()}
 const fake=Object.create(OverlayManagement.prototype);fake.overlay={ready:true,dead:false,capabilities:{management:true}}
 await assert.rejects(fake.updatePreferences({controlMode:'adaptive'},0),{code:'unsupported'})
})
await test('settings UI controls and backward capability guard',async()=>{
 let definition;const old=globalThis.window
 try{globalThis.window={__ModuleLoader__:{load:d=>{definition=d}}};await import(pathToFileURL(join(root,'client.js')).href+'?adaptive='+randomUUID())
  const React={useId:()=> 'adaptive-fixture',createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)})},ui=definition.factory(()=>React),collect=(n,p,out=[])=>{if(n&&typeof n==='object'){if(p(n))out.push(n);for(const c of n.children??[])collect(c,p,out)}return out}
  const calls=[],p={manager:{set:(...args)=>calls.push(args)},state:{status:'ready',pending:''},value:{preferences:{controlMode:'ai-only',modelInfoVisible:true},capabilities:{adaptiveControl:true,modelInfoVisibility:true}},t:k=>k}
  let tree=ui.ControlDisplaySettings(p),select=collect(tree,n=>n.type==='select')[0],toggle=collect(tree,n=>typeof n.type==='function'&&n.type.name==='SwitchControl')[0]
  select.props.onChange({target:{value:'adaptive'}});toggle.props.onChange(false);assert.deepEqual(calls,[['controlMode','adaptive'],['modelInfoVisible',false]])
  p.state.pending='save';tree=ui.ControlDisplaySettings(p);assert.equal(collect(tree,n=>n.type==='select')[0].props.disabled,true)
  p.state.pending='';p.value.capabilities.adaptiveControl=false;tree=ui.ControlDisplaySettings(p);assert.equal(collect(tree,n=>n.type==='option'&&n.props.value==='adaptive')[0].props.disabled,true)
  for(const lang of ['zh','en'])for(const key of ['controlMode','controlMode.adaptive','controlModeHint','modelInfoVisible','modelInfoVisibleHint'])assert.ok(ui.locales[lang]['local.'+key])
 }finally{if(old===undefined)delete globalThis.window;else globalThis.window=old}
})
await test('actual renderer header sticky footer toggle warnings and preview separation',async()=>{
 const elements=new Map(),classes=new Set();let listener
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',attrs:{},title:'',style:{setProperty(){}},setAttribute(k,v){this.attrs[k]=v},addEventListener(){},getContext(){return {clearRect(){}}}});return elements.get(id)}
 const doc={querySelector:element,body:{style:{setProperty(){}},classList:{toggle:(k,on)=>on?classes.add(k):classes.delete(k)}}}
 class Scheduler{constructor(){this.visible=false}touch(){}setVisible(v){this.visible=v}setAnimating(){}dispose(){}}
 const context=vm.createContext({document:doc,window:{chrome:{webview:{postMessage(){},addEventListener:(kind,cb)=>{listener=cb}}},addEventListener(){}},performance:{now:()=>0},ResizeObserver:class{observe(){}disconnect(){}},FrameScheduler:Scheduler,CursorProgress:class{},actorText,displayText:s=>s.status==='locked'?'输入已锁定':s.status==='unknown'?'连接 / 释放状态未知':'普通底部文字',setTimeout:()=>0,clearTimeout(){},console})
 vm.runInContext((await fs.readFile(join(root,'desktop/renderer.js'),'utf8')).replace(/^import .*$/gm,''),context)
 const send=data=>listener({data});send({kind:'state',...state(),controlMode:'adaptive',lastActor:'human'});assert.equal(element('#identity').textContent,'人控制')
 send({kind:'display-preferences',modelInfoVisible:false});assert.equal(classes.has('hide-model-info'),true);assert.equal(element('footer').attrs['aria-hidden'],'true');assert.equal(element('#identity').textContent,'人控制')
 send({kind:'state',...state(),mode:'simulation',controlMode:'adaptive',lastActor:'ai'});assert.equal(element('#identity').textContent,'AI控制');assert.match(element('#control-notes').textContent,/模拟预览/)
 send({kind:'state',...state(),status:'locked',controlMode:'adaptive',lastActor:'ai'});assert.equal(classes.has('warning'),true);assert.equal(element('footer').attrs['aria-hidden'],'false');assert.equal(element('#capabilities').attrs['aria-hidden'],'true')
 send({kind:'display-preferences',modelInfoVisible:true});assert.equal(classes.has('hide-model-info'),false)
 assert.deepEqual(footerPresentation(false,'ready'),{hidden:true,capabilitiesHidden:true});assert.equal(footerPresentation(false,'unknown').hidden,false)
})
await test('native read-only structure and source metadata',async()=>{
 const observer=await fs.readFile(join(root,'desktop/HumanInputObserver.cs'),'utf8'),input=await fs.readFile(join(root,'src/native.cs'),'utf8'),keyboard=await fs.readFile(join(root,'src/overlay-window.cs'),'utf8')
 assert.doesNotMatch(observer,/SendInput|ToUnicode|GetClipboard|WriteAllText/);assert.equal((observer.match(/return CallNextHookEx/g)??[]).length,2);assert.match(observer,/queue.Count>=128/);assert.match(observer,/WaitOne\(250\)/);assert.match(observer,/now-lastHeartbeat>=250/);assert.doesNotMatch(observer,/batch.Count==0/)
 assert.match(input,/InputSourceTag = 0x44534847/);assert.equal((input.match(/dwExtraInfo = new IntPtr\(InputSourceTag\)/g)??[]).length,2)
 assert.match(keyboard,/lastActor=="human"\?"人控制":lastActor=="ai"\?"AI控制"/)
})
console.log(JSON.stringify({ok:true,groups:groups.length,scenarios:groups,hooksInstalled:false,inputInjected:false,userSettingsModified:false},null,2))
