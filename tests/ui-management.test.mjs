import {desktopExecutable} from '../src/desktop-runtime.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { OverlayPreferences, PREFERENCE_DEFAULTS, migratePreferences, validatePreferencePatch } from '../src/overlay-preferences.js'
import { OverlayController } from '../src/overlay.js'
import { OverlayManagement } from '../src/overlay-management.js'
import { OverlayRemote, OVERLAY_CONTRIBUTION } from '../src/overlay-remote.js'

async function fixture(run, io) {
  const base=resolve('.qa'),root=join(base,'ui-test-'+randomUUID());await fs.mkdir(root,{recursive:true})
  try {const store=new OverlayPreferences(join(root,'overlay.json'),{io});await store.ready;await run(store,root)}
  finally {assert.ok(root.startsWith(base+'\\'));await fs.rm(root,{recursive:true,force:true})}
}
function nativeHarness(store,{protocol=3,failLoad=false,loadDelay=0,preview,modelCapabilities=[true],readyDelay=0,controlDelay=0}={}) {
  const records=[],children=[],launches=[]
  const overlay=new OverlayController({preferences:store,settingsPath:store.path,useDesktop:true,desktop:desktopExecutable(),powershell:'fake',preview,
    spawn(executable,args){
      const index=children.length,modelAvailable=modelCapabilities[Math.min(index,modelCapabilities.length-1)]
      const deferred=args.includes('--defer-model')&&args[args.indexOf('--defer-model')+1]==='true'
      launches.push({executable,args})
      let modelLoaded=modelAvailable&&!deferred,hidden=false,readyTimer
      const child=new EventEmitter();child.pid=42;child.stdout=new PassThrough();child.stderr=new PassThrough()
      const output=value=>child.stdout.write(JSON.stringify(value)+'\n')
      const snapshot=()=>({phase:modelLoaded?'ready':'fallback',visible:overlay.activated&&overlay.visibilityHolds===0&&!hidden,userHidden:hidden,renderer:modelLoaded?'live2d':'keyboard',modelLoaded,error:modelAvailable?null:'Renderer initialization failed',errorCode:modelAvailable?null:'runtime_start_failed'})
      child.stdin=new Writable({write(buffer,_,callback){
        const data=JSON.parse(buffer);records.push(data)
        if(data.kind==='state')output({kind:'status',state:{...snapshot(),visible:data.activated&&!hidden}})
        else if(data.kind==='load-model')setTimeout(()=>output({kind:'ack',id:data.id,ok:!failLoad&&modelAvailable,error:failLoad?'Broken model':modelAvailable?null:'Renderer unavailable'}),loadDelay)
        else if(data.kind==='commit-model'){modelLoaded=true;output({kind:'status',state:snapshot()});output({kind:'ack',id:data.id,ok:true})}
        else if(data.kind==='control'){if(data.action==='hide')hidden=true;else if(data.action==='show')hidden=false;output({kind:'status',state:snapshot()});if(controlDelay)setTimeout(()=>output({kind:'ack',id:data.id,ok:true}),controlDelay);else output({kind:'ack',id:data.id,ok:true})}
        else output({kind:'ack',id:data.id,ok:true,applied:true,hidden:data.hidden})
        callback()
      }})
      const finish=()=>{clearTimeout(readyTimer);child.emit('exit',0);child.emit('close',0)}
      child.stdin.on('finish',finish);child.kill=finish;children.push(child)
      const announce=()=>output({kind:'ready',protocolVersion:protocol,renderer:modelLoaded?'live2d':'keyboard',modelLoaded,error:modelAvailable?null:'Renderer initialization failed',errorCode:modelAvailable?null:'runtime_start_failed',capabilities:{management:protocol===3,model:protocol===3&&modelAvailable,picker:true},bounds:{x:-1920,y:0,width:4480,height:1440}})
      if(readyDelay)readyTimer=setTimeout(announce,readyDelay);else queueMicrotask(announce)
      return child
    },
  })
  const manager=new OverlayManagement(overlay,{utility:async()=>({path:null})})
  return {overlay,manager,records,children,launches,close:async()=>{await manager.close();await overlay.close()}}
}

