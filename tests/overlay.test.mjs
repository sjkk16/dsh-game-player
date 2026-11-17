import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { InputDisplayState, InputPreview, isInputObservation } from '../src/overlay-state.js'
import { OverlayController } from '../src/overlay.js'
import { inputTool } from '../src/tools.js'
import { normalizeAction } from '../src/keys.js'
import { apply, resolveConfig } from '../index.js'
const tick=()=>new Promise(r=>setImmediate(r))
const event=(sequence,other={})=>({kind:'input-observation',session:'s1',sequence,source:'worker',timestamp:123,ownerId:1,event:'state',device:0,code:0,amount:0,state:0,uncertain:false,heldKeys:[],heldButtons:[],...other})
function connected(now){const s=new InputDisplayState(now);s.accept({kind:'observation-status',session:'s1',status:'connected'});return s}

test('snapshot state preserves holds; aliases, left/right and generic modifiers stay distinct',()=>{
  const s=connected();s.accept(event(1,{heldKeys:[17,160,165,87],heldButtons:[0]}));
  assert.deepEqual(s.snapshot().keys,['ctrl','lshift','ralt','w']);assert.deepEqual(s.snapshot().buttons,['left'])
  s.accept(event(2,{heldKeys:[17,160,165,87],heldButtons:[0]}));assert.equal(s.keys.size,4)
})
test('short taps remain visible as afterglow without lying about held state',()=>{
  let now=0;const s=connected(()=>now)
  s.accept(event(1,{event:'down',device:1,code:87,heldKeys:[87]}));now=30
  s.accept(event(2,{event:'up',device:1,code:87}));assert.equal(s.keys.size,0)
  assert.deepEqual(s.snapshot().pulses,[{id:'key:w',ms:180}]);now=211;assert.deepEqual(s.snapshot().pulses,[])
})
test('full snapshots repair dropped and out-of-order input, including an unseen short press',()=>{
  const s=connected();s.accept(event(1,{heldKeys:[87]}));s.accept(event(5,{source:'guard',event:'up',device:1,code:87,resync:true}))
  assert.equal(s.status,'syncing');assert.equal(s.keys.size,0)
  assert.equal(s.accept(event(4,{heldKeys:[87]})),false);assert.equal(s.accept(event(5)),false)
  s.accept(event(6));assert.equal(s.status,'ready');assert.equal(s.accept(event(7,{session:'old'})),false)
})
test('input faults and connection loss never claim confirmed releases',()=>{
  const s=connected();s.accept(event(1,{heldKeys:[87]}));s.accept(event(2,{event:'fault',device:1,code:87,heldKeys:[87],state:2}))
  assert.equal(s.status,'unknown');assert.deepEqual(s.snapshot().keys,['w'])
  s.accept({kind:'observation-status',session:'s1',status:'unknown'});assert.equal(s.keys.size,1)
  s.accept({kind:'observation-status',session:'s1',status:'released'});assert.equal(s.keys.size,0)
})
test('mouse wheel, movement, Unicode activity and unknown keys have safe display fallbacks',()=>{
  let now=0;const s=connected(()=>now)
  s.accept(event(1,{event:'wheel',device:2,amount:-120}));assert.equal(s.snapshot().wheelDirection,-1)
  s.accept(event(2,{event:'move',device:2}));assert.equal(s.snapshot().moveMs,180)
  s.accept(event(3,{event:'down',device:3,code:0,heldKeys:[255]}));assert.equal(s.snapshot().textMs,180)
  assert.deepEqual(s.snapshot().keys,['vk_255']);assert.equal(isInputObservation(event(4,{device:3,code:0x4e2d})),false)
  for(const bad of [{heldKeys:[999]},{heldButtons:[3]},{sequence:NaN},{uncertain:'false'}])assert.equal(isInputObservation(event(4,bad)),false)
})
test('104-key layout has unique IDs, numeric keypad and no physical-input collection code',async()=>{
  const layout=JSON.parse(await readFile(new URL('../src/overlay-layout.json',import.meta.url)))
  assert.equal(layout.keys.length,104);assert.equal(new Set(layout.keys.map(k=>k.id)).size,104)
  for(const id of ['lshift','rshift','num7','num0','decimal','numenter'])assert.ok(layout.keys.some(k=>k.id===id))
  const source=await readFile(new URL('../src/overlay-window.cs',import.meta.url),'utf8')
  for(const api of ['SendInput(','keybd_event(','mouse_event(','GetAsyncKeyState(','SetWindowsHookEx('])assert.equal(source.includes(api),false)
})
test('simulated sequences honor chord, double-click, drag, wheel, wait and repeat without a helper',async()=>{
  let now=0;const s=new InputDisplayState(()=>now),seen=[]
  const p=new InputPreview(s,()=>seen.push(s.snapshot()),{sleep:async ms=>{now+=ms}})
  p.start([{kind:'key',keys:['ctrl','s']},{kind:'click',count:2},{kind:'drag',fromX:0,fromY:0,x:10,y:10,steps:2},{kind:'scroll',amount:-120},{kind:'wait',durationMs:45}],2,3000)
  await p.done
  assert.ok(seen.some(v=>v.keys.includes('ctrl')&&v.keys.includes('s')))
  assert.equal(seen.filter(v=>v.buttons.includes('left')).length>=6,true)
  assert.equal(s.keys.size+s.buttons.size,0);assert.equal(s.mode,'simulation');assert.ok(now>=2*(30+28+60+28+76+45))
})
test('simulated persistent downs expire during wait; text is never serialized',async()=>{
  let now=0;const s=new InputDisplayState(()=>now),seen=[]
  const p=new InputPreview(s,()=>seen.push([now,s.snapshot()]),{sleep:async ms=>{now+=ms}})
  p.start([{kind:'keydown',keys:['w']},{kind:'wait',durationMs:100},{kind:'type',text:'private-password 中文'}],1,50)
  await p.done
  assert.ok(seen.some(([at,v])=>at===50&&!v.keys.length))
  assert.equal(JSON.stringify(seen).includes('private-password'),false)
})
test('new preview replaces an old one; cancellation cannot release the replacement keys',async()=>{
  let now=0,finish;const s=new InputDisplayState(()=>now)
  const p=new InputPreview(s,()=>{},{sleep:(ms,signal)=>new Promise(r=>{finish=()=>{now+=ms;r()};signal.addEventListener('abort',()=>r(),{once:true})})})
  p.start([{kind:'hold',keys:['w'],holdMs:300}],1);const old=p.done
  p.start([{kind:'hold',keys:['a'],holdMs:50}],1);await old
  assert.deepEqual([...s.keys],['a']);finish();await p.done;assert.equal(s.keys.size,0)
})

