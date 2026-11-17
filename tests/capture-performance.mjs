// Native recording-only benchmark. No real screen capture, keyboard hooks or input injection.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir,writeFile } from 'node:fs/promises'
import { dirname,join,resolve } from 'node:path'
import { fileURLToPath,pathToFileURL } from 'node:url'
import { PwshBridge,resolvePowershell } from '../src/pwsh-bridge.js'
const root=dirname(dirname(fileURLToPath(import.meta.url))),baseline=process.argv[2]
if(!baseline)throw Error('Pass the absolute path to the saved 0.3.12 source copy.')
const qa=join(root,'.qa','performance-0.3.13');await mkdir(qa,{recursive:true})
const check=spawnSync(resolvePowershell(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'tests/capture-native.ps1'),'-Root',root],{encoding:'utf8',windowsHide:true,timeout:30000})
if(check.error)throw check.error;if(check.status!==0)throw Error(check.stderr||check.stdout);console.log(check.stdout.trim())
const Old=(await import(pathToFileURL(join(resolve(baseline),'src/pwsh-bridge.js')))).PwshBridge
const summary=v=>{const a=[...v].sort((a,b)=>a-b);return {count:a.length,p50:+a[Math.ceil(a.length*.5)-1].toFixed(2),p95:+a[Math.ceil(a.length*.95)-1].toFixed(2)}}
async function run(Bridge){
 const bridge=new Bridge({recording:true,timeoutMs:30000}),values={},stages={};let cold
 try{
  const frame=async(kind,i)=>{const start=performance.now();const result=await bridge.request({op:'frame',consumerId:'benchmark-'+kind,mockBounds:{x:0,y:0,w:1920,h:1080},maxWidth:1280,quality:60,mockGray:kind==='changed'?32+(i%2)*120:64,skipUnchanged:true,forceImage:kind==='forced'});(values[kind]??=[]).push(performance.now()-start);if(result.timings)for(const [name,value] of Object.entries(result.timings))(stages[kind+'.'+name]??=[]).push(value);return result}
  let start=performance.now();await frame('cold',0);cold=performance.now()-start
  for(const kind of ['static','changed','forced']){
   await frame(kind,0);values[kind]=[];for(const name of Object.keys(stages))if(name.startsWith(kind+'.'))stages[name]=[]
   for(let i=1;i<=20;i++){const result=await frame(kind,i);if(Bridge===PwshBridge){if(kind==='static'){assert.equal(result.encoded,false);assert.equal(result.data,null);assert.equal(result.timings.encodeMs,0)}else assert.equal(result.encoded,true)}}
  }
  // A real Recording worker waits while capture competes for the same/independent queue.
  await bridge.request({op:'probe'});await bridge.testControl({},true)
  for(let i=0;i<5;i++){
    const wait=bridge.request({op:'input',ownerId:1,actions:[{kind:'wait',durationMs:750}]})
    await new Promise(r=>setTimeout(r,75));const start=performance.now()
    await bridge.request({op:'frame',consumerId:'queue',mockBounds:{x:0,y:0,w:1920,h:1080},maxWidth:1280,quality:60,forceImage:true,skipUnchanged:true})
    const elapsed=performance.now()-start;(values.queueBlocked??=[]).push(elapsed);await wait
    if(Bridge===PwshBridge)assert.ok(elapsed<375,'Capture waited for the input queue')
    else assert.ok(elapsed>600,'Baseline did not reproduce queue waiting')
  }
  // Freshness, geometry and independent consumer fingerprint state.
  if(Bridge===PwshBridge){
   const req={op:'frame',consumerId:'fresh',mockBounds:{x:-1920,y:-80,w:1920,h:1080},maxWidth:1280,quality:60,skipUnchanged:true}
   const first=await bridge.request(req);assert.equal(first.diff,-1);assert.equal(first.screenX,-1920)
   assert.equal((await bridge.request(req)).encoded,false)
   assert.equal((await bridge.request({...req,consumerId:'another'})).diff,-1)
   assert.equal((await bridge.request({...req,forceImage:true})).encoded,true)
   await bridge.request({op:'forget',consumerId:'fresh'});assert.equal((await bridge.request(req)).diff,-1)
   const crop=await bridge.request({...req,region:{x:10,y:20,width:640,height:480}});assert.equal(crop.screenX,-1910);assert.equal(crop.screenY,-60);assert.equal(crop.width,640)
   await assert.rejects(bridge.requestReadOnly({op:'input'}),e=>e.code==='READONLY_OPERATION')
   // Direct protocol refusal, not just the JavaScript guard.
   const child=bridge.reader.child,id='native-reject';const refusal=await new Promise((resolve,reject)=>{let buffer='';const timeout=setTimeout(()=>reject(Error('Refusal timeout')),2000);const read=chunk=>{buffer+=chunk;for(const line of buffer.split('\n')){try{const v=JSON.parse(line);if(v.id===id){clearTimeout(timeout);child.stdout.off('data',read);resolve(v)}}catch{}}};child.stdout.on('data',read);child.stdin.write(JSON.stringify({id,op:'input',actions:[]})+'\n')});assert.equal(refusal.ok,false);assert.equal(refusal.code,'READONLY_ERROR')
  }
  const coldSamples=[cold]
  for(let i=0;i<4;i++){
    const fresh=new Bridge({recording:true,timeoutMs:30000}),start=performance.now()
    try{await fresh.request({op:'frame',consumerId:'cold',mockBounds:{x:0,y:0,w:1920,h:1080},maxWidth:1280,quality:60});coldSamples.push(performance.now()-start)}finally{await fresh.close()}
  }
  values.cold=coldSamples
  return {coldMs:+cold.toFixed(2),latency:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,summary(v)])),stages:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,summary(v)]))}
 }finally{await bridge.close()}
}
const results={generatedAt:new Date().toISOString(),syntheticOnly:true,resolution:[1920,1080],maxWidth:1280,quality:60,samplesPerCase:20,before:await run(Old),after:await run(PwshBridge)}
await writeFile(join(qa,'capture-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