test('preference migration preserves old layout, clamps limits and persists no input data',()=>{
  const old=migratePreferences({Version:2,View:'bongo',WidthDip:680,Opacity:.85,X:-100,Y:5,heldKeys:['secret']})
  assert.equal(old.widthDip,420);assert.equal(old.keyboardWidthDip,680);assert.equal(old.x,-100);assert.equal(old.opacity,.85)
  assert.equal('heldKeys' in old,false);assert.equal(migratePreferences({widthDip:9999}).widthDip,1000)
  for(const patch of [{opacity:.4},{widthDip:NaN},{unknown:true},{modelPath:'https://example.com/model'},{modelPath:'\\\\server\\share\\a'}])assert.throws(()=>validatePreferencePatch(patch))
})
test('opening preferences creates no settings file; revision writes are atomic and reject stale entry',async()=>fixture(async(store,root)=>{
  assert.deepEqual(store.value,{...PREFERENCE_DEFAULTS});await assert.rejects(fs.stat(store.path),{code:'ENOENT'})
  const a=store.update({widthDip:500},0),b=store.update({opacity:.8},0)
  await a;await assert.rejects(b,{code:'preference_conflict'});assert.equal(store.value.opacity,1)
  const saved=JSON.parse(await fs.readFile(store.path));assert.equal(saved.widthDip,500);assert.equal(saved.revision,1)
  assert.deepEqual((await fs.readdir(root)).filter(name=>/\.tmp$|\.lock$/.test(name)),[])
}))
test('external Host updates refresh once and conflict without a revision ping-pong',async()=>fixture(async store=>{
  await fs.writeFile(store.path,JSON.stringify({...PREFERENCE_DEFAULTS,widthDip:550}))
  await store.refresh();const revision=store.revision
  await store.refresh();assert.equal(store.revision,revision)
  await store.update({opacity:.9},revision);assert.equal(store.value.widthDip,550)
}))
test('failed write rolls back the applied native transaction and retains prior preferences',async()=>fixture(async(store,root)=>{
  const broken=new OverlayPreferences(store.path,{io:{...fs,writeFile:async()=>{throw new Error('disk full')}}});await broken.ready
  let rollback=0
  await assert.rejects(broken.update({widthDip:510},0,async()=>({rollback:async()=>rollback++})),/disk full/)
  assert.equal(rollback,1);assert.equal(broken.value.widthDip,420);await assert.rejects(fs.stat(store.path),{code:'ENOENT'})
  assert.deepEqual(await fs.readdir(root),[])
}))
test('failed final model commit restores disk and native preferences',async()=>fixture(async store=>{
  let rollback=0
  await assert.rejects(store.update({widthDip:530},0,async()=>({commit:async()=>{throw Error('renderer died')},rollback:async()=>rollback++})),/renderer died/)
  assert.equal(store.value.widthDip,420);assert.equal(JSON.parse(await fs.readFile(store.path)).widthDip,420);assert.equal(rollback,1)
}))
test('state reads and offline size changes never spawn any display or input helper',async()=>fixture(async store=>{
  const h=nativeHarness(store)
  try{await h.manager.getState();await h.manager.updatePreferences({widthDip:530,opacity:.75},0);assert.equal(h.children.length,0);assert.equal(store.value.widthDip,530)}finally{await h.close()}
}))
test('management rejects arbitrary resource paths, unknown commands and display while disabled',async()=>fixture(async store=>{
  const h=nativeHarness(store);h.overlay.enabledSource=()=>false
  try{
    await assert.rejects(h.manager.updatePreferences({modelPath:resolve('README.md')},0),/import/)
    await assert.rejects(h.manager.command('executeShell'),{code:'invalid_action'})
    await assert.rejects(h.manager.command('preview'),{code:'disabled'})
    assert.equal(h.children.length,0)
  }finally{await h.close()}
}))
test('v3 receives preferences before its first state and native geometry round-trips through one writer',async()=>fixture(async store=>{
  const h=nativeHarness(store)
  try{
    await h.manager.command('show');assert.ok(h.records.findIndex(v=>v.kind==='preferences')<h.records.findIndex(v=>v.kind==='state'))
    h.children[0].stdout.write(JSON.stringify({kind:'preferences-change',patch:{x:-500,y:40},revision:0})+'\n')
    await new Promise(resolve=>setTimeout(resolve,30));await store.queue
    assert.equal(store.value.x,-500);assert.equal(store.revision,1)
    assert.ok(h.records.some(v=>v.kind==='preferences'&&v.revision===1))
  }finally{await h.close()}
}))
test('broken model import leaves the working model preference unchanged and sends no commit',async()=>fixture(async store=>{
  const h=nativeHarness(store,{failLoad:true})
  h.manager.utility=async()=>({path:resolve('../Deepseek桌宠')})
  try{await assert.rejects(h.manager.command('importModelFolder'),/Broken model/);assert.equal(store.value.modelPath,null);assert.equal(h.records.filter(v=>v.kind==='commit-model').length,0);assert.equal(h.overlay.dead,true)}finally{await h.close()}
}))
test('model selection commits only after native validation and atomic save, then retires the hidden process',async()=>fixture(async store=>{
  const h=nativeHarness(store);h.manager.utility=async()=>({path:resolve('../Deepseek桌宠')})
  try{
    await h.manager.command('importModelFolder');assert.equal(store.value.modelPath,resolve('../Deepseek桌宠'))
    assert.ok(h.records.findIndex(v=>v.kind==='load-model')<h.records.findIndex(v=>v.kind==='commit-model'))
    assert.ok(h.records.filter(v=>v.kind==='state').every(v=>v.activated===false));assert.equal(h.overlay.dead,true)
  }finally{await h.close()}
}))
test('canceling a load cannot commit stale model data',async()=>fixture(async store=>{
  const h=nativeHarness(store,{loadDelay:150});h.manager.utility=async()=>({path:resolve('../Deepseek桌宠')})
  try{
    const pending=h.manager.command('importModelFolder');const deadline=Date.now()+1000
    while(!h.records.some(v=>v.kind==='load-model')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5))
    await h.manager.command('cancelLoad');await assert.rejects(pending)
    assert.equal(store.value.modelPath,null);assert.equal(h.records.some(v=>v.kind==='commit-model'),false)
  }finally{await h.close()}
}))
test('v2 backend remains available but never claims unsupported management succeeded',async()=>fixture(async store=>{
  const h=nativeHarness(store,{protocol:2})
  try{await assert.rejects(h.manager.command('show'),{code:'unsupported'});assert.equal(h.records.some(v=>v.kind==='preferences'),false);assert.equal(h.records.some(v=>v.kind==='control'),false)}finally{await h.close()}
}))
test('preview rejects held, uncertain and locked real input without spawning',async()=>fixture(async store=>{
  const h=nativeHarness(store);h.overlay.realState.session='real'
  try{
    for(const status of ['locked','unknown','releasing','syncing']){h.overlay.realState.status=status;await assert.rejects(h.manager.command('preview'),{code:'unsafe_preview'})}
    h.overlay.realState.status='ready';h.overlay.realState.keys.add('w');await assert.rejects(h.manager.command('preview'),{code:'unsafe_preview'})
    assert.equal(h.children.length,0)
  }finally{h.overlay.realState.keys.clear();await h.close()}
}))
test('temporary preview is explicitly simulated, cancelable and cannot stop a later real-input display',async()=>fixture(async store=>{
  const h=nativeHarness(store)
  try{
    const pending=h.manager.command('preview');while(!h.overlay.preview.controller)await new Promise(resolve=>setTimeout(resolve,2))
    assert.equal(h.overlay.state.mode,'simulation');h.overlay.beginReal();await pending
    assert.equal(h.overlay.state,h.overlay.realState);assert.equal(h.overlay.dead,false);assert.equal(h.children.length,1)
  }finally{await h.close()}
}))
test('canceling a temporary preview restores lazy startup and exits only its owned display',async()=>fixture(async store=>{
  const h=nativeHarness(store)
  try{
    const pending=h.manager.command('preview');while(!h.overlay.preview.controller)await new Promise(resolve=>setTimeout(resolve,2))
    await h.manager.command('stopPreview');await pending;assert.equal(h.overlay.dead,true);assert.equal(h.overlay.activated,false)
  }finally{await h.close()}
}))
test('Remote binding is strict, not a model tool, and enforces owner even outside Gateway policy',async()=>{
  const ctx=new Context();ctx.root.accessor('invocation',{get:()=>undefined})
  const service=new OverlayRemote(ctx,{getState:async()=>({revision:0,preferences:{...PREFERENCE_DEFAULTS}})})
  await assert.rejects(service.getState(),{code:'owner_required'})
  const owner=ctx.extend({invocation:{peer:{principal:{kind:'owner'}}}}).get('gamePlayerOverlay')
  assert.equal((await owner.getState()).revision,0)
  const guest=ctx.extend({invocation:{peer:{principal:{kind:'guest'}}}}).get('gamePlayerOverlay')
  await assert.rejects(guest.getState(),{code:'owner_required'})
  assert.deepEqual(OVERLAY_CONTRIBUTION.invocations.map(v=>v.method),['getState','updatePreferences','command'])
  for(const descriptor of OVERLAY_CONTRIBUTION.invocations)assert.equal(descriptor.result.mode,'strict')
})

