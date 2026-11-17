import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
let definition
const previousWindow=globalThis.window
globalThis.window={__ModuleLoader__:{load:value=>definition=value}}
await import('../client.js')
globalThis.window=previousWindow
const {OverlayUIController}=definition.factory(()=>({createElement(){}}))
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const deferred=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release}}
const modelKey='a'.repeat(64)
const identityState=()=>({revision:0,stateRevision:1,stateGeneration:'host-one',enabled:true,loading:false,
 preferences:{modelPath:'C:/models/pet.zip',modelEntry:'pet.model3.json',profilePath:null,modelOverrides:{},globalAdapter:{bindings:{mouseY:null,keyboard:{id:'CatParamLeftHandDown',reverse:false},mouseX:{id:'ParamMouseX',reverse:false}},effects:{headX:{ids:['ParamAngleX'],reverse:false},blink:{ids:['ParamEyeLOpen','ParamEyeROpen'],reverse:false}}}},
 adapterCatalog:{generation:randomUUID(),modelKey,handStyle:'default',
 inputs:[{role:'keyboard',id:'CatParamLeftHandDown',reverse:false},{role:'mouseX',id:'ParamMouseX',reverse:false},{role:'mouseY',id:null,reverse:false}],
 effects:[{role:'headX',ids:['ParamAngleX'],reverse:false},{role:'blink',ids:['ParamEyeLOpen','ParamEyeROpen'],reverse:false}]}})
