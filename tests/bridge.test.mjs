import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { PwshBridge } from '../src/pwsh-bridge.js'
const delay = ms => new Promise(r=>setTimeout(r,ms))
function harness(custom = () => {}) {
  const children=[], events=[]
  const spawn=(exe,args,options)=> {
    assert.equal(options.windowsHide,true)
    const role=args.includes('-Watchdog')?'guard':args.some(a=>a.endsWith('readonly-helper.ps1'))?'reader':'worker'
    const child=new EventEmitter(); child.pid=100+children.length; child.stdout=new PassThrough();child.stderr=new PassThrough()
    const reply=(request,value={}) => child.stdout.write(JSON.stringify({ id:request.id,ok:true,protocolVersion:role==='reader'?1:4,readOnly:role==='reader',recording:false,state:0,heldKeys:[],heldButtons:[],released:true,...value})+'\n')
    child.stdin=new Writable({write(chunk,encoding,callback){
      const request=JSON.parse(chunk.toString());events.push({role,op:request.op,request,child})
      const result=custom({role,request,child,reply,events})
      if(result!=='drop') queueMicrotask(()=>reply(request,result??{}))
      callback()
    }})
    child.kill=()=> { if(child.killed)return;child.killed=true;events.push({role,op:'killed',child}); child.emit('exit',0,null);child.emit('close',0,null) }
    child.stdin.on('finish',()=>queueMicrotask(()=>child.kill()))
    children.push(child);return child
  }
  return { bridge:new PwshBridge({powershell:'fake',spawn,timeoutMs:80}),children,events }
}
const input={op:'input',ownerId:1,actions:[{kind:'keydown',keys:['w']}]}
// Fake timeout must exceed the validated batch+1000ms safety margin.
function normalHarness(custom){const h=harness(custom);h.bridge.timeoutMs=1500;return h}
test('EOF invalidates running and next request gets a new generation; old events cannot affect it',async()=>{
  const {bridge,children}=harness()
  try {
    await bridge.request({op:'probe'});const old=bridge.child
    old.stdin.end();await delay(5);assert.equal(bridge.running,false)
    await bridge.request({op:'probe'});assert.notEqual(bridge.child,old)
    old.emit('error',new Error('stale failure'));old.stderr.write('stale diagnostics');old.stdout.write('{not json}\n')
    assert.equal((await bridge.request({op:'probe'})).ok,true)
    assert.equal(children.length,2)
  }finally{await bridge.close()}
})
test('start failures are readable and do not poison a subsequent start',async()=>{
  const h=harness();const real=h.bridge.spawn;let first=true
  h.bridge.spawn=(...args)=>{if(first){first=false;throw new Error('EPERM test')}return real(...args)}
  await assert.rejects(h.bridge.request({op:'probe'}),e=>e.code==='HELPER_START_FAILED')
  try{assert.equal((await h.bridge.request({op:'probe'})).ok,true)}finally{await h.bridge.close()}
})
test('aborted-before-start request never launches a process; close permanently prevents restart',async()=>{
  const {bridge,children}=harness();const c=new AbortController();c.abort()
  await assert.rejects(bridge.request({op:'probe'},c.signal),e=>e.code==='ABORTED');assert.equal(children.length,0)
  await bridge.close();await assert.rejects(bridge.request({op:'probe'}),e=>e.code==='HELPER_CLOSED')
})
test('cancellation goes to watchdog ahead of the blocked worker and queued input is discarded with that generation',async()=>{
  let entered
  const entry=new Promise(r=>entered=r)
  const {bridge,events}=normalHarness(({request})=>{if(request.op==='input'){entered();return 'drop'}})
  const c=new AbortController()
  const pending=bridge.request(input,c.signal)
  await Promise.race([entry,pending])
  const queued = bridge.request(input)
  const queuedRejection = assert.rejects(queued, e => e.code === 'INPUT_STALE')
  c.abort()
  await assert.rejects(pending,e=>e.code==='ABORTED'&&e.released===true)
  await queuedRejection
  const cancel=events.findIndex(e=>e.role==='guard'&&e.op==='cancel')
  const kill=events.findIndex(e=>e.role==='worker'&&e.op==='killed')
  assert.ok(cancel>=0&&kill>cancel)
  try{assert.equal((await bridge.request({op:'probe'})).ok,true)}finally{await bridge.close()}
})
test('timeout cleans independently and ignores late responses',async()=>{
  const {bridge}=harness(({request})=>request.op==='frame'?'drop':undefined)
  try{
    await assert.rejects(bridge.request({op:'frame'}),e=>e.code==='HELPER_TIMEOUT'&&e.released===undefined)
    assert.equal((await bridge.request({op:'probe'})).ok,true)
  }finally{await bridge.close()}
})
test('asynchronous stdin error and malformed output cannot wedge the transport',async()=>{
  for(const kind of ['write','json']){
    const {bridge}=harness(({request,child})=>{
      if(request.op==='frame'){
        queueMicrotask(()=>kind==='write'?child.stdin.emit('error',new Error('EPIPE test')):child.stdout.write('not-json\n'))
        return 'drop'
      }
    })
    try{await assert.rejects(bridge.request({op:'frame'}));assert.equal((await bridge.request({op:'probe'})).ok,true)}finally{await bridge.close()}
  }
})
test('unconfirmed cleanup latches input unsafe and never claims it released',async()=>{
  let entered;const entry=new Promise(r=>entered=r)
  const h=normalHarness(({request})=>{
    if(request.op==='input'){entered();return 'drop'}
    if(request.op==='cancel')return{released:false,state:2,heldKeys:['w']}
  })
  const c=new AbortController();const pending=h.bridge.request(input,c.signal)
  await Promise.race([entry,pending]);c.abort();await assert.rejects(pending,e=>e.released===false&&/unconfirmed/.test(e.message))
  assert.equal(h.bridge.inputFault,true)
  await assert.rejects(h.bridge.request(input),e=>e.code==='INPUT_UNSAFE')
  await h.bridge.close()
  await delay(5) // Wait for the simulated watchdog's final clean exit.
})
test('watchdog death locks input and attempts worker-side cleanup',async()=>{
  const h=normalHarness();try{
    await h.bridge.request(input);h.bridge.guardChild.kill();await delay(10)
    assert.equal(h.bridge.inputFault,true)
    assert.ok(h.events.some(e=>e.role==='worker'&&e.op==='cancel'))
    await assert.rejects(h.bridge.request(input),e=>e.code==='INPUT_UNSAFE')
  }finally{await h.bridge.close()}
})

