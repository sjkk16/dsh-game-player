import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,readdir,unlink,rmdir} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {PwshBridge} from '../src/pwsh-bridge.js'
const skip=process.platform!=='win32',pause=ms=>new Promise(r=>setTimeout(r,ms))
async function events(log){try{return(await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)}catch(e){if(e.code==='ENOENT')return[];throw e}}
async function until(fn){const end=Date.now()+5000;while(Date.now()<end){if(await fn())return;await pause(20)}throw Error('No recording evidence')}
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'dsh-window-')),log=join(dir,'events.ndjson'),b=new PwshBridge({recording:true,recordingLog:log});try{await fn(b,log)}finally{await b.testControl({windowState:{},failAt:-1,failUps:false},true).catch(()=>{});await b.close();for(const n of await readdir(dir))await unlink(join(dir,n));await rmdir(dir)}}
const input=(actions,extra={})=>({op:'input',ownerId:1,actions,...extra})
function raw(b,request){return new Promise((resolve,reject)=>{const id='raw:'+Math.random();let buffer='';const timer=setTimeout(()=>{clean();reject(Error('raw timeout'))},5000);const clean=()=>{clearTimeout(timer);b.child.stdout.off('data',read)};const read=chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);if(message.id===id){clean();resolve(message)}}};b.child.stdout.on('data',read);b.child.stdin.write(JSON.stringify({...request,id})+'\n')})}
test('recording window listing/status identities reject stale PID/lifetime and unsafe states',{skip},()=>fixture(async(b,log)=>{
 const listed=await b.request({op:'windows'});assert.equal(listed.windows.length,1);const id=listed.windows[0].windowId;assert.equal(typeof listed.windows[0].processStart,'string')
 for(const windowState of [{focused:false},{minimized:true},{valid:false},{pid:2},{processStart:2}]){
  await b.testControl({windowState});await assert.rejects(b.request(input([{kind:'key',keys:['w']}],{window:listed.windows[0]})));assert.equal((await events(log)).length,0)
 }
 await b.testControl({windowState:{}});assert.equal((await b.request({op:'window',windowId:id})).window.valid,true)
}))
test('recording crop uses physical origin, rejects out-of-bounds regions and isolates ROI differences',{skip},()=>fixture(async(b)=>{
 const req={op:'frame',target:'window',windowId:'1:1:1',region:{x:0,y:0,width:100,height:100},maxWidth:320,consumerId:'roi'}
 const first=await b.request(req);assert.equal(first.screenX,-1920);assert.equal(first.screenY,-80);assert.equal(first.width,100);assert.equal(first.diff,-1)
 const outside=await b.request({...req,mockPatch:{x:-1700,y:100,width:100,height:100,gray:255}});assert.equal(outside.diff,0)
 const inside=await b.request({...req,mockPatch:{x:-1910,y:-70,width:70,height:70,gray:255}});assert.ok(inside.diff>.1)
 const moved=await b.request({...req,region:{x:1,y:1,width:99,height:99}});assert.equal(moved.diff,-1)
 await assert.rejects(b.request({...req,region:{x:4479,y:0,width:2,height:1}}),/outside/)
 await b.testControl({windowState:{focused:false}});await assert.rejects(b.request(req),/focused/)
}))
test('native whole-batch client/occlusion checks happen before recorded events',{skip},()=>fixture(async(b,log)=>{
 await b.testControl({windowState:{x:-100,y:-50,width:100,height:100}})
 await assert.rejects(b.request(input([{kind:'key',keys:['w']},{kind:'click',x:1,y:1}])),/client/);assert.equal((await events(log)).length,0)
 await b.testControl({windowState:{occluded:true}});await assert.rejects(b.request(input([{kind:'click',x:0,y:0}])),/occluded/);assert.equal((await events(log)).length,0)
}))
test('native wait/repeat execute in order and helper independently rejects unsafe repeat budgets',{skip},()=>fixture(async(b,log)=>{
 const start=Date.now();await b.request(input([{kind:'key',keys:['w']},{kind:'wait',durationMs:40},{kind:'key',keys:['s']}],{repeat:2,standalone:true}));assert.ok(Date.now()-start>=80)
 assert.deepEqual((await events(log)).filter(e=>e.type===1).map(e=>[e.vk,e.keyFlags]),[[87,8],[87,10],[83,8],[83,10],[87,8],[87,10],[83,8],[83,10]])
 const count=(await events(log)).length
 for(const req of [input([{kind:'wait',durationMs:1000}],{repeat:20}),input([{kind:'keydown',keys:['w']}],{repeat:2}),input([{kind:'wait',durationMs:0}],{repeat:21})]){const response=await raw(b,req);assert.equal(response.ok,false)}
 assert.equal((await events(log)).length,count)
}))
test('native focus loss interrupts hold/wait and releases before later actions',{skip},()=>fixture(async(b,log)=>{
 const pending=b.request(input([{kind:'hold',keys:['w'],holdMs:2000},{kind:'key',keys:['s']}])).then(()=>{throw Error('Expected focus abort')},e=>e)
 await until(async()=>(await events(log)).some(e=>e.vk===87&&e.keyFlags===8));await b.testControl({windowState:{focused:false}},true);const error=await pending;assert.match(error.message,/focused|canceled/)
 const record=await events(log);assert.ok(record.some(e=>e.vk===87&&e.keyFlags===10));assert.equal(record.some(e=>e.vk===83),false)
}))
test('native geometry changes release persistent holds and focus-independent up remains available',{skip},()=>fixture(async(b,log)=>{
 await b.request(input([{kind:'keydown',keys:['w']}]))
 await b.testControl({windowState:{x:-1919}},true);await until(async()=>(await events(log)).some(e=>e.vk===87&&e.keyFlags===10))
 assert.deepEqual((await b.request({op:'probe'})).heldKeys,[])
 await b.testControl({windowState:{}});await b.request(input([{kind:'keydown',keys:['s']}]))
 // Worker/guard release checks do not require a focused or valid target.
 const release=await raw(b,input([{kind:'keyup',keys:['s']}],{window:{windowId:'invalid'}}));assert.equal(release.ok,true);assert.deepEqual(release.heldKeys,[])
}))
test('native standalone run rejects inherited state and release failures remain locked',{skip},()=>fixture(async(b,log)=>{
 await b.request(input([{kind:'keydown',keys:['w']}]))
 await assert.rejects(b.request(input([{kind:'key',keys:['s']}],{standalone:true})),/inherit/);assert.deepEqual((await b.request({op:'probe'})).heldKeys,['w'])
 await b.testControl({failUps:true});await assert.rejects(b.request(input([{kind:'keyup',keys:['w']}])),e=>e.released===false);assert.equal(b.inputFault,true)
 await assert.rejects(b.request(input([{kind:'key',keys:['s']}])),e=>e.code==='INPUT_UNSAFE');assert.equal((await events(log)).some(e=>e.vk===83),false)
}))

