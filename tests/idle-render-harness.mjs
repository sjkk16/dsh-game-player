// Only our hidden native WebView canvas and QA fixtures. No input helper or desktop capture.
import {spawn,spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdir,readFile} from 'node:fs/promises'
import {resolve,join,dirname,sep} from 'node:path'
import {desktopExecutable,desktopLaunch} from '../src/desktop-runtime.js'
export const neutral={kind:'state',mode:'simulation',status:'ready',keys:[],buttons:[],pulses:[],activated:false}
export async function idleHarness(out,override=process.env.DSH_IDLE_DESKTOP_DLL){
 out=resolve(out);await mkdir(out,{recursive:true})
 const executable=desktopExecutable(),defaultDll=join(dirname(executable),'GamePlayer.Desktop.dll')
 const systemHost=[process.env.ProgramW6432,process.env.ProgramFiles].filter(Boolean).map(p=>join(p,'dotnet','dotnet.exe')).find(existsSync)
 const launch=override&&systemHost?{command:systemHost,args:[]}:desktopLaunch(executable,[])
 if(launch.command===executable)throw Error('Private native QA requires the installed system framework host')
 const dll=override?resolve(override):defaultDll
 if(override&&!dll.startsWith(resolve('.qa')+sep))throw Error('QA DLL override must remain inside this project QA directory')
 const args=['--parent',String(process.pid),'--settings',join(out,'unused-settings.json'),'--default-model',resolve('../Deepseek桌宠'),'--managed','true','--defer-model','true','--qa-dir',out,'--qa-interactive','true']
 const child=spawn(launch.command,[dll,...args],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion'}})
 let sequence=0,buffer='',stderr='',readyResolve,readyReject;const pending=new Map(),events=[]
 const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j}),exited=new Promise(r=>child.once('exit',r));child.once('error',readyReject)
 child.stderr.on('data',d=>stderr+=d)
 child.stdout.on('data',d=>{buffer+=d;for(;;){const at=buffer.indexOf('\n');if(at<0)break;const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let m;try{m=JSON.parse(line)}catch{continue}
   if(m.kind==='ready')readyResolve(m)
   const p=pending.get(m.id);if(p&&['ack','metrics'].includes(m.kind)){pending.delete(m.id);m.ok===false?p.reject(Error(m.error)):p.resolve(m)}else events.push(m)
 }})
 child.on('exit',code=>{for(const p of pending.values())p.reject(Error('Native QA exited '+code));pending.clear()})
 const call=(value,timeout=30000)=>new Promise((r,j)=>{const id='idle-'+ ++sequence,timer=setTimeout(()=>{pending.delete(id);j(Error('Private canvas timeout: '+value.kind))},timeout);pending.set(id,{resolve:m=>{clearTimeout(timer);r(m)},reject:e=>{clearTimeout(timer);j(e)}});child.stdin.write(JSON.stringify({...value,id})+'\n')})
 let startupTimer;await Promise.race([ready,new Promise((_,j)=>{startupTimer=setTimeout(()=>j(Error('Native QA startup timeout')),30000)})]).finally(()=>clearTimeout(startupTimer))
 const discover=path=>{const r=spawnSync(launch.command,[dll,'--parent',String(process.pid),'--discover-model',resolve(path)],{windowsHide:true,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return JSON.parse(r.stdout).candidates.filter(c=>!c.error)}
 const load=async c=>{await call({kind:'load-model',modelPath:c.sourcePath,modelEntry:c.entry,...(c.adapter?{adapter:c.adapter}:{})});await call({kind:'commit-model'});return call({kind:'get-adapter'})}
 const step=(name,steps=0,state=neutral,extra={})=>call({kind:'qa-step',name,steps,state,dt:1/60,drawEachFrame:true,...extra})
 const close=async()=>{try{await call({kind:'shutdown'},5000)}catch{child.kill()};await Promise.race([exited,new Promise(r=>setTimeout(r,5000))]);return stderr}
 return {child,call,discover,load,step,events,close,out,dll}
}