test('AI input during transient display shutdown queues a restart without touching input transport',async()=>fixture(async store=>{
  const h=nativeHarness(store)
  try{
    await h.manager.command('show');const old=h.overlay.child,stopping=h.overlay.stopDisplay()
    h.overlay.beginReal();await stopping;await h.overlay.starting
    assert.equal(h.overlay.state,h.overlay.realState);assert.equal(h.overlay.ready,true);assert.notEqual(h.overlay.child,old)
  }finally{await h.close()}
}))

test('replacing a manual preview inherits the original temporary-display scope',async()=>fixture(async store=>{
 const h=nativeHarness(store)
 try{
  const first=h.manager.command('preview');while(!h.overlay.preview.controller)await new Promise(resolve=>setTimeout(resolve,2))
  const second=h.manager.command('preview');await new Promise(resolve=>setTimeout(resolve,10));await h.manager.command('stopPreview');await Promise.all([first,second])
  assert.equal(h.overlay.dead,true);assert.equal(h.overlay.activated,false)
 }finally{await h.close()}
}))
test('a real observation arriving after preview begins immediately restores the real channel',async()=>fixture(async store=>{
 const h=nativeHarness(store)
 try{
  h.overlay.observe({kind:'observation-status',status:'connected',session:'real',locked:false})
  const pending=h.manager.command('preview');while(!h.overlay.preview.controller)await new Promise(resolve=>setTimeout(resolve,2))
  h.overlay.observe({kind:'observation-status',status:'disconnected',session:'real',locked:true})
  await pending;assert.equal(h.overlay.state,h.overlay.realState);assert.equal(h.overlay.state.status,'locked');assert.equal(h.overlay.dead,false)
 }finally{await h.close()}
}))