function harness(){
 let remote=identityState(),handler,active=0,maximum=0,timer=0
 const calls=[],timers=new Map(),document={visibilityState:'visible',addEventListener(){},removeEventListener(){}}
 const controller=new OverlayUIController({document,setTimer:fn=>{timers.set(++timer,fn);return timer},clearTimer:id=>timers.delete(id)})
 const save=args=>{
  const patch=args.patch.modelAdapter
  assert.equal(args.revision,remote.revision);assert.equal(patch.catalogGeneration,remote.adapterCatalog.generation)
  const record=structuredClone(remote.preferences.globalAdapter??{})
  if(patch.reset){delete record.bindings;delete record.effects;remote.preferences.profilePath=null}
  for(const kind of ['bindings','effects'])if(patch[kind])record[kind]={...(record[kind]??{}),...patch[kind]}
  if(patch.handStyle)record.handStyle=patch.handStyle
  remote=structuredClone(remote);remote.preferences.globalAdapter=record;remote.revision++;remote.stateRevision++
  remote.adapterCatalog.generation=randomUUID();remote.adapterCatalog.handStyle=record.handStyle??'default'
  for(const kind of ['bindings','effects'])for(const row of remote.adapterCatalog[kind==='bindings'?'inputs':'effects']){
   if(Object.hasOwn(record[kind]??{},row.role))Object.assign(row,record[kind][row.role]??(kind==='bindings'?{id:null,reverse:false}:{ids:[],reverse:false}))
  }
  return {success:true,state:structuredClone(remote)}
 }
 handler=async args=>save(args)
 const connection={rpc:{call:async(_base,endpoint,envelope,signal)=>{
  if(endpoint.endsWith('/getState'))return {ok:true,value:structuredClone(remote)}
  calls.push({args:structuredClone(envelope.args),signal});active++;maximum=Math.max(maximum,active)
  try{if(endpoint.endsWith('/command')){remote=structuredClone(remote);remote.preferences.modelPath='C:/models/switched.zip';remote.adapterCatalog.modelKey='b'.repeat(64);remote.adapterCatalog.generation=randomUUID();remote.stateRevision++;return {ok:true,value:{success:true,state:structuredClone(remote)}}}return {ok:true,value:await handler(envelope.args,signal)}}finally{active--}
 }}}
 controller.attach(connection);controller.accept(structuredClone(remote),0,controller.generation)
 return {controller,calls,timers,document,connection,save,get remote(){return remote},set remote(value){remote=structuredClone(value)},set handler(value){handler=value},get maximum(){return maximum},
 edit(patch){return controller.set('modelAdapter',{catalogGeneration:controller.snapshot.value.adapterCatalog.generation,...patch})},
 poll(value=remote){return controller.accept(structuredClone(value),++controller.sequence,controller.generation)},close(){controller.detach()}}
}
test('adaptation saves immediately without a timer and confirms the persisted record',async()=>{
 const h=harness(),pending=h.edit({effects:{headX:{ids:['ParamAngleX'],reverse:true}}})
 assert.equal(h.controller.snapshot.adapterSave.status,'saving');assert.equal(h.timers.size,0)
 assert.equal(await pending,true);assert.equal(h.calls.length,1)
 assert.equal(h.controller.snapshot.adapterSave.status,'saved');assert.deepEqual(h.controller.snapshot.adapterSave.draft,{})
 assert.equal(h.remote.preferences.globalAdapter.effects.headX.reverse,true);h.close()
})
test('unchanged bindings, explicit none, groups and style do not write preferences',async()=>{
 const h=harness()
 for(const patch of [{bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:false}}},{bindings:{mouseY:null}},{effects:{blink:{ids:['ParamEyeROpen','ParamEyeLOpen'],reverse:false}}},{handStyle:'default'}])assert.equal(await h.edit(patch),true)
 assert.equal(h.calls.length,0)
 await h.edit({handStyle:'labels'});await h.edit({handStyle:'labels'});assert.equal(h.calls.length,1);h.close()
})
test('rapid edits merge by role and rebase only to the successful response catalog',async()=>{
 const h=harness(),gate=deferred();h.handler=async args=>{if(!h.remote.revision)await gate.promise;return h.save(args)}
 const pending=h.edit({bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:true}}});await tick()
 for(let n=0;n<100;n++)void h.edit({bindings:{mouseX:{id:'ParamMouseX',reverse:n%2===1}}})
 void h.edit({handStyle:'labels'});void h.edit({effects:{headX:{ids:['ParamAngleX'],reverse:true}}})
 gate.release();assert.equal(await pending,true)
 assert.equal(h.calls.length,2);assert.equal(h.maximum,1);assert.equal(h.calls[1].args.revision,1)
 assert.notEqual(h.calls[0].args.patch.modelAdapter.catalogGeneration,h.calls[1].args.patch.modelAdapter.catalogGeneration)
 assert.equal(h.remote.preferences.globalAdapter.bindings.keyboard.reverse,true)
 assert.equal(h.remote.preferences.globalAdapter.bindings.mouseX.reverse,true)
 assert.equal(h.remote.preferences.globalAdapter.effects.headX.reverse,true)
 assert.equal(h.remote.preferences.globalAdapter.handStyle,'labels');h.close()
})
test('the last edit to an in-flight role wins, including reversal back to the original',async()=>{
 const h=harness(),gate=deferred();h.handler=async args=>{if(!h.remote.revision)await gate.promise;return h.save(args)}
 const pending=h.edit({bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:true}}});await tick()
 void h.edit({bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:false}}})
 gate.release();await pending;assert.equal(h.calls.length,2);assert.equal(h.remote.preferences.globalAdapter.bindings.keyboard.reverse,false);h.close()
})
test('coalesced edits that already match the committed value do not send a duplicate request',async()=>{
 const h=harness(),gate=deferred();h.handler=async args=>{await gate.promise;return h.save(args)}
 const pending=h.edit({handStyle:'labels'});await tick();void h.edit({handStyle:'labels'})
 gate.release();await pending;assert.equal(h.calls.length,1);h.close()
})
test('both mounts observe shared progress and unmounting the final page does not abort saving',async()=>{
 const h=harness(),gate=deferred(),statuses=[]
 const a=h.controller.subscribe(()=>statuses.push(h.controller.snapshot.adapterSave.status)),b=h.controller.subscribe(()=>{})
 await tick();h.handler=async args=>{await gate.promise;return h.save(args)}
 const pending=h.edit({handStyle:'labels'});await tick();a();b()
 assert.equal(h.calls[0].signal.aborted,false);assert.equal(h.timers.size,0)
 gate.release();await pending;assert.equal(h.controller.snapshot.adapterSave.status,'saved');assert.ok(statuses.includes('saving'))
 const again=h.controller.subscribe(()=>{});await tick();assert.equal(h.controller.snapshot.adapterSave.status,'saved');again();h.close()
})
test('leaving the page before the queued mutation starts still persists the edit',async()=>{
 const h=harness(),unsubscribe=h.controller.subscribe(()=>{});await tick()
 const pending=h.edit({handStyle:'no-labels'});unsubscribe()
 assert.equal(await pending,true);assert.equal(h.remote.preferences.globalAdapter.handStyle,'no-labels');h.close()
})
test('ordinary rejection preserves merged unsaved edits and retries only when explicitly requested',async()=>{
 const h=harness(),gate=deferred();h.handler=async()=>{await gate.promise;return {success:false,error:{code:'invalid_adapter',message:'Not available'},state:structuredClone(h.remote)}}
 const pending=h.edit({handStyle:'labels'});await tick();void h.edit({effects:{headX:{ids:['ParamAngleX'],reverse:true}}})
 gate.release();assert.equal(await pending,false);assert.equal(h.calls.length,1)
 assert.equal(h.controller.snapshot.adapterSave.status,'failed');assert.equal(h.controller.snapshot.adapterSave.draft.handStyle,'labels')
 assert.equal(h.controller.snapshot.adapterSave.draft.effects.headX.reverse,true);await tick();assert.equal(h.calls.length,1)
 h.handler=async args=>h.save(args);assert.equal(await h.controller.retryAdapter(),true)
 assert.equal(h.calls.length,2);assert.equal(h.controller.snapshot.adapterSave.status,'saved');h.close()
})
test('transport failure retains the draft without claiming success or automatic replay',async()=>{
 const h=harness();h.handler=async()=>{throw Error('Connection lost')}
 assert.equal(await h.edit({handStyle:'labels'}),false);assert.equal(h.controller.snapshot.adapterSave.status,'failed')
 assert.match(h.controller.snapshot.adapterSave.error.message,/Connection lost/);h.poll();await tick();assert.equal(h.calls.length,1)
 h.handler=async args=>h.save(args);assert.equal(await h.controller.retryAdapter(),true);h.close()
})
for(const code of ['preference_conflict','stale_adapter_catalog','stale_model_resources','stale_model_catalog','library_conflict'])test(code+' cancels queued replay and disables retrying stale edits',async()=>{
 const h=harness(),gate=deferred();h.handler=async()=>{await gate.promise;return {success:false,error:{code,message:'Changed'},state:structuredClone(h.remote)}}
 const pending=h.edit({handStyle:'labels'});await tick();void h.edit({bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:true}}})
 gate.release();assert.equal(await pending,false);assert.equal(h.calls.length,1);assert.equal(h.controller.snapshot.adapterSave.status,'conflict')
 assert.deepEqual(h.controller.snapshot.adapterSave.draft,{});assert.equal(await h.controller.retryAdapter(),false);h.close()
})
test('switching the package entry, even with the same MOC key, rejects late success and pending edits',async()=>{
 const h=harness(),gate=deferred();h.handler=async args=>{await gate.promise;return h.save(args)}
 const pending=h.edit({handStyle:'labels'});await tick();void h.edit({effects:{headX:{ids:['ParamAngleX'],reverse:true}}})
 const switched=structuredClone(h.remote);switched.preferences.modelEntry='other.model3.json';switched.adapterCatalog.generation=randomUUID();switched.stateRevision++
 h.poll(switched);assert.equal(h.controller.snapshot.adapterSave.status,'conflict')
 gate.release();assert.equal(await pending,false);assert.equal(h.calls.length,1)
 assert.equal(h.controller.snapshot.value.preferences.modelEntry,'other.model3.json');assert.deepEqual(h.controller.snapshot.adapterSave.draft,{});h.close()
})
test('a catalog change while waiting behind another command cancels without issuing an adapter RPC',async()=>{
 const h=harness(),gate=deferred();h.controller.queue=gate.promise
 const pending=h.edit({handStyle:'labels'}),changed=structuredClone(h.remote);changed.adapterCatalog.generation=randomUUID();changed.stateRevision++
 h.poll(changed);gate.release();assert.equal(await pending,false);assert.equal(h.calls.length,0);assert.equal(h.controller.snapshot.adapterSave.status,'conflict');h.close()
})
test('intermediate polling during our commit does not rebase or discard later role edits',async()=>{
 const h=harness(),committed=deferred(),response=deferred();let first=true
 h.handler=async args=>{const result=h.save(args);if(first){first=false;committed.release();await response.promise}return result}
 const pending=h.edit({handStyle:'labels'});await committed.promise
 h.poll();assert.equal(h.controller.snapshot.adapterSave.status,'saving')
 void h.edit({bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:true}}})
 assert.equal(h.calls.length,1);response.release();assert.equal(await pending,true)
 assert.equal(h.calls.length,2);assert.equal(h.controller.snapshot.adapterSave.status,'saved');assert.equal(h.remote.preferences.globalAdapter.bindings.keyboard.reverse,true);h.close()
})
test('a newer state wins over an older successful mutation reply and prevents replay',async()=>{
 const h=harness(),committed=deferred(),response=deferred()
 h.handler=async args=>{const result=h.save(args);committed.release();await response.promise;return result}
 const pending=h.edit({handStyle:'labels'});await committed.promise;void h.edit({effects:{headX:{ids:['ParamAngleX'],reverse:true}}})
 const newer=structuredClone(h.remote);newer.stateRevision++;newer.revision++;newer.adapterCatalog.generation=randomUUID();newer.preferences.globalAdapter.handStyle='no-labels'
 h.poll(newer);response.release();assert.equal(await pending,false);assert.equal(h.calls.length,1)
 assert.equal(h.controller.snapshot.value.preferences.globalAdapter.handStyle,'no-labels');assert.equal(h.controller.snapshot.adapterSave.status,'conflict');h.close()
})
test('a success flag without the requested persisted record is never reported as saved',async()=>{
 const h=harness();h.handler=async()=>({success:true,state:structuredClone(h.remote)})
 assert.equal(await h.edit({handStyle:'labels'}),false);assert.equal(h.controller.snapshot.adapterSave.status,'conflict');h.close()
})
test('disconnecting invalidates in-flight confirmation without losing the unsaved draft',async()=>{
 const h=harness(),gate=deferred();h.handler=async args=>{await gate.promise;return h.save(args)}
 const pending=h.edit({handStyle:'labels'});await tick();h.controller.detach()
 assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.controller.snapshot.adapterSave.status,'failed');assert.equal(h.controller.snapshot.adapterSave.draft.handStyle,'labels')
 gate.release();assert.equal(await pending,false);assert.equal(h.controller.snapshot.adapterSave.status,'failed');assert.equal(h.controller.snapshot.value,null)
})
test('reset still clears manual mappings without resetting the selected hand style',async()=>{
 const h=harness();await h.edit({handStyle:'labels',bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:true}}})
 assert.equal(await h.edit({reset:true}),true);assert.equal(h.controller.snapshot.adapterSave.status,'saved')
 const record=h.remote.preferences.globalAdapter;assert.equal(record.handStyle,'labels');assert.equal(record.bindings,undefined);h.close()
})