function harness({ready=true,failHide=false,backpressure=false,enabled,options={},ack}={}) {
  const commands=[],children=[],warnings=[]
  const factory=(exe,args,opts)=>{
    assert.equal(opts.windowsHide,true);assert.ok(args.includes('-STA'))
    const child=new EventEmitter();child.pid=900;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdout.setEncoding('utf8')
    child.stdin=new Writable({highWaterMark:backpressure?1:16384,write(buffer,_enc,done){const value=JSON.parse(buffer.toString());commands.push(value)
      if(value.kind!=='state')queueMicrotask(()=>child.stdout.write(JSON.stringify({kind:'ack',id:value.id,ok:!(failHide&&value.hidden),hidden:value.hidden,error:'hide failed',...(ack===undefined?{}:ack(value))})+'\n'))
      if(backpressure&&value.kind==='state')child.finishState=done;else done()
    }})
    child.releaseWrites=()=>{backpressure=false;child.finishState?.()}
    child.kill=()=>{if(child.dead)return;child.dead=true;child.emit('exit',0,null);child.emit('close',0,null)}
    child.stdin.on('finish',child.kill);children.push(child)
    if(ready)queueMicrotask(()=>child.stdout.write(JSON.stringify({kind:'ready',protocolVersion:2,affinitySupported:true})+'\n'))
    return child
  }
  const overlay=new OverlayController({spawn:factory,powershell:'fake',timeoutMs:100,warn:w=>warnings.push(w),...(enabled===undefined?{}:{enabled}),...options})
  return {overlay,commands,children,warnings}
}
test('overlay is lazy, isolated from real input, and disabled means no desktop process',async()=>{
  const h=harness();h.overlay.observe({kind:'observation-status',session:'s1',status:'connected'});assert.equal(h.children.length,0)
  h.overlay.beginReal();await h.overlay.starting;assert.equal(h.children.length,1);assert.equal(h.commands.at(-1).mode,'real');await h.overlay.close();assert.equal(h.children[0].dead,true)
  const d=new OverlayController({enabled:false,spawn:()=>{throw new Error('must not spawn')}});d.beginReal();d.simulate([]);assert.equal(await d.capture(async()=>42),42);await d.close()
})
test('the live panel switch closes the running display and a later enable starts a fresh one',async()=>{
  let enabled=true
  const h=harness({enabled:()=>enabled})
  assert.equal(h.overlay.enabled,true)
  h.overlay.beginReal();await h.overlay.starting;assert.equal(h.children.length,1)
  enabled=false
  await h.overlay.syncEnabled()
  assert.equal(h.children[0].dead,true);assert.equal(h.overlay.ready,false);assert.equal(h.overlay.stopped,false)
  assert.equal(await h.overlay.capture(async()=>7),7);assert.equal(h.children.length,1)
  h.overlay.beginReal();assert.equal(h.children.length,1)
  enabled=true
  await h.overlay.syncEnabled();assert.equal(h.overlay.enabled,true)
  h.overlay.beginReal();await h.overlay.starting;assert.equal(h.children.length,2)
  await h.overlay.close()
})
test('concurrent screenshots hide once or redundantly, but never restore before the last capture',async()=>{
  const h=harness();h.overlay.beginReal();await h.overlay.starting
  let finishA,finishB,enteredA,enteredB;const a=new Promise(r=>enteredA=r),b=new Promise(r=>enteredB=r)
  const ca=h.overlay.capture(()=>{enteredA();return new Promise(r=>finishA=r)})
  const cb=h.overlay.capture(()=>{enteredB();return new Promise(r=>finishB=r)})
  await Promise.all([a,b]);assert.equal(h.commands.filter(v=>v.kind==='capture').every(v=>v.hidden),true)
  finishA();await ca;assert.equal(h.commands.filter(v=>v.kind==='capture').at(-1).hidden,true)
  finishB();await cb;assert.equal(h.commands.filter(v=>v.kind==='capture').at(-1).hidden,false);await h.overlay.close()
})
test('capture already running before first input keeps newly created panel hidden',async()=>{
  const h=harness();let finish,entered;const entry=new Promise(r=>entered=r)
  const capture=h.overlay.capture(()=>{entered();return new Promise(r=>finish=r)})
  await entry;h.overlay.beginReal();await h.overlay.starting
  const hide=h.commands.findIndex(v=>v.kind==='capture'&&v.hidden),state=h.commands.findIndex(v=>v.kind==='state')
  assert.ok(hide>=0&&hide<state);finish();await capture;await h.overlay.close()
})
test('unconfirmed hiding fails screenshots closed and capture exceptions still restore',async()=>{
  const bad=harness({failHide:true});bad.overlay.beginReal();await bad.overlay.starting;let captured=0
  await assert.rejects(bad.overlay.capture(()=>captured++),/hide failed/);assert.equal(captured,0);await bad.overlay.close()
  const h=harness();h.overlay.beginReal();await h.overlay.starting;await assert.rejects(h.overlay.capture(()=>{throw new Error('capture failed')}),/capture failed/)
  assert.equal(h.commands.filter(v=>v.kind==='capture').at(-1).hidden,false);await h.overlay.close()
})
test('affinity fast path requires explicit backend verification, not just a successful Windows API',async()=>{
  const h=harness();h.overlay.beginReal();await h.overlay.starting
  await h.overlay.capture(async()=>1);assert.ok(h.commands.some(v=>v.kind==='capture'))
  h.commands.length=0;h.overlay.trustCaptureAffinity=true;await h.overlay.capture(async()=>1);assert.equal(h.commands.some(v=>v.kind==='capture'),false);await h.overlay.close()
})
test('a verified capture affinity keeps the panel visible instead of blinking for every screenshot',async()=>{
  const h=harness({options:{trustCaptureAffinity:true}})
  h.overlay.beginReal();await h.overlay.starting
  assert.equal(h.overlay.affinity,true)
  await h.overlay.capture(async()=>1)
  assert.equal(h.commands.some(v=>v.kind==='capture'),false,'no hide/show may be sent when the OS excludes the panel')
  await h.overlay.close()
})
test('an unverified affinity still uses acknowledged hide/show and can be downgraded at runtime',async()=>{
  const h=harness({ready:false,options:{trustCaptureAffinity:true}})
  h.overlay.beginReal()
  h.children[0].stdout.write('{"kind":"ready","protocolVersion":2,"affinitySupported":false}\n')
  await h.overlay.starting
  await h.overlay.capture(async()=>1)
  assert.deepEqual(h.commands.filter(v=>v.kind==='capture').map(v=>v.hidden),[true,false])
  h.children[0].stdout.write('{"kind":"affinity","affinitySupported":true}\n');await tick()
  h.commands.length=0
  await h.overlay.capture(async()=>1)
  assert.equal(h.commands.some(v=>v.kind==='capture'),false,'a verified upgrade may use the fast path')
  h.children[0].stdout.write('{"kind":"affinity","affinitySupported":false}\n');await tick()
  h.commands.length=0
  await h.overlay.capture(async()=>1)
  assert.deepEqual(h.commands.filter(v=>v.kind==='capture').map(v=>v.hidden),[true,false],'a downgrade must restore the safe path')
  await h.overlay.close()
})
test('user closure is sticky and display failure does not change input safety',async()=>{
  const h=harness();h.overlay.beginReal();await h.overlay.starting
  h.children[0].stdout.write('{"kind":"closed"}\n');h.children[0].kill();h.overlay.beginReal();h.overlay.simulate([])
  assert.equal(h.children.length,1);assert.equal(await h.overlay.capture(async()=>5),5);await h.overlay.close()
  const bad=harness({ready:false});bad.overlay.beginReal();await bad.overlay.starting;assert.match(bad.overlay.lastError,/timed out/);assert.ok(bad.warnings.length);await bad.overlay.close()
})
test('idle native observations cannot overwrite simulation, or simulation leak into real state',async()=>{
  const h=harness();h.overlay.observe({kind:'observation-status',session:'s1',status:'connected'})
  h.overlay.simulate([{kind:'hold',keys:['w'],holdMs:1000}],1,3000)
  await h.overlay.starting;await tick()
  h.overlay.observe(event(1,{heldKeys:[]}));assert.equal(h.overlay.state.mode,'simulation');assert.ok(h.overlay.state.keys.has('w'))
  h.overlay.beginReal();assert.equal(h.overlay.state.mode,'real');assert.equal(h.overlay.state.keys.size,0);await h.overlay.starting;await h.overlay.close()
})
test('display-only preview contains startup errors without any input transport',async()=>{
  const h=new OverlayController({spawn(){throw new Error('startup denied')},powershell:'fake'})
  h.simulate([normalizeAction({kind:'key',keys:['w']},3000)],1,3000)
  await tick();assert.match(h.lastError,/startup denied/);await h.close()
})
test('invalid/canceled input never reaches transport; defaults preserve approval',async()=>{
  let calls=0;const options=resolveConfig({},()=>{})
  assert.equal(options.overlayEnabled,true);assert.equal(options.requireApproval,true);assert.equal(Object.hasOwn(options,'dryRun'),false)
  const tool=inputTool({options,normalize:normalizeAction,send:async()=>{calls++;return{}}})
  await assert.rejects(tool.execute({kind:'key',keys:['not-a-key']},{}));const c=new AbortController();c.abort()
  await assert.rejects(tool.execute({kind:'key',keys:['w']},{signal:c.signal}));assert.equal(calls,0)
})
test('host rejects approval without preview, routes captures through overlay, and disposes both',async()=>{
  const calls=[],effects=[],tools=[],hooks=new Map(),seen=[]
  const overlay={observe(){},beginReal(){calls.push('real')},simulate(){calls.push('preview')},capture:async fn=>{calls.push('capture-guard');return fn()},close:async()=>calls.push('overlay-close')}
  const ctx={effect(fn){effects.push(fn())},logger:{warn(){}},on(n,f){hooks.set(n,f)},inject(){},tools:{register:t=>tools.push(t)},attachments:{saveImage:async()=>({attachmentId:'i'})}}
  apply(ctx,{}, {overlayFactory:options=>{seen.push(options);return overlay},bridgeFactory:()=>({close:async()=>calls.push('bridge-close'),request:async req=>{calls.push(req.op);return{data:'AA==',width:1,height:1,screenWidth:1,screenHeight:1,screenX:0,screenY:0,scale:1,mediaType:'image/png'}}})})
  assert.equal(seen[0].trustCaptureAffinity,true,'production opts into the runtime-verified fast path')
  const decision=await hooks.get('tools/pre-execute')({name:'game_input'},async()=>({kind:'deny'}));assert.equal(decision.kind,'deny');assert.deepEqual(calls,[])
  await assert.rejects(tools.find(t=>t.name==='game_input').execute({kind:'key',keys:['w']},{}),/owning agent/);assert.deepEqual(calls,[])
  await tools.find(t=>t.name==='game_screen').execute({}, {agent:{id:'a'}});assert.ok(calls.indexOf('capture-guard')<calls.indexOf('frame'))
  for(const dispose of effects.reverse())await dispose?.();assert.ok(calls.includes('bridge-close')&&calls.includes('overlay-close'))
})