test('cold model-file import defers the default model and retires only its hidden display',async()=>fixture(async store=>{
 const h=nativeHarness(store),chosen=resolve('../Deepseek桌宠/img/standard/cat_model/deepseek.model3.json');h.manager.utility=async()=>({path:chosen})
 try{await h.manager.command('importModelFile');assert.equal(store.value.modelPath,chosen);assert.equal(h.children.length,1);assert.equal(h.launches[0].args.at(-1),'true');assert.ok(h.records.filter(v=>v.kind==='state').every(v=>v.activated===false));assert.equal(h.overlay.child,undefined);assert.equal(h.overlay.visibilityHolds,0);assert.equal(h.overlay.deferModelStartup,0)}finally{await h.close()}
}))
test('model import recovers an existing keyboard fallback with one hidden renderer replacement',async()=>fixture(async store=>{
 const h=nativeHarness(store,{modelCapabilities:[false,true]});h.manager.utility=async()=>({path:resolve('../Deepseek桌宠')})
 try{await h.manager.command('show');const before=await h.manager.getState();assert.equal(before.visible,true);assert.equal(before.capabilities.model,false);assert.equal(before.capabilities.picker,true);await h.manager.command('importModelFolder');assert.equal(h.children.length,2);assert.equal(h.launches[1].args.at(-1),'true');assert.equal((await h.manager.getState()).modelLoaded,true);assert.equal((await h.manager.getState()).visible,true);assert.equal(h.overlay.visibilityHolds,0)}finally{await h.close()}
}))
test('a failed hidden retry is bounded and preserves the previous model preference',async()=>fixture(async store=>{
 const h=nativeHarness(store,{modelCapabilities:[false,false]});h.manager.utility=async()=>({path:resolve('../Deepseek桌宠')})
 try{await h.overlay.start({hidden:true});await assert.rejects(h.manager.command('importModelFile'),{code:'runtime_start_failed'});assert.equal(h.children.length,2);assert.equal(store.value.modelPath,null);assert.equal(h.records.some(v=>v.kind==='commit-model'),false);assert.equal(h.overlay.visibilityHolds,0)}finally{await h.close()}
}))
test('re-importing the saved model still validates it instead of skipping recovery as a no-op',async()=>fixture(async store=>{
 const chosen=resolve('../Deepseek桌宠');await store.update({modelPath:chosen},store.revision)
 const h=nativeHarness(store,{failLoad:true});h.manager.utility=async()=>({path:chosen})
 try{await assert.rejects(h.manager.command('importModelFolder'),/Broken model/);assert.ok(h.records.some(v=>v.kind==='load-model'));assert.equal(store.value.modelPath,chosen);assert.equal(h.records.some(v=>v.kind==='commit-model'),false)}finally{await h.close()}
}))
test('canceling an import file chooser never starts a renderer or changes preferences',async()=>fixture(async store=>{
 const h=nativeHarness(store)
 try{await h.manager.command('importModelFile');assert.equal(h.children.length,0);assert.equal(store.value.modelPath,null);assert.equal(h.manager.busy,null)}finally{await h.close()}
}))
test('show intent is recorded before startup and cancellation rejects late readiness',async()=>fixture(async store=>{
 const h=nativeHarness(store,{readyDelay:100}),cancel=new AbortController()
 try{const request=h.manager.command('show',cancel.signal);while(!h.children.length)await new Promise(r=>setImmediate(r));assert.equal(h.overlay.activated,true);const old=h.children[0];cancel.abort(new Error('Canceled show'));await assert.rejects(request,/Canceled show/);old.stdout.write(JSON.stringify({kind:'ready',protocolVersion:3,modelLoaded:true,capabilities:{management:true,model:true}})+'\n');assert.equal(h.overlay.ready,false);assert.equal(h.overlay.child,undefined);assert.equal(h.overlay.activated,false)}finally{await h.close()}
}))
test('canceling an older show cannot retire a newer AI display demand',async()=>fixture(async store=>{
 const h=nativeHarness(store,{readyDelay:30}),cancel=new AbortController()
 try{const request=h.manager.command('show',cancel.signal);while(!h.children.length)await new Promise(r=>setImmediate(r));h.overlay.beginReal();cancel.abort(new Error('Older request canceled'));await assert.rejects(request,/Older request canceled/);await h.overlay.starting;assert.equal(h.overlay.activated,true);assert.equal(h.overlay.ready,true);assert.equal(h.overlay.state,h.overlay.realState);assert.equal(h.children.length,1)}finally{await h.close()}
}))
test('startup wait and normal command timeout have separate defaults',()=>{
 const o=new OverlayController({enabled:false});assert.equal(o.startupTimeoutMs,55000);assert.equal(o.timeoutMs,30000)
})

