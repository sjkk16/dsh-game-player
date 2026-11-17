import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { PwshBridge } from '../src/pwsh-bridge.js'
import { PerformanceTimings } from '../src/performance-timings.js'
import { OverlayManagement } from '../src/overlay-management.js'
import { OVERLAY_CONTRIBUTION, OverlayRemote } from '../src/overlay-remote.js'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import {createSettingsHarness,collect} from './settings-fixture.mjs'
const source=await readFile(new URL('../client.js',import.meta.url),'utf8');let definition
vm.runInNewContext(source,{AbortController,window:{__ModuleLoader__:{load:v=>definition=v}}})
const ui=definition.factory(()=>({})),tick=()=>new Promise(r=>setTimeout(r,0))
function fixture(custom=()=>{}){
  const events=[],children=[]
  const bridge=new PwshBridge({powershell:'fake',timeoutMs:1500,spawn(exe,args,options){
    assert.equal(options.windowsHide,true)
    const role=args.includes('-Watchdog')?'guard':args.some(a=>a.endsWith('readonly-helper.ps1'))?'reader':'worker'
    if(role==='reader'){assert.ok(!args.includes('-ObserveInput'));assert.ok(!args.includes('-RecordingLog'))}
    const child=new EventEmitter();child.pid=100+children.length;child.stdout=new PassThrough();child.stderr=new PassThrough()
    const reply=(r,v={})=>child.stdout.write(JSON.stringify({id:r.id,ok:true,protocolVersion:role==='reader'?1:4,readOnly:role==='reader',recording:false,state:0,released:true,heldKeys:[],heldButtons:[],...v})+'\n')
    child.stdin=new Writable({write(chunk,enc,done){const request=JSON.parse(chunk);events.push({role,op:request.op});const v=custom({role,request,reply,child});if(v!=='drop')queueMicrotask(()=>reply(request,v));done()}})
    child.kill=()=>{if(child.killed)return;child.killed=true;child.emit('exit',0,null);child.emit('close',0,null)}
    child.stdin.on('finish',()=>queueMicrotask(child.kill));children.push(child);return child
  }})
  return {bridge,events,children}
}
const input={op:'input',ownerId:1,actions:[{kind:'keydown',keys:['w']}]}
// A blocked input must neither block the screenshot lane nor cause read faults to unlock input.
{
  let entered;const started=new Promise(r=>entered=r)
  const f=fixture(({request})=>{if(request.op==='input'){entered();return 'drop'}}),abort=new AbortController()
  const pending=f.bridge.request(input,abort.signal);await started
  const frame=await Promise.race([f.bridge.request({op:'frame'}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Read-only queue blocked by input')),500);t.unref()})]);assert.equal(frame.ok,true)
  assert.equal(f.bridge.worker.dead,false);abort.abort();await assert.rejects(pending,e=>e.code==='ABORTED'&&e.released===true);await f.bridge.close()
}
{
  const f=fixture();f.bridge.inputFault=true
  await f.bridge.request({op:'frame'});assert.equal(f.bridge.worker,undefined)
  await assert.rejects(f.bridge.requestReadOnly(input),e=>e.code==='READONLY_OPERATION')
  await assert.rejects(f.bridge.request(input),e=>e.code==='INPUT_UNSAFE');assert.equal(f.bridge.inputFault,true);await f.bridge.close()
}
{
  const f=fixture(({request})=>request.op==='frame'?'drop':undefined);f.bridge.timeoutMs=20
  await assert.rejects(f.bridge.request({op:'frame'}),e=>e.code==='HELPER_TIMEOUT'&&e.released===undefined)
  assert.equal(f.bridge.inputFault,false);assert.ok(f.children[0].killed);assert.equal(f.events.some(e=>e.op==='cancel'),false);await f.bridge.close()
}
{
  const f=fixture();await f.bridge.request({op:'frame'});f.bridge.reader.child.kill();await tick();await f.bridge.request({op:'frame'});assert.equal(f.children.length,2);await f.bridge.close();assert.ok(f.children.every(c=>c.killed))
}
{
  const t=new PerformanceTimings(4);for(let i=0;i<50;i++)t.record('captureMs',i);t.record('secret',999);t.record('captureMs','private text');assert.deepEqual(t.snapshot(),{captureMs:{count:4,p50:47,p95:49}})
}
// Lightweight refresh coalesces source reads and excludes diagnostics.
{
  let now=0,reads=0,checks=0,diagnostics=0
  const m=Object.create(OverlayManagement.prototype)
  const store={ready:Promise.resolve(),revision:0,value:{},snapshot:()=>({revision:0,preferences:{}}),refresh:async()=>{reads++}}
  Object.assign(m,{store,library:{ready:Promise.resolve(),refresh:async()=>{reads++},snapshot:()=>({})},models:{snapshot:()=>({}),checkProof:async()=>{checks++}},motions:{snapshot:()=>({})},now:()=>now,sourcesCheckedAt:-Infinity,sourcesTask:null,stateGeneration:'generation',stateRevision:0,stateSignature:'',timings:new PerformanceTimings(),overlay:{ready:false,dead:false,enabled:true,desktop:'not-present',useDesktop:false,runtime:{phase:'not-started'},capabilities:{},getInputDiagnostics:async()=>{diagnostics++;return {}}},canDiscover:()=>false,canPreview:()=>true})
  await Promise.all([m.getSummary(),m.getSummary()]);assert.equal(reads,2);assert.equal(checks,1);assert.equal(diagnostics,0)
  now=4999;const first=await m.getSummary();assert.equal(reads,2);assert.equal('inputDiagnostics'in first,false)
  now=5000;await m.getSummary();assert.equal(reads,4)
  await m.getState();assert.equal(diagnostics,1);assert.equal(reads,6)
}
// Canceling a startup/active read leaves the input worker and fault latch untouched.
{
 let entered;const started=new Promise(r=>entered=r)
 const f=fixture(({role,request})=>{if(role==='reader'&&request.op==='probe'){entered();return 'drop'}}),abort=new AbortController()
 const pending=f.bridge.request({op:'frame'},abort.signal);await started;abort.abort();await assert.rejects(pending,e=>e.code==='ABORTED');await f.bridge.readQueue;assert.ok(f.children[0].killed);assert.equal(f.bridge.worker,undefined);assert.equal(f.bridge.inputFault,false);await f.bridge.close()
}
{
 const f=fixture();await f.bridge.request({op:'frame'});const abort=new AbortController();abort.abort();await assert.rejects(f.bridge.request({op:'frame'},abort.signal),e=>e.code==='ABORTED');assert.equal(f.children.length,1);await f.bridge.close()
}
assert.ok(OVERLAY_CONTRIBUTION.invocations.some(v=>v.method==='getSummary'));assert.throws(()=>OverlayRemote.prototype.owner.call({ctx:{invocation:{peer:{principal:{kind:'agent'}}}}}),e=>e.code==='owner_required')
// Read-only capability fallback never replays commands or hides permission failures.
for(const mode of ['new','legacy','permission']){
  const calls=[],doc={visibilityState:'visible',addEventListener(){},removeEventListener(){}},manager=new ui.OverlayUIController({document:doc,setTimer:()=>1,clearTimer(){}})
  let notifications=0
  const state={revision:1,stateGeneration:'g',stateRevision:1,preferences:{}}
  const connection={rpc:{call:async(_api,method)=>{calls.push(method);if(method.endsWith('/getSummary')&&mode!=='new')return {ok:false,error:{code:mode==='legacy'?'gateway/invocation-not-found':'owner_required',message:'denied'}};return {ok:true,value:{...state,...(method.endsWith('/getState')?{inputDiagnostics:{controller:{}},performanceDiagnostics:{captureMs:{count:1,p50:1,p95:1}}}:{})}}}}}
  const detach=manager.attach(connection),unsubscribe=manager.subscribe(()=>notifications++);await tick()
  if(mode==='permission'){assert.deepEqual(calls,['gamePlayerOverlay/getSummary']);assert.equal(manager.snapshot.status,'unavailable')}
  else{assert.equal(manager.snapshot.status,'ready');const prior=manager.snapshot;await manager.refresh();assert.equal(manager.snapshot,prior);if(mode==='legacy')assert.deepEqual(calls.slice(0,2),['gamePlayerOverlay/getSummary','gamePlayerOverlay/getState']);manager.setDiagnosticsOpen(true);await tick();assert.equal(calls.at(-1),'gamePlayerOverlay/getState');await manager.refresh();assert.equal(calls.at(-1),mode==='new'?'gamePlayerOverlay/getSummary':'gamePlayerOverlay/getState');assert.ok(manager.snapshot.value.performanceDiagnostics);manager.setDiagnosticsOpen(false)}
  doc.visibilityState='hidden';const count=calls.length;await manager.refresh();assert.equal(calls.length,count);unsubscribe();detach();assert.equal(manager.timer,null)
}
{
 const h=createSettingsHarness();let subscriptions=0;h.controller.subscribe=()=>{subscriptions++;return()=>{}};h.manager.subscribe=()=>{subscriptions++;return()=>{}}
 h.render('GamePlayerSettings',{...h.props,view:'summary'},'summary');assert.equal(subscriptions,0)
 const owners=new Set();h.manager.setDiagnosticsOpen=(open,owner)=>{if(open)owners.add(owner);else owners.delete(owner)}
 let tree=h.render();collect(tree,n=>n.props?.role==='tab'&&n.props.key==='safety')[0].props.onClick();tree=h.render()
 collect(tree,n=>typeof n.props?.onToggle==='function')[0].props.onToggle({currentTarget:{open:true}});tree=h.render();assert.equal(owners.size,1)
 collect(tree,n=>n.props?.role==='tab'&&n.props.key==='models')[0].props.onClick();h.render();assert.equal(owners.size,0);h.close()
}
const helper=await readFile(new URL('../src/readonly-helper.ps1',import.meta.url),'utf8');assert.doesNotMatch(helper,/::Initialize|ObserveInput|ledger-target|input-observation|SendInput/)
console.log('Performance regression passed: independent capture queue, read-only lifecycle/fault isolation, bounded timings, 5-second source refresh, state deduplication, owner guard and legacy fallback. No native processes or real input.')
