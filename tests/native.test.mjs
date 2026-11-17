import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PwshBridge } from '../src/pwsh-bridge.js'
const windows=process.platform==='win32'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
async function records(path){try{return (await readFile(path,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)}catch(e){if(e.code==='ENOENT')return [];throw e}}
async function until(predicate,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await delay(30)}throw new Error('Timed out waiting for recording evidence')}
async function fixture(fn){
  const dir=await mkdtemp(join(tmpdir(),'dsh-game-player-test-')),log=join(dir,'events.ndjson')
  const bridge=new PwshBridge({recording:true,recordingLog:log,timeoutMs:15000})
  try{await fn(bridge,log)}finally{
    const children=[bridge.child,bridge.guardChild].filter(Boolean)
    await bridge.close()
    await until(()=>children.every(c=>c.exitCode!==null||c.signalCode!==null))
    await unlink(log).catch(e=>{if(e.code!=='ENOENT')throw e});await rmdir(dir)
  }
}
const act=(actions,ownerId=1,maxHoldMs=3000)=>({op:'input',ownerId,maxHoldMs,actions})
function raw(bridge,request){return new Promise((resolve,reject)=>{
  const id='raw-'+Math.random();let buffer=''
  const timer=setTimeout(()=>{cleanup();reject(new Error('raw helper timeout'))},5000)
  const cleanup=()=>{clearTimeout(timer);bridge.child.stdout.removeListener('data',read)}
  const read=chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);const value=JSON.parse(line);if(value.id===id){cleanup();resolve(value)}}}
  bridge.child.stdout.on('data',read);bridge.child.stdin.write(JSON.stringify({...request,id})+'\n','utf8')
})}
test('recording helper constructs physical-pixel mouse events, endpoint normalization, buttons and wheel',{skip:!windows},()=>fixture(async(b,log)=>{
  const p=await b.request({op:'probe'});assert.equal(p.recording,true);assert.equal(p.nativeSize,process.arch==='ia32'?28:40)
  await b.request(act([{kind:'move',x:-1920,y:-80},{kind:'move',x:2559,y:1439},{kind:'click',x:-100,y:20},{kind:'scroll',amount:-120}]))
  const events=await records(log),moves=events.filter(e=>e.mouseFlags===0xC001)
  assert.equal(moves[0].dx,0);assert.equal(moves[0].dy,0)
  assert.equal(moves[1].dx,65535);assert.equal(moves[1].dy,65535)
  assert.ok(moves[2].dx>0&&moves[2].dx<65535)
  assert.ok(events.some(e=>e.mouseFlags===2));assert.ok(events.some(e=>e.mouseFlags===4))
  assert.equal(events.find(e=>e.mouseFlags===0x800).mouseData,4294967176)
}))
test('flat chord ordering, existing held modifier, aliases and reverse release',{skip:!windows},()=>fixture(async(b,log)=>{
  await b.request(act([{kind:'keydown',keys:['Control']},{kind:'key',keys:['Ctrl+Shift+S']}]))
  assert.deepEqual((await b.request({op:'probe'})).heldKeys,['ctrl'])
  await b.request(act([{kind:'keyup',keys:['control']}]))
  const events=(await records(log)).filter(e=>e.type===1)
  // Every VK key carries KEYEVENTF_SCANCODE (8); the up event adds KEYEVENTF_KEYUP (2).
  assert.deepEqual(events.map(e=>[e.vk,e.keyFlags]),[[17,8],[16,8],[83,8],[83,10],[16,10],[17,10]])
}))
test('Unicode Chinese plus emoji round trip and paired UTF-16 injection',{skip:!windows},()=>fixture(async(b,log)=>{
  await assert.rejects(b.request({op:'中文协议探测😀'}),/中文协议探测😀/)
  await b.request(act([{kind:'type',text:'中文😀'}]))
  const events=(await records(log)).filter(e=>e.type===1)
  assert.deepEqual(events.map(e=>e.scan),[20013,20013,25991,25991,55357,55357,56832,56832])
  assert.deepEqual(events.map(e=>e.keyFlags),[4,6,4,6,4,6,4,6])
}))
test('VK keys inject hardware scan codes and releases reuse the recorded scan',{skip:!windows},()=>fixture(async(b,log)=>{
  await b.request(act([{kind:'key',keys:['w']},{kind:'keydown',keys:['left']}]))
  // The release-only request resolves the scan through the shared ledger.
  await b.request(act([{kind:'keyup',keys:['left']}]))
  const events=(await records(log)).filter(e=>e.type===1)
  const w=events.filter(e=>e.vk===87),left=events.filter(e=>e.vk===37)
  assert.equal(w.length,2);assert.equal(left.length,2)
  assert.deepEqual(w.map(e=>e.keyFlags),[8,10]) // KEYEVENTF_SCANCODE, then + KEYUP
  assert.ok(w[0].scan>0&&w[0].scan<0x100,`w scan ${w[0].scan}`)
  assert.equal(w[0].scan,w[1].scan)
  assert.deepEqual(left.map(e=>e.keyFlags),[9,11]) // extended arrow keeps EXTENDEDKEY
  assert.ok(left[0].scan>0&&left[0].scan<0x100)
  assert.equal(left[0].scan,left[1].scan)
  for(const event of events)assert.equal(event.keyFlags&4,0) // never the Unicode path
}))
test('PowerShell validates the whole batch before any native call, including malformed nested protocol',{skip:!windows},()=>fixture(async(b,log)=>{
  await b.request({op:'probe'});await b.testControl({clock:1000},true)
  for(const invalid of [
    {kind:'teleport'}, {kind:'key',keys:[['ctrl','s']]}, {kind:'scroll',amount:null},
    {kind:'move',x:1.5,y:2}, {kind:'type',text:'a\nb'}, {kind:'down',button:'banana'}, {kind:'move',x:-99999,y:0}
  ]){
    // null scroll uses a default by design; test a nonnumeric wire value instead.
    if(invalid.amount===null)invalid.amount='bad'
    const value=await raw(b,act([{kind:'keydown',keys:['w']},invalid]))
    assert.equal(value.ok,false,JSON.stringify(invalid));assert.equal((await records(log)).length,0)
  }
  const tooLong=await raw(b,act([{kind:'keydown',keys:['w']},{kind:'type',text:'x'.repeat(2000)}]))
  assert.equal(tooLong.ok,false);assert.match(tooLong.error,/budget/)
}))
test('independent consumer baselines, synthetic images and geometry reset',{skip:!windows},()=>fixture(async(b)=>{
  const frame=(consumerId,mockGray,mockBounds)=>b.request({op:'frame',monitor:'virtual',maxWidth:320,consumerId,mockGray,mockBounds})
  const bounds={x:-1920,y:-67,w:4267,h:1507}
  const first=await frame('screen:a',0,bounds);assert.equal(first.diff,-1);assert.equal(first.screenY,-67)
  assert.equal(first.height,Math.round(1507*320/4267));assert.ok(first.data.length>0)
  assert.equal((await frame('watch:a',255,bounds)).diff,-1)
  assert.equal((await frame('screen:a',255,bounds)).diff,1)
  assert.equal((await frame('screen:a',255,bounds)).diff,0)
  assert.equal((await frame('screen:a',255,{...bounds,x:-1919})).diff,-1)
  const png=await b.request({op:'frame',monitor:'primary',maxWidth:320,format:'png'})
  assert.equal(png.mediaType,'image/png');assert.equal(Buffer.from(png.data,'base64').subarray(1,4).toString(),'PNG')
}))
test('fake clock expires repeated down without renewal and rejects foreign owners',{skip:!windows},()=>fixture(async(b,log)=>{
  await b.testControl({clock:1000},true)
  await b.request(act([{kind:'keydown',keys:['w']}],1,3000))
  await assert.rejects(b.request(act([{kind:'keydown',keys:['a']}],2)),/another agent/)
  assert.deepEqual((await b.request({op:'probe'})).heldKeys,['w'])
  assert.equal(await b.releaseAll(99),true) // unrelated disposal must not cancel W
  assert.deepEqual((await b.request({op:'probe'})).heldKeys,['w'])
  await b.testControl({clock:3999},true)
  await b.request(act([{kind:'keydown',keys:['w']}],1,3000))
  await b.testControl({clock:4000},true)
  assert.deepEqual((await b.request({op:'probe'})).heldKeys,[])
  assert.deepEqual((await records(log)).filter(e=>e.vk===87).map(e=>e.keyFlags),[8,10])
}))
test('native injection failure releases recorded intent, and failed release latches unsafe until reload',{skip:!windows},()=>fixture(async(b,log)=>{
  await b.testControl({failAt:2},true)
  await assert.rejects(b.request(act([{kind:'key',keys:['ctrl','s']} ])),/simulated SendInput failure/)
  assert.deepEqual((await b.request({op:'probe'})).heldKeys,[])
  assert.ok((await records(log)).some(e=>e.vk===17&&e.keyFlags===10))
  await b.testControl({failAt:-1,failUps:true},true)
  await assert.rejects(b.request(act([{kind:'key',keys:['w']} ])),e=>e.released===false)
  assert.equal(b.inputFault,true)
  await assert.rejects(b.request(act([{kind:'key',keys:['a']} ])),e=>e.code==='INPUT_UNSAFE')
  await b.testControl({failAt:-1,failUps:false},true)
  await until(async()=>(await b.request({op:'probe'})).heldKeys.length===0)
}))
test('mid-hold cancellation releases through watchdog without waiting for hold duration',{skip:!windows},()=>fixture(async(b,log)=>{
  const c=new AbortController()
  const pending=b.request(act([{kind:'hold',keys:['w'],holdMs:3000}]),c.signal)
  await until(async()=>(await records(log)).some(e=>e.vk===87&&e.keyFlags===8))
  const start=Date.now();c.abort()
  await assert.rejects(pending,e=>e.code==='ABORTED'&&e.released===true)
  assert.ok(Date.now()-start<2500)
  assert.ok((await records(log)).some(e=>e.role==='guard'&&e.vk===87&&e.keyFlags===10))
}))
test('abrupt worker and watchdog exit each leave recorded evidence of key release',{skip:!windows},async()=>{
  for(const role of ['worker','guard'])await fixture(async(b,log)=>{
    await b.request(act([{kind:'keydown',keys:['shift']}]))
    const child=role==='worker'?b.child:b.guardChild;child.kill()
    await until(async()=>(await records(log)).some(e=>e.vk===16&&e.keyFlags===10))
    if(role==='guard')assert.equal(b.inputFault,true)
  })
})
for (const crash of ['exit','kill']) test(`parent ${crash} without cleanup: independent watchdog releases the fixture key`,{skip:!windows},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dsh-game-player-test-')),log=join(dir,'parent.ndjson')
  const child=spawn(process.execPath,[fileURLToPath(new URL('./parent.fixture.mjs',import.meta.url)),log],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  let stderr='', peers
  child.stderr.setEncoding('utf8');child.stderr.on('data',s=>stderr+=s)
  const alive=pid=>{try{process.kill(pid,0);return true}catch(e){if(e.code==='ESRCH')return false;throw e}}
  try{
    peers=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('parent fixture startup '+stderr)),10000)
      child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('exit',()=>{clearTimeout(timer);reject(new Error('fixture exited '+stderr))})
      child.stdout.on('data',s=>{text+=s;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.split('\n')[0]))}})
    })
    assert.ok((await records(log)).some(e=>e.vk===16&&e.keyFlags===8))
    if(crash==='kill')child.kill();else child.stdin.write('crash-without-cleanup\n')
    await until(async()=>(await records(log)).some(e=>e.vk===16&&e.keyFlags===10))
    await until(()=>!alive(peers.worker)&&!alive(peers.guard))
  }finally{
    if(child.exitCode===null&&child.signalCode===null)child.kill()
    // Never delete an active recording backend's file. Preserve evidence if a
    // safety fixture fails to exit; no recursive deletion is used.
    if(!peers||!alive(peers.worker)&&!alive(peers.guard)){
      await unlink(log).catch(e=>{if(e.code!=='ENOENT')throw e});await rmdir(dir)
    }
  }
})