test('canceling an acknowledged show side effect restores the prior hidden window',async()=>fixture(async store=>{
 const h=nativeHarness(store,{controlDelay:15})
 try{
  await h.manager.command('show');await h.manager.command('hide');assert.equal((await h.manager.getState()).visible,false)
  const cancel=new AbortController(),before=h.records.length,request=h.manager.command('show',cancel.signal)
  while(!h.records.slice(before).some(v=>v.kind==='control'&&v.action==='show'))await new Promise(r=>setImmediate(r))
  cancel.abort(new Error('Canceled after native show'));await assert.rejects(request,/Canceled after native show/)
  assert.equal((await h.manager.getState()).visible,false);assert.equal((await h.manager.getState()).userHidden,true)
 }finally{await h.close()}
}))
test('canceling fallback replacement keeps the prior display intent instead of clearing it',async()=>fixture(async store=>{
 const h=nativeHarness(store,{modelCapabilities:[false,true]});h.manager.utility=async()=>({path:resolve('../Deepseek桌宠')})
 try{
  await h.manager.command('show');const stop=h.overlay.stopDisplay.bind(h.overlay)
  h.overlay.stopDisplay=async reason=>{await stop(reason);await new Promise(r=>setTimeout(r,5))}
  const request=h.manager.command('importModelFile')
  while(!h.overlay.stopping&&!h.overlay.dead)await new Promise(r=>setImmediate(r))
  await h.manager.command('cancelLoad');await assert.rejects(request,{code:'canceled'})
  if(h.overlay.starting)await h.overlay.starting
  assert.equal(h.overlay.activated,true);assert.equal((await h.manager.getState()).visible,true);assert.equal(store.value.modelPath,null)
 }finally{await h.close()}
}))