test('disposed input owner cannot execute already queued or future requests',async()=>{
  const h=normalHarness();try{
    await h.bridge.request(input)
    await h.bridge.disposeOwner(1)
    await assert.rejects(h.bridge.request(input),e=>e.code==='INPUT_OWNER_DISPOSED')
  }finally{await h.bridge.close()}
})

test('a new bridge cannot race an old watchdog still retrying unconfirmed release',async()=>{
  let entered;const entry=new Promise(r=>entered=r)
  const h=normalHarness(({role,request,child})=>{
    if(request.op==='input'){entered();return 'drop'}
    if(role==='guard'&&request.op==='cancel'){child.kill=()=>{};return{released:false,state:2,heldKeys:['w']}}
    if(request.op==='cancel')return{released:false,state:2,heldKeys:['w']}
  })
  const c=new AbortController();const pending=h.bridge.request(input,c.signal)
  await Promise.race([entry,pending]);c.abort();await assert.rejects(pending,e=>e.released===false)
  const replacement=normalHarness()
  try { await assert.rejects(replacement.bridge.request(input),e=>e.code==='INPUT_UNSAFE') }
  finally {
    const guard=h.bridge.guardChild
    // Honest native watchdogs exit 0 only after final successful cleanup.
    guard.emit('exit',0,null);guard.emit('close',0,null)
    await h.bridge.close();await replacement.bridge.close()
  }
})

test('backend handshake mismatch fails before any input or watchdog is launched',async()=>{
  const h=normalHarness();h.bridge.recording=true
  try {
    await assert.rejects(h.bridge.request(input),e=>e.code==='HELPER_HANDSHAKE_FAILED')
    assert.equal(h.children.length,1);assert.equal(h.events.filter(e=>e.op==='input').length,0)
  }finally{await h.bridge.close()}
})


test('observation events can interleave and fragment without consuming request responses',async()=>{
  const h=normalHarness(),seen=[];h.bridge.onObservation=e=>seen.push(e)
  try {
    await h.bridge.request({op:'probe'});const child=h.children[0],session=h.bridge.observationSession
    const event={kind:'input-observation',session,sequence:1,source:'worker',timestamp:1,ownerId:1,event:'down',device:1,code:87,amount:0,state:0,uncertain:false,heldKeys:[87],heldButtons:[]}
    const wire=JSON.stringify(event)+'\n';child.stdout.write(wire.slice(0,19));child.stdout.write(wire.slice(19))
    assert.ok(seen.some(e=>e.sequence===1));assert.equal((await h.bridge.request({op:'probe'})).ok,true)
    const count=seen.length
    child.stdout.write(JSON.stringify({...event,session:'wrong'})+'\n')
    child.stdout.write(JSON.stringify({...event,source:'guard'})+'\n')
    child.stdout.write(JSON.stringify({...event,heldKeys:[999]})+'\n')
    assert.equal(seen.length,count);assert.equal(h.bridge.inputFault,false)
  } finally {await h.bridge.close()}
})
test('throwing observers cannot fail input responses or independent cleanup',async()=>{
  const h=normalHarness();h.bridge.onObservation=()=>{throw new Error('UI observer failed')}
  try{assert.equal((await h.bridge.request(input)).ok,true);assert.equal(await h.bridge.releaseAll(),true)}finally{await h.bridge.close()}
})
test('the request timeout may be a live resolver, and a static assignment still overrides it',()=>{
  let current=2500
  const live=new PwshBridge({powershell:'fake',timeoutMs:()=>current})
  assert.equal(live.requestTimeoutMs,2500)
  current=4000
  assert.equal(live.requestTimeoutMs,4000)
  current=undefined
  assert.equal(live.requestTimeoutMs,15000)
  live.timeoutMs=1500
  assert.equal(live.requestTimeoutMs,1500)
  assert.equal(new PwshBridge({powershell:'fake',timeoutMs:80}).requestTimeoutMs,80)
  assert.equal(new PwshBridge({powershell:'fake'}).requestTimeoutMs,15000)
})