test('successful bounded hold and drag release only newly pressed input',{skip:!windows},()=>fixture(async(b,log)=>{
  const start=Date.now()
  await b.request(act([{kind:'hold',keys:['w'],holdMs:200},{kind:'drag',fromX:-100,fromY:0,x:100,y:100,steps:2}]))
  assert.ok(Date.now()-start>=200)
  const probe=await b.request({op:'probe'});assert.deepEqual(probe.heldKeys,[]);assert.deepEqual(probe.heldButtons,[])
  const events=await records(log)
  assert.deepEqual(events.filter(e=>e.vk===87).map(e=>e.keyFlags),[8,10])
  assert.equal(events.filter(e=>e.mouseFlags===0xC001).length,3)
  assert.deepEqual(events.filter(e=>e.mouseFlags===2||e.mouseFlags===4).map(e=>e.mouseFlags),[2,4])
}))
test('recording helper blocked on a request times out and watchdog releases held input',{skip:!windows},()=>fixture(async(b,log)=>{
  await b.request(act([{kind:'keydown',keys:['w']}],1,60000))
  b.timeoutMs=100
  await assert.rejects(b.request({op:'test_block',delayMs:5000}),e=>e.code==='HELPER_TIMEOUT'&&e.released===true)
  assert.ok((await records(log)).some(e=>e.role==='guard'&&e.vk===87&&e.keyFlags===10))
  assert.equal(await b.releaseAll(),true)
}))
test('normal EOF with held recording input performs confirmed cleanup',{skip:!windows},()=>fixture(async(b,log)=>{
  await b.request(act([{kind:'keydown',keys:['w']}]))
  const worker=b.child;worker.stdin.end()
  await until(async()=>(await records(log)).some(e=>e.vk===87&&e.keyFlags===10))
  await until(()=>!b.running)
  await b.close()
  assert.equal((await records(log)).filter(e=>e.vk===87&&e.keyFlags===10).length,1)
}))