// These fixtures only use synthetic windows and recorded native events.
const predictedWindow = { x: 100, y: 100, width: 200, height: 200 }
const mouseMove = 0xC001
const normalizedPoint = (x, y) => [Math.round((x + 1920) * 65535 / 4479), Math.round((y + 80) * 65535 / 1519)]
async function preparePredictedWindow(b, extra = {}) {
  const probe = await b.request({ op: 'probe' })
  assert.equal(probe.recording, true)
  assert.deepEqual(probe.cursor, { x: 0, y: 0 })
  await b.testControl({ windowState: { ...predictedWindow, ...extra } })
  return (await b.request({ op: 'window', windowId: '1:1:1' })).window
}
for (const [name, tail, flags] of [
  ['down/up', [{ kind: 'down' }, { kind: 'up' }], [mouseMove, 2, 4]],
  ['click', [{ kind: 'click' }], [mouseMove, 2, 4]],
  ['scroll', [{ kind: 'scroll', amount: 120 }], [mouseMove, 0x800]],
]) {
  test('native predicted cursor accepts move into window before ' + name, { skip }, () => fixture(async (b, log) => {
    const window = await preparePredictedWindow(b)
    const result = await b.request(input([{ kind: 'move', x: 150, y: 150 }, ...tail], { window }))
    const record = await events(log)
    assert.deepEqual(record.map(e => e.mouseFlags), flags)
    assert.deepEqual([record[0].dx, record[0].dy], normalizedPoint(150, 150))
    assert.deepEqual(result.cursor, { x: 150, y: 150 })
    assert.deepEqual(result.heldKeys, [])
    assert.deepEqual(result.heldButtons, [])
  }))
}
test('native predicted cursor follows an explicit click before an implicit click', { skip }, () => fixture(async (b, log) => {
  const window = await preparePredictedWindow(b)
  const result = await b.request(input([{ kind: 'click', x: 150, y: 150 }, { kind: 'click' }], { window }))
  assert.deepEqual((await events(log)).map(e => e.mouseFlags), [mouseMove, 2, 4, 2, 4])
  assert.deepEqual(result.cursor, { x: 150, y: 150 })
  assert.deepEqual(result.heldButtons, [])
}))
test('native predicted cursor follows the drag endpoint before click and scroll', { skip }, () => fixture(async (b, log) => {
  const window = await preparePredictedWindow(b)
  const result = await b.request(input([
    { kind: 'drag', fromX: 150, fromY: 150, x: 180, y: 180, steps: 2 },
    { kind: 'click' }, { kind: 'scroll', amount: 120 },
  ], { window }))
  const record = await events(log)
  assert.deepEqual(record.map(e => e.mouseFlags), [mouseMove, 2, mouseMove, mouseMove, 4, 2, 4, 0x800])
  assert.deepEqual(record.filter(e => e.mouseFlags === mouseMove).map(e => [e.dx, e.dy]),
    [normalizedPoint(150, 150), normalizedPoint(165, 165), normalizedPoint(180, 180)])
  assert.deepEqual(result.cursor, { x: 180, y: 180 })
  assert.deepEqual(result.heldButtons, [])
}))
test('native predicted cursor preserves order across repeated balanced gestures', { skip }, () => fixture(async (b, log) => {
  const window = await preparePredictedWindow(b)
  const actions = [{ kind: 'move', x: 150, y: 150 }, { kind: 'down' },
    { kind: 'move', x: 180, y: 180 }, { kind: 'up' }, { kind: 'scroll', amount: 120 }]
  const result = await b.request(input(actions, { window, repeat: 2, standalone: true }))
  const record = await events(log), flags = [mouseMove, 2, mouseMove, 4, 0x800]
  assert.deepEqual(record.map(e => e.mouseFlags), [...flags, ...flags])
  const positions = [normalizedPoint(150, 150), normalizedPoint(180, 180)]
  assert.deepEqual(record.filter(e => e.mouseFlags === mouseMove).map(e => [e.dx, e.dy]), [...positions, ...positions])
  assert.deepEqual(result.cursor, { x: 180, y: 180 })
  assert.deepEqual(result.heldKeys, [])
  assert.deepEqual(result.heldButtons, [])
}))
test('native predicted cursor rejects implicit mouse actions before moving inside', { skip }, () => fixture(async (b, log) => {
  const window = await preparePredictedWindow(b)
  for (const actions of [[{ kind: 'click' }], [{ kind: 'scroll', amount: 120 }],
    [{ kind: 'down' }, { kind: 'up' }], [{ kind: 'click' }, { kind: 'move', x: 150, y: 150 }]]) {
    await assert.rejects(b.request(input(actions, { window })), /outside bound client/)
    assert.deepEqual(await events(log), [])
  }
  assert.deepEqual((await b.request({ op: 'probe' })).cursor, { x: 0, y: 0 })
}))
test('native predicted cursor rejects the entire batch when a later endpoint is outside', { skip }, () => fixture(async (b, log) => {
  const window = await preparePredictedWindow(b)
  for (const invalid of [
    { kind: 'move', x: 300, y: 150 },
    { kind: 'drag', fromX: 99, fromY: 150, x: 180, y: 180 },
    { kind: 'drag', fromX: 150, fromY: 150, x: 180, y: 300 },
  ]) {
    await assert.rejects(b.request(input([
      { kind: 'move', x: 150, y: 150 }, { kind: 'click' }, { kind: 'key', keys: ['w'] }, invalid,
    ], { window })), /outside bound client/)
    assert.deepEqual(await events(log), [])
  }
  assert.deepEqual((await b.request({ op: 'probe' })).cursor, { x: 0, y: 0 })
}))
test('native predicted cursor does not bypass focus, minimization or occlusion checks', { skip }, () => fixture(async (b, log) => {
  for (const extra of [{ focused: false }, { minimized: true }, { occluded: true }]) {
    const window = await preparePredictedWindow(b, extra)
    await assert.rejects(b.request(input([
      { kind: 'move', x: 150, y: 150 }, { kind: 'down' }, { kind: 'up' },
    ], { window })), /focused|minimized|occluded/)
    assert.deepEqual(await events(log), [])
  }
}))
