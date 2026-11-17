// Real native RAF in a dedicated headless Edge page. No user tabs, desktop capture, or input.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {readFile,mkdir,writeFile,access} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
const out=resolve(process.env.DSH_RAF_QA_DIR??'.qa/idle-fix-0.3.1/browser-raf');await mkdir(out,{recursive:true})
const exe=join(process.env['ProgramFiles(x86)']??'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe');await access(exe)
const module=await readFile('desktop/frame-scheduler.js','utf8')
const html=`<!doctype html><meta charset="utf-8"><script type="module">
import {FrameScheduler} from '/frame-scheduler.js';const sleep=ms=>new Promise(r=>setTimeout(r,ms));window.result=(async()=>{
const frames=[],s=new FrameScheduler((now,dt)=>frames.push({now,dt}));s.touch();await sleep(100);if(frames.length)throw Error('Hidden RAF draws');s.setVisible(true);const request=s.timer;for(let i=0;i<1000;i++)s.touch();if(s.timer!==request)throw Error('Duplicate RAF scheduling');await sleep(3500);const end=performance.now(),recent=frames.filter(f=>f.now>end-1000),fps=recent.length;s.setVisible(false);const count=frames.length;await sleep(250);if(frames.length!==count||s.timer!==null)throw Error('Hidden RAF continues');s.setVisible(true);await sleep(100);if(frames[count]?.dt!==0)throw Error('Resume catches up');s.dispose();const closed=frames.length;await sleep(100);if(frames.length!==closed)throw Error('Disposed RAF continues');return {visibility:document.visibilityState,frames:frames.length,idleFps:fps,resumeDt:frames[count].dt,hiddenFrames:frames.length-closed};})();</script>`
const server=createServer((q,r)=>{if(q.url==='/frame-scheduler.js'){r.setHeader('Content-Type','text/javascript');r.end(module)}else if(q.url==='/case.html'){r.setHeader('Content-Type','text/html');r.end(html)}else{r.statusCode=403;r.end()}});await new Promise(r=>server.listen(0,'127.0.0.1',r))
const profile=join(out,'profile-'+randomUUID()),child=spawn(exe,['--headless=new','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']})
let id=0,stderr='',socket;const pending=new Map();child.stderr.on('data',d=>stderr+=d);const exited=new Promise(r=>child.once('exit',r))
const call=(method,params={},sessionId,timeout=15000)=>new Promise((r,j)=>{const key=++id,t=setTimeout(()=>{pending.delete(key);j(Error('CDP timeout: '+method))},timeout);pending.set(key,{resolve:m=>{clearTimeout(t);r(m)},reject:e=>{clearTimeout(t);j(e)}});socket.send(JSON.stringify({id:key,method,params,...(sessionId?{sessionId}:{})}))})

try{
 let endpoint;for(let n=0;n<150;n++){try{const lines=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');endpoint='ws://127.0.0.1:'+Number(lines[0])+lines[1].trim();break}catch{}if(child.exitCode!==null&&child.exitCode!==0)throw Error('Headless browser exited '+child.exitCode+' before opening debugging endpoint: '+stderr);await new Promise(r=>setTimeout(r,100))}
 if(!endpoint)throw Error('Headless debugging endpoint unavailable: '+stderr)
 socket=new WebSocket(endpoint);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',()=>j(Error('Private debugging socket failed')),{once:true})})
 socket.addEventListener('message',event=>{let m;try{m=JSON.parse(event.data)}catch{return}const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}})
 const version=await call('Browser.getVersion'),target=await call('Target.createTarget',{url:'about:blank'}),session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId
 await call('Page.enable',{},session);await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/case.html'},session)
 let result;for(let n=0;n<30;n++){const ready=await call('Runtime.evaluate',{expression:'!!window.result',returnByValue:true},session);if(ready.result.value){result=await call('Runtime.evaluate',{expression:'window.result',awaitPromise:true,returnByValue:true},session);break}await new Promise(r=>setTimeout(r,100))}
 if(result?.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));const value=result?.result.value;assert.equal(value.visibility,'visible');assert.ok(value.idleFps>=50&&value.idleFps<=61,JSON.stringify(value));assert.equal(value.resumeDt,0);await writeFile(join(out,'report.json'),JSON.stringify({version,result:value,headless:true,desktopCaptured:false,realInputSent:false},null,2));console.log('PASS real headless browser RAF '+value.idleFps+' idle frames/sec; hidden/disposed zero draws; resume dt=0')
}finally{try{if(socket)await call('Browser.close',{},undefined,2000)}catch{};socket?.close();await Promise.race([exited,new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null)child.kill();server.close();await writeFile(join(out,'stderr.log'),stderr)}
