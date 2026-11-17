import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { OVERLAY_CONTRIBUTION } from '../src/overlay-remote.js'
import { OverlayPreferences } from '../src/overlay-preferences.js'
import { OverlayManagement } from '../src/overlay-management.js'
import { createSettingsHarness, byKey, text } from './settings-fixture.mjs'

const command=OVERLAY_CONTRIBUTION.invocations.find(item=>item.method==='command')
assert.equal(command.parameters.length,1)
assert.equal(command.parameters[0].wire,'action')
assert.equal(command.parameters[0].codec.mode,'strict')
const actionCodec=command.parameters[0].codec.create()
let scenarios=0
const check=(name,run)=>{try{run();scenarios++}catch(cause){throw Error('Gateway action regression: '+name,{cause})}}
const expectedBoundary='typert gateway: gamePlayerOverlay/command: wire field "action" failed boundary validation'

check('the public gateway codec accepts ZIP and existing string commands',()=>{
  for(const action of ['addLibraryZip','addLibraryFile','addLibraryFolder','importModelFile','importModelFolder','cancelLoad','show','hide'])assert.equal(actionCodec.parse(action),action)
})
check('model library object actions remain strict and JSON safe',()=>{
  const generation=randomUUID(),id='a'.repeat(64)
  for(const action of [
    {type:'addLibraryModels',catalogGeneration:generation,modelIds:['model-0'],libraryRevision:0},
    {type:'selectLibraryModel',modelId:id,libraryRevision:1,revision:0},
    {type:'removeLibraryModel',modelId:id,libraryRevision:1,revision:0},
    {type:'setDisplayView',view:'keyboard',revision:0},
  ])assert.deepEqual(actionCodec.parse(JSON.parse(JSON.stringify(action))),action)
})
check('unknown actions, paths and bad object fields remain rejected',()=>{
  for(const action of [null,{},'addZip','addLibraryZip ',{type:'addLibraryZip'},{type:'addLibraryModels',catalogGeneration:'invalid',modelIds:['model-0'],libraryRevision:0},{type:'selectLibraryModel',modelId:'../model.zip',libraryRevision:0,revision:0},{type:'selectLibraryModel',modelId:'a'.repeat(64),libraryRevision:0,revision:0,path:'forbidden'}])assert.throws(()=>actionCodec.parse(action))
})
const harness=createSettingsHarness(),Controller=harness.ui.OverlayUIController
async function clientFixture(value,run){
  const calls=[],client=new Controller({document:{visibilityState:'hidden'}})
  const connection={rpc:{call:async(base,endpoint,envelope)=>{calls.push({base,endpoint,envelope});return {ok:true,value:{success:true,state:value}}}}}
  client.attach(connection);client.accept(value,1,client.generation)
  try{await run({client,connection,calls});scenarios++}finally{client.detach()}
}
const state={revision:0,preferences:{},capabilities:{library:true,picker:true},modelLibrary:{revision:0,items:[]}}
await clientFixture(state,async h=>{
  assert.equal(await h.client.command('addLibraryZip'),false)
  assert.equal(h.calls.length,0);assert.equal(h.client.snapshot.pending,'')
  assert.equal(h.client.snapshot.failure.code,'plugin_reload_required')
  assert.equal(h.client.snapshot.failure.action,'addLibraryZip')
  assert.ok(!h.client.snapshot.failure.message.includes('wire field'))
  await h.client.command('cancelLoad');assert.equal(h.calls.length,1);assert.equal(h.calls[0].envelope.args.action,'cancelLoad')
})
await clientFixture({...state,capabilities:{...state.capabilities,zipImport:false}},async h=>{
  assert.equal(await h.client.command('addLibraryZip'),false);assert.equal(h.calls.length,0)
})
await clientFixture({...state,capabilities:{...state.capabilities,zipImport:true}},async h=>{
  const calls=[]
  h.connection.rpc.call=async(base,endpoint,envelope)=>{
    assert.equal(endpoint,'gamePlayerOverlay/command')
    const wire=JSON.parse(JSON.stringify(envelope));calls.push(wire)
    assert.equal(actionCodec.parse(wire.args.action),'addLibraryZip')
    return {ok:true,value:{success:true,state:{...state,capabilities:{...state.capabilities,zipImport:true}}}}
  }
  assert.equal(await h.client.command('addLibraryZip'),true)
  assert.deepEqual(calls,[{args:{action:'addLibraryZip'}}]);assert.equal(h.client.snapshot.failure,null)
})
for(const error of [{code:'gateway/input-invalid',message:expectedBoundary},{message:expectedBoundary}])await clientFixture({...state,capabilities:{...state.capabilities,zipImport:true}},async h=>{
  h.connection.rpc.call=async(base,endpoint,envelope)=>{h.calls.push({endpoint,envelope});return {ok:false,error}}
  await h.client.command('addLibraryZip');assert.equal(h.calls.length,1)
  assert.equal(h.client.snapshot.failure.code,'plugin_reload_required')
  assert.equal(h.client.snapshot.failure.action,'addLibraryZip');assert.equal(h.client.snapshot.pending,'')
  assert.equal(h.calls[0].envelope.args.action,'addLibraryZip','No replay through a legacy direct import')
})
await clientFixture({...state,capabilities:{...state.capabilities,zipImport:true}},async h=>{
  h.connection.rpc.call=async()=>({ok:false,error:{code:'owner_required',message:'Owner only'}})
  await h.client.command('addLibraryZip');assert.equal(h.client.snapshot.failure.code,'owner_required');assert.equal(h.client.snapshot.failure.message,'Owner only')
})
await clientFixture(state,async h=>{
  h.connection.rpc.call=async()=>({ok:false,error:{code:'gateway/input-invalid',message:expectedBoundary}})
  await h.client.command('show');assert.equal(h.client.snapshot.failure.code,'gateway/input-invalid','Other action errors are not reclassified')
})
try{
  delete harness.state.value.capabilities.zipImport
  let tree=harness.render();assert.equal(byKey(tree,'addLibraryZip').props.disabled,true)
  assert.ok(text(byKey(tree,'add-reason')).includes('完全退出 DeepSeek Harness'))
  assert.equal(harness.calls.length,0)
  harness.state.value.capabilities.zipImport=true;tree=harness.render();assert.equal(byKey(tree,'addLibraryZip').props.disabled,false)
  byKey(tree,'addLibraryZip').props.onClick();assert.deepEqual(harness.calls,[['command','addLibraryZip']])
  harness.state.failure={code:'plugin_reload_required',message:expectedBoundary,action:'addLibraryZip'}
  tree=harness.render();assert.ok(text(byKey(tree,'add-failure')).includes('托盘后台'));assert.ok(!text(byKey(tree,'add-failure')).includes('wire field'))
  assert.equal(harness.ui.locales.en['local.pluginReloadRequired'].includes('Fully exit'),true)
  scenarios++
}finally{harness.close()}

