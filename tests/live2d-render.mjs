import {desktopExecutable} from '../src/desktop-runtime.js'
// Offscreen WebView2 test. Reads model resources; captures only our own WebGL
// canvas. No CopyFromScreen, helper, synthetic OS input, or visible window.
import { spawn } from 'node:child_process'
import { mkdir,readFile,writeFile,lstat,rm } from 'node:fs/promises'
import { resolve,join,sep } from 'node:path'
const out=resolve(process.env.DSH_LIVE2D_QA_DIR??'.qa/live2d');await mkdir(out,{recursive:true})
const child=spawn(resolve(process.env.DSH_DESKTOP_EXECUTABLE??desktopExecutable()),['--parent',String(process.pid),'--settings',join(out,'test-settings.json'),'--default-model',resolve('../Deepseek桌宠'),'--qa-dir',out],{windowsHide:true,stdio:['ignore','pipe','pipe']})
let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log+=b;process.stdout.write(b)})
let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;child.kill()},55000)
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)}).finally(()=>clearTimeout(timeout))
await writeFile(join(out,'run.log'),log)
if(timedOut||code!==0)throw Error('Offscreen host failed: '+(timedOut?'timeout':code))
const cache=resolve(out,'webview-cache-'+child.pid)
if(!cache.startsWith(out+sep))throw Error('Unsafe offscreen cache cleanup')
const cacheStat=await lstat(cache).catch(error=>{if(error.code==='ENOENT')return null;throw error})
if(cacheStat){if(cacheStat.isSymbolicLink()||!cacheStat.isDirectory())throw Error('Linked offscreen cache rejected');await rm(cache,{recursive:true,force:true,maxRetries:10,retryDelay:50})}
console.log('Offscreen cache released after embedding-process exit.')
const report=JSON.parse(await readFile(join(out,'core-report.json'),'utf8'))
if(!report.coreVersion||!report.parameters?.CatParamLeftHandDown)throw Error('Missing actual Core parameters')
for(let i=1;i<=4;i++)if((await readFile(join(out,`live2d-${i}.png`))).length<5000)throw Error('Empty or tiny model frame')
const pids=JSON.parse(await readFile(join(out,'browser-pids.json'),'utf8'))
const alive=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code!=='ESRCH'}}
const deadline=Date.now()+6000
while(pids.some(alive)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100))
if(pids.some(alive))throw Error('An owned WebView2 process survived disposal: '+pids.filter(alive).join(','))
console.log('Owned WebView2 subprocesses exited after host disposal.')
console.log('Core model load + four offscreen WebGL frames passed; inspect pixels before visual acceptance.')