test('slow display pipes coalesce thousands of states without buffering unbounded writes',async()=>{
  const h=harness({backpressure:true});h.overlay.beginReal();await h.overlay.starting
  h.overlay.observe({kind:'observation-status',session:'s1',status:'connected'})
  for(let i=1;i<=5000;i++)h.overlay.observe(event(i,{heldKeys:i===5000?[65]:[87]}))
  assert.equal(h.commands.filter(c=>c.kind==='state').length,1)
  assert.deepEqual(h.overlay.latest.keys,['a']);assert.ok(h.children[0].stdin.writableLength<4096)
  h.children[0].releaseWrites();await tick();assert.deepEqual(h.commands.at(-1).keys,['a']);await h.overlay.close()
})
test('cold-start simulation waits for a ready window instead of expiring invisibly',async()=>{
  const h=harness({ready:false});h.overlay.simulate([{kind:'hold',keys:['w'],holdMs:100}],1,3000)
  assert.equal(h.overlay.preview.controller,undefined)
  h.children[0].stdout.write('{"kind":"ready","protocolVersion":2,"affinitySupported":false}\n')
  await h.overlay.starting;await tick();assert.ok(h.overlay.state.keys.has('w'));await h.overlay.close()
})


test('a safety latch stays visible across new read-only helper sessions',()=>{
  const s=connected();s.accept(event(1,{heldKeys:[87]}))
  s.accept({kind:'observation-status',session:'s1',status:'unknown',locked:true});assert.equal(s.status,'locked')
  s.accept({kind:'observation-status',session:'s2',status:'connected',locked:true});assert.equal(s.status,'locked')
  s.accept(event(1,{session:'s2',locked:true}));assert.equal(s.status,'locked')
})

