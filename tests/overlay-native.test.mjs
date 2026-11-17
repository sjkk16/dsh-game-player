import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PwshBridge } from '../src/pwsh-bridge.js'
import { InputDisplayState } from '../src/overlay-state.js'
const windows=process.platform==='win32'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
const act=(actions,maxHoldMs=3000)=>({op:'input',actions,ownerId:1,maxHoldMs})
async function until(fn,ms=5000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await delay(20)}throw new Error('Timed out waiting for observation')}
async function fixture(fn){const events=[],state=new InputDisplayState();const b=new PwshBridge({recording:true,timeoutMs:15000,onObservation:e=>{events.push(e);state.accept(e)}});try{await fn(b,events,state)}finally{if(b.guardChild)try{await b.testControl({failUps:false,failAt:-1},true)}catch{};await b.close()}}
test('native observation confirms down/up, mouse activity, and preserves Unicode privacy',{skip:!windows},()=>fixture(async(b,events,state)=>{
  const input=[{kind:'key',keys:['ctrl','s']},{kind:'click',button:'right'},{kind:'scroll',amount:-120},{kind:'move',x:1,y:1},{kind:'type',text:'秘密😀'}]
  await b.request(act(input));await until(()=>events.some(e=>e.event==='down'&&e.device===3))
  const native=events.filter(e=>e.kind==='input-observation')
  assert.ok(native.some(e=>e.event==='down'&&e.heldKeys.includes(17)))
  assert.ok(native.some(e=>e.event==='up'&&e.code===83));assert.ok(native.some(e=>e.event==='wheel'&&e.amount===-120));assert.ok(native.some(e=>e.event==='move'&&e.position?.x>=0&&e.position?.x<=1&&e.position?.y>=0&&e.position?.y<=1))
  for(const e of native.filter(e=>e.device===3))assert.equal(e.code,0)
  assert.equal(JSON.stringify(native).includes('秘密'),false)
  await until(()=>state.keys.size===0&&state.buttons.size===0)
}))
test('watchdog releases use global sequence and clear the display on hold expiry',{skip:!windows},()=>fixture(async(b,events,state)=>{
  await b.testControl({clock:1000},true);await b.request(act([{kind:'keydown',keys:['w']}],100))
  await until(()=>state.keys.has('w'));const down=events.find(e=>e.event==='down')
  await b.releaseAll();await until(()=>events.some(e=>e.event==='up'&&e.source==='guard'))
  const up=events.find(e=>e.event==='up'&&e.source==='guard');assert.ok(up.sequence>down.sequence);await until(()=>state.keys.size===0)
  await b.request(act([{kind:'keydown',keys:['a']}],100));await until(()=>state.keys.has('a'))
  await b.testControl({clock:1200},true);await until(()=>state.keys.size===0)
}))
test('failed down is uncertain rather than held; failed releases retain confirmed held state',{skip:!windows},()=>fixture(async(b,events,state)=>{
  await b.testControl({failAt:1},true)
  await assert.rejects(b.request(act([{kind:'keydown',keys:['w']}])));await until(()=>events.some(e=>e.event==='fault'))
  const fault=events.find(e=>e.event==='fault');assert.equal(fault.uncertain,true);assert.deepEqual(fault.heldKeys,[])
  await b.testControl({failAt:-1});await b.request(act([{kind:'keydown',keys:['a']}]))
  await b.testControl({failUps:true},true);await assert.rejects(b.request(act([{kind:'keyup',keys:['a']}])) )
  await until(()=>['unknown','locked'].includes(state.status));assert.ok(state.keys.has('a'))
  // Recording-only recovery; never leave a fault-injected release watchdog behind.
  await b.testControl({failUps:false},true);await b.releaseAll();await until(()=>state.keys.size===0)
}))


test('abrupt worker exit updates the display only after independent cleanup is confirmed',{skip:!windows},()=>fixture(async(b,events,state)=>{
  await b.request(act([{kind:'keydown',keys:['w']}]))
  await until(()=>state.keys.has('w'));b.child.kill()
  await until(()=>events.some(e=>e.kind==='observation-status'&&e.status==='released'))
  assert.equal(state.keys.size,0)
}))

test('v4 mouse target survives watchdog snapshots without reading physical cursor',{skip:!windows},()=>fixture(async(b,events,state)=>{
  const probe=await b.request({op:'probe'});assert.equal(probe.protocolVersion,4)
  await b.request(act([{kind:'move',x:-1920,y:-80},{kind:'keydown',keys:['w']}]))
  await until(()=>events.some(e=>e.event==='move'))
  const moved=events.find(e=>e.event==='move');assert.deepEqual(moved.position,{x:0,y:0})
  await b.releaseAll();await until(()=>events.some(e=>e.source==='guard'&&e.event==='up'))
  assert.deepEqual(events.find(e=>e.source==='guard'&&e.event==='up').position,moved.position)
}))