test('edits queued behind a reset do not repeat the already committed reset',async()=>{
 const h=harness();await h.edit({bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:true}},handStyle:'labels'})
 const gate=deferred();let first=true;h.handler=async args=>{if(first){first=false;await gate.promise}return h.save(args)}
 const pending=h.edit({reset:true});await tick();void h.edit({bindings:{mouseX:{id:'ParamMouseX',reverse:true}}})
 gate.release();assert.equal(await pending,true);assert.equal(h.calls.length,3)
 assert.equal(h.calls[2].args.patch.modelAdapter.reset,undefined)
 assert.equal(h.remote.preferences.globalAdapter.bindings.mouseX.reverse,true);h.close()
})

test('an explicit global binding equal to the current automatic mapping is still persisted once',async()=>{
 const h=harness();const remote=structuredClone(h.remote);remote.preferences.globalAdapter={};h.remote=remote;h.poll()
 await h.edit({bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:false}}});assert.equal(h.calls.length,1);assert.deepEqual(h.remote.preferences.globalAdapter.bindings.keyboard,{id:'CatParamLeftHandDown',reverse:false})
 await h.edit({bindings:{keyboard:{id:'CatParamLeftHandDown',reverse:false}}});assert.equal(h.calls.length,1);h.close()
})
test('saved global selection is not replaced by the current model fallback during polling',async()=>{
 const h=harness();await h.edit({bindings:{keyboard:{id:'ParamAngleX',reverse:true}}})
 const next=structuredClone(h.remote);next.preferences.modelPath='C:/models/other.zip';next.adapterCatalog.modelKey='b'.repeat(64);next.adapterCatalog.generation=randomUUID();next.stateRevision++;next.adapterCatalog.inputs[0]={role:'keyboard',id:'OtherModelKeyboard',reverse:true};h.poll(next)
 assert.deepEqual(h.controller.snapshot.value.preferences.globalAdapter.bindings.keyboard,{id:'ParamAngleX',reverse:true});assert.equal(h.controller.snapshot.adapterSave.status,'saved');h.close()
})