test('missing desktop executable falls back once to legacy keyboard without changing input',async()=>{
 const warnings=[],h=harness();let first=true
 const factory=h.overlay.spawn
 h.overlay.useDesktop=true;h.overlay.desktop='missing.exe'
 h.overlay.spawn=(exe,args,opts)=>{if(first){first=false;throw new Error('Desktop runtime missing')}return factory(exe,args,opts)}
 h.overlay.warn=w=>warnings.push(w);h.overlay.beginReal();await h.overlay.starting
 assert.equal(h.overlay.useDesktop,false);assert.equal(h.overlay.ready,true);assert.equal(h.children.length,1);assert.ok(warnings.some(w=>w.includes('missing')));await h.overlay.close()
})
test('desktop handshake carries screen bounds, warnings do not fail protocol',async()=>{
 const h=harness({ready:false});h.overlay.beginReal()
 h.children[0].stdout.write('{"kind":"warning","message":"optional model unavailable"}\n')
 h.children[0].stdout.write('{"kind":"ready","protocolVersion":2,"renderer":"live2d","bounds":{"x":-100,"y":0,"width":200,"height":100}}\n')
 await h.overlay.starting;assert.equal(h.overlay.renderer,'live2d');assert.equal(h.overlay.preview.bounds.x,-100);assert.equal(h.overlay.ready,true)
 h.children[0].stdout.write('{"kind":"bounds","bounds":{"x":0,"y":0,"width":0,"height":1}}\n');assert.equal(h.overlay.preview.bounds.width,200);await h.overlay.close()
})
test('the appearance payload reaches the panel before the first state and only when it changes',async()=>{
 const style={theme:'light',accent:'sky',layout:'tkl',skin:'builtin',colors:{background:'#F2F5FA',text:'#1B2430'}}
 const h=harness({options:{style:()=>style,view:()=>'keyboard'}})
 h.overlay.beginReal();await h.overlay.starting
 const kinds=h.commands.map(c=>c.kind)
 const viewAt=kinds.indexOf('view'),styleAt=kinds.indexOf('style'),stateAt=kinds.indexOf('state')
 assert.ok(viewAt>=0&&styleAt>viewAt,'the view is chosen before the palette arrives')
 assert.ok(stateAt>styleAt,'the panel is styled before its first state')
 assert.equal(h.commands.find(c=>c.kind==='view').view,'keyboard')
 assert.deepEqual(h.commands.find(c=>c.kind==='style').style,style)
 const sent=h.commands.filter(c=>c.kind==='style').length
 await h.overlay.syncStyle()
 assert.equal(h.commands.filter(c=>c.kind==='style').length,sent,'an unchanged payload is not resent')
 h.overlay.styleSource=()=>({...style,theme:'contrast'})
 await h.overlay.syncStyle()
 assert.equal(h.commands.filter(c=>c.kind==='style').length,sent+1)
 assert.equal(h.commands.filter(c=>c.kind==='style').at(-1).style.theme,'contrast')
 await h.overlay.close()
})
test('a panel that cannot switch views or load the image warns once and keeps painting',async()=>{
 const style={theme:'dark',layout:'compact',skin:'custom',colors:{background:'#111722'}}
 const h=harness({options:{style:()=>style,view:()=>'model'},ack:value=>value.kind==='view'?{applied:false,reason:'keyboard only'}:{applied:true,skinLoaded:false}})
 h.overlay.beginReal();await h.overlay.starting
 assert.equal(h.warnings.filter(w=>w.includes('could not apply the view')).length,1)
 assert.equal(h.warnings.filter(w=>w.includes('keyboard image')).length,1)
 // The same refusal is not repeated for the same value.
 await h.overlay.syncView();await h.overlay.syncStyle()
 assert.equal(h.warnings.filter(w=>w.includes('could not apply the view')).length,1)
 h.overlay.observe({kind:'observation-status',session:'s1',status:'connected'})
 assert.equal(await h.overlay.capture(async()=>9),9)
 assert.equal(h.warnings.some(w=>w.includes('capture')),false)
 await h.overlay.close()
})
test('a restarted display process receives the appearance again, a disabled one never spawns',async()=>{
 let enabled=true
 const h=harness({enabled:()=>enabled,options:{style:()=>({theme:'dark',layout:'full',skin:'builtin',colors:{}}),view:()=>'keyboard'}})
 h.overlay.beginReal();await h.overlay.starting
 const first=h.commands.filter(c=>c.kind==='style').length
 enabled=false;await h.overlay.syncEnabled()
 enabled=true;h.overlay.beginReal();await h.overlay.starting
 assert.equal(h.children.length,2)
 assert.equal(h.commands.filter(c=>c.kind==='style').length,first+1)
 const lastView=h.commands.filter(c=>c.kind==='view').length
 assert.equal(lastView,2)
 await h.overlay.close()
})
