// PRIVATE canvas QA only: no desktop capture, input transport, or helper.
import {spawn} from 'node:child_process'
import * as fs from 'node:fs/promises'
import {resolve,join,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {desktopExecutable} from '../src/desktop-runtime.js'
const out=resolve(process.env.DSH_EFFECTS_QA_DIR??'.qa/live2d-effects/visual');await fs.mkdir(out,{recursive:true})
const executable=process.env.DSH_DESKTOP_EXECUTABLE??desktopExecutable(),model=resolve('../Deepseek桌宠')
const child=spawn(executable,['--parent',String(process.pid),'--settings',join(out,'unused-preferences.json'),'--default-model',model,'--qa-dir',out,'--qa-interactive','true'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
const checks=[],events=[],pending=new Map();let buffer='',stderr='',sequence=0,readyResolve,readyReject
const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j});const exited=new Promise(r=>child.once('exit',r));child.once('error',readyReject)
child.stderr.on('data',d=>{stderr+=d})
child.stdout.on('data',d=>{buffer+=d;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;let message;try{message=JSON.parse(line)}catch{continue}if(message.kind==='ready')readyResolve(message);else if(message.kind==='ack'||message.kind==='metrics'){const p=pending.get(message.id);if(p){pending.delete(message.id);message.ok===false?p.reject(Error(message.error)):p.resolve(message)}}else events.push(message)}})
const call=(value,timeout=30000)=>{const id='qa-'+ ++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Private canvas reply timed out: '+value.kind))},timeout);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});child.stdin.write(JSON.stringify({...value,id})+'\n')})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),neutral={kind:'state',mode:'simulation',status:'ready',keys:[],buttons:[],pulses:[]}
const frame=async(name,state=neutral,steps=0,extra={})=>{const result=await call({kind:'qa-step',name,state,steps,dt:1/60,...extra});assert.ok((await fs.stat(join(out,name+'.png'))).size>5000);return result}
const check=(value,name)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
let catalog,startMetrics
const killTimer=setTimeout(()=>child.kill(),55000)
try{
 let startupTimer;const hello=await Promise.race([ready,new Promise((_,reject)=>{startupTimer=setTimeout(()=>reject(Error('Private renderer startup timeout')),50000)})]).finally(()=>clearTimeout(startupTimer));check(hello.renderer==='live2d'&&hello.capabilities.motions,'Real Core renderer and motion capability loaded')
 catalog=await call({kind:'get-motions'});check(catalog.motions.length===4&&catalog.motions.every(m=>m.enabled),'All four local author motions passed pixel validation')
 startMetrics=await call({kind:'metrics'});check(!startMetrics.visible&&!startMetrics.drawTimer,'Native QA starts hidden with no continuous draw timer')
 const idle=await frame('idle');const blink=await frame('blink',neutral,185);check(blink.values.ParamEyeLOpen<.15&&blink.values.ParamEyeROpen<.15,'Blink is visible and affects only provided eye parameters')
 const breath=await frame('breath',neutral,55);check(breath.values.ParamBreath>=0&&breath.values.ParamBreath<=.251,'Breathing stays in the selected amplitude')
 await frame('held-start',{...neutral,keys:['a']});const held=await frame('held-bounce',{...neutral,keys:['a']},6);check(held.values.CatParamLeftHandDown===1&&held.pose.hand>=0,'Held keyboard pose uses its author-provided hand image')
 const released=await frame('released',neutral);check(released.values.CatParamLeftHandDown===0&&released.pose.hand===-1,'Release clears the real hold parameter immediately')
 const move=await frame('mouse-follow',{...neutral,position:{x:1,y:0},buttons:['left']},30);check(move.values.ParamMouseLeftDown===1&&move.values.ParamAngleX>0&&move.values.ParamAngleY>0,'Confirmed synthetic mouse target drives head following without reading OS cursor')
 await frame('mouse-release',neutral)
 for(const item of catalog.motions){
  await frame(item.name+'-before');const ticket=randomUUID();const started=await call({kind:'play-motion',token:catalog.modelToken,motionId:item.id,ticket});check(started.durationMs===item.durationMs,'Single-shot bounded duration: '+item.name)
  for(let n=1;n<=3;n++)await frame(item.name+'-'+n,neutral,Math.ceil(item.durationMs/1000*60/4))
  const done=await frame(item.name+'-done',neutral,Math.ceil(item.durationMs/1000*60/4)+2);check(!done.motion,'Motion ended without looping: '+item.name)
  check(done.values.CatParamLeftHandDown===0&&done.values.ParamMouseLeftDown===0,'Input pose restored after '+item.name)
 }
 const ticket=randomUUID();await call({kind:'play-motion',token:catalog.modelToken,motionId:catalog.motions[1].id,ticket});await frame('preview-before-real',neutral,30)
 const real=await frame('real-priority',{...neutral,mode:'real',keys:['a'],position:{x:.75,y:.5}},0);check(!real.motion&&real.values.CatParamLeftHandDown===1,'New real-state snapshot interrupts preview immediately')
 const unknown=await frame('unknown-frozen',{...neutral,mode:'real',status:'unknown'},120);check(JSON.stringify(unknown.values)===JSON.stringify(real.values),'Unknown state freezes the last real pose, not a simulation pose')
 const metrics=await call({kind:'metrics'});await sleep(300);const hidden=await call({kind:'metrics'});check(metrics.rendered===hidden.rendered&&!hidden.drawTimer,'Hidden renderer performs zero background draws')
 child.stdin.write(JSON.stringify({...neutral,mode:'real',keys:[],activated:false})+'\n');await sleep(50);child.stdin.write(JSON.stringify({...neutral,mode:'real',status:'unknown',activated:false})+'\n');await sleep(50);
 const releasePrepared=await call({kind:'qa-prepare',state:{...neutral,mode:'real',status:'unknown'}});check(releasePrepared.values.CatParamLeftHandDown===0,'Hidden confirmed releases update the frozen input pose without background drawing');
 const prepared=await call({kind:'qa-prepare',state:{...neutral,position:{x:0,y:1}}});check(prepared.values.ParamAngleX<0&&prepared.values.ParamAngleY<0,'Show preparation applies the latest snapshot before visibility');
 await frame('latest-hidden',{...neutral,position:{x:0,y:1}});await frame('restored-latest',{...neutral,position:{x:0,y:1}},0,{visibility:true});await frame('hidden-again',neutral,0,{visibility:false})
 let sample60,sample15;for(const fps of [60,15]){await call({kind:'load-model',modelPath:model});await call({kind:'commit-model'});const v=await frame('clock-'+fps,neutral,fps*2,{dt:1/fps});if(fps===60)sample60=v;else sample15=v}
 check(Math.abs(sample60.physicsSeconds-sample15.physicsSeconds)<1e-6&&Math.abs(sample60.values.ParamBreath-sample15.values.ParamBreath)<1e-6,'15/60 FPS advance equal physical time without slowdown');
 const peak=await call({kind:'metrics'})
 for(let n=0;n<5;n++){await call({kind:'load-model',modelPath:model});await call({kind:'commit-model'});catalog=await call({kind:'get-motions'});const m=await call({kind:'metrics'});check(m.activeModels===1&&m.stagedModels===0&&m.textures===peak.textures&&m.handImages===peak.handImages&&m.motions===4,'Reload '+(n+1)+' releases old scene resources')}
}finally{
 clearTimeout(killTimer);child.stdin.end();await Promise.race([exited,sleep(5000).then(()=>child.kill())]);await sleep(200)
 await fs.writeFile(join(out,'report.json'),JSON.stringify({checks,motions:catalog?.motions,events,stderr,realDesktopCaptured:false,realInputInjected:false,inputHelpersStarted:0},null,2));
 for(const p of pending.values())p.reject(Error('Private renderer closed'));pending.clear()
}
const pids=JSON.parse(await fs.readFile(join(out,'browser-pids.json'),'utf8'));const alive=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code!=='ESRCH'}}
for(let n=0;n<60&&pids.some(alive);n++)await sleep(100);check(!pids.some(alive),'All owned WebView2 processes exited')
const cache=join(out,'webview-cache-'+child.pid);if(!resolve(cache).startsWith(out+sep))throw Error('Unsafe private QA cache target');const stat=await fs.lstat(cache).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(stat){if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('Linked QA cache rejected');await fs.rm(cache,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
await fs.writeFile(join(out,'report.json'),JSON.stringify({checks,motions:catalog?.motions,events,stderr,realDesktopCaptured:false,realInputInjected:false,inputHelpersStarted:0,ownedBrowsersExited:true},null,2));
console.log('Private canvas visual checks passed. Inspect generated frames before visual acceptance.')