const base=join(dirname(dirname(fileURLToPath(import.meta.url))),'.qa')
await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(join(base,'gateway-capabilities-')),real=await fs.realpath(directory)
assert.ok(real.startsWith(await fs.realpath(base)+sep))
let manager
try{
  const store=new OverlayPreferences(join(directory,'overlay.json'));await store.ready
  const native=join(directory,'mock-native.exe');await fs.writeFile(native,'')
  const overlay={preferences:store,desktop:native,useDesktop:true,defaultModel:join(directory,'no-default'),enabled:true,closed:false,runtime:{},capabilities:{},realState:{keys:new Set(),buttons:new Set()}}
  const utility=async()=>{throw Error('Capability reads must not launch native processes')};utility.supportsLibrary=true;utility.supportsDiscovery=true
  manager=new OverlayManagement(overlay,{utility})
  const value=await manager.getState();assert.equal(value.capabilities.zipImport,true)
  await fs.unlink(native);assert.equal((await manager.getState()).capabilities.zipImport,false)
  await assert.rejects(fs.stat(store.path),{code:'ENOENT'});scenarios++
}finally{manager?.lifetime.abort();assert.equal(await fs.realpath(directory),real);await fs.rm(directory,{recursive:true,force:true})}
console.log('Gateway action regression passed: '+scenarios+' isolated checks; current codec, legacy Host handshake, JSON wire, bounded error recovery, no legacy replay and strict rejection.')
