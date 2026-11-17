// Hidden private WebView canvas; pinned SDK sample only, no user model, capture or input hooks.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir,writeFile } from 'node:fs/promises'
import { dirname,join,resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESKTOP_RUNTIME_DIRECTORY } from '../src/desktop-runtime.js'
const root=dirname(dirname(fileURLToPath(import.meta.url))),baseline=resolve(process.argv[2]),out=join(root,'.qa','performance-0.3.13'),model=join(root,'.qa/sdk/CubismSdkForWeb-5-r.5/Samples/Resources/Haru')
const command=join(process.env.ProgramFiles,'dotnet/dotnet.exe')
async function run(runtime,label){
 const qa=join(out,'renderer-'+label);await mkdir(qa,{recursive:true})
 const child=spawn(command,[join(runtime,'GamePlayer.Desktop.dll'),'--parent',String(process.pid),'--settings',join(qa,'unused.json'),'--default-model',model,'--defer-model','true','--qa-dir',qa,'--qa-interactive','true','--managed','true'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
 let readyResolve,readyReject,buffer='',stderr='',sequence=0;const pending=new Map(),ready=new Promise((r,j)=>{readyResolve=r;readyReject=j}),exit=new Promise(r=>child.once('exit',r))
 child.once('error',readyReject);child.stderr.on('data',d=>stderr=(stderr+d).slice(-16000));child.stdout.on('data',d=>{buffer+=d;for(;;){const at=buffer.indexOf('\n');if(at<0)break;const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let m;try{m=JSON.parse(line)}catch{continue}if(m.kind==='ready')readyResolve(m);else if(m.id&&pending.has(m.id)){const p=pending.get(m.id);if(m.kind==='ack'||m.kind==='metrics'){pending.delete(m.id);m.ok===false?p.reject(Error(m.error)):p.resolve(m)}}}})
 const call=(message,timeout=30000)=>new Promise((r,j)=>{const id='perf-'+ ++sequence,timer=setTimeout(()=>{pending.delete(id);j(Error('Native timeout '+message.kind+' '+stderr))},timeout);pending.set(id,{resolve:v=>{clearTimeout(timer);r(v)},reject:e=>{clearTimeout(timer);j(e)}});child.stdin.write(JSON.stringify({...message,id})+'\n')})
 const startupTimer=setTimeout(()=>readyReject(Error('Renderer startup timeout '+stderr)),30000)
 try{
  const hello=await ready;clearTimeout(startupTimer);assert.equal(hello.modelLoaded,false)
  await call({kind:'load-model',modelPath:model});await call({kind:'commit-model'})
  const state={mode:'simulation',status:'ready',keys:[],buttons:[],pulses:[],position:{x:.5,y:.5},activated:false}
  await call({kind:'qa-run',name:'warmup',durationMs:1000,sampleMs:[],state})
  const samples=[];for(let i=0;i<3;i++){const result=await call({kind:'qa-run',name:'measure-'+i,durationMs:4000,sampleMs:[],state});assert.ok(result.timing.frames>100);samples.push(result.timing)}
  const metrics=await call({kind:'metrics'});assert.equal(metrics.drawTimer,false)
  return {sample:'Pinned official SDK Haru',canvas:'hidden private WebView',runs:samples,hiddenDrawTimer:metrics.drawTimer}
 }finally{clearTimeout(startupTimer);child.stdin.end();const timer=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(timer);await writeFile(join(qa,'stderr.txt'),stderr)}
}
const results={before:await run(join(baseline,'runtime/desktop-0.3.12-keyboard'),'before'),after:await run(join(root,DESKTOP_RUNTIME_DIRECTORY),'after'),realInputInjected:false,realDesktopCaptured:false}
await writeFile(join(out,'renderer-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2))