test('a model switch waits for the entire serial global autosave job including queued edits',async()=>{
 const h=harness(),gate=deferred();let first=true;h.handler=async args=>{if(first){first=false;await gate.promise}return h.save(args)}
 const save=h.edit({bindings:{keyboard:{id:'ParamAngleX',reverse:true}}});await tick()
 const switching=h.controller.command({type:'selectModel',modelId:'model-1',catalogGeneration:'catalog',revision:0});void h.edit({handStyle:'labels'});assert.equal(h.calls.length,1)
 gate.release();assert.equal(await save,true);assert.equal(await switching,true);assert.equal(h.calls.length,3);assert.ok(h.calls[0].args.patch&&h.calls[1].args.patch);assert.equal(h.calls[2].args.action.type,'selectModel');assert.equal(h.controller.snapshot.value.preferences.globalAdapter.handStyle,'labels');assert.equal(h.controller.snapshot.adapterSave.status,'saved');h.close()
})

test('ordinary save failure preserves the global draft and prevents a local switch from discarding it',async()=>{
 const h=harness();h.handler=async()=>({success:false,error:{code:'EACCES',message:'Disk denied'},state:structuredClone(h.remote)})
 assert.equal(await h.edit({handStyle:'labels'}),false);assert.equal(await h.controller.command({type:'selectModel',modelId:'model-1'}),false);assert.equal(h.calls.length,1);assert.equal(h.controller.snapshot.adapterSave.status,'failed');assert.equal(h.controller.snapshot.adapterSave.draft.handStyle,'labels');assert.equal(h.controller.snapshot.failure.code,'adapter_unsaved');h.close()
})

test('external global changes clear old saved confirmation instead of showing the previous success',async()=>{
 const h=harness();await h.edit({handStyle:'labels'});assert.equal(h.controller.snapshot.adapterSave.status,'saved')
 const external=structuredClone(h.remote);external.preferences.globalAdapter.handStyle='no-labels';external.revision++;external.stateRevision++;external.adapterCatalog.generation=randomUUID();h.poll(external)
 assert.equal(h.controller.snapshot.adapterSave.status,'idle');assert.equal(h.controller.snapshot.value.preferences.globalAdapter.handStyle,'no-labels');h.close()
})
