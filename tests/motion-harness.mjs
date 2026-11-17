import {desktopExecutable} from '../src/desktop-runtime.js'
import * as fs from 'node:fs/promises'
import {resolve,join,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {EventEmitter} from 'node:events'
import {PassThrough,Writable} from 'node:stream'
import {OverlayPreferences} from '../src/overlay-preferences.js'
import {OverlayController} from '../src/overlay.js'
import {OverlayManagement} from '../src/overlay-management.js'
export const tick=()=>new Promise(resolve=>setImmediate(resolve))
export async function fixture(run,settings={}){
 const base=resolve('.qa/live2d-effects'),dir=join(base,'unit-'+randomUUID());await fs.mkdir(dir,{recursive:true})
 const store=new OverlayPreferences(join(dir,'overlay.json'));await store.ready
 const records=[],children=[],timers=new Set();let signature='unchanged',tokenIndex=0,view=settings.view??'auto',viewSource=settings.view??'auto'
 const h={records,children,store,signature:value=>{signature=value}}
 const overlay=new OverlayController({preferences:store,settingsPath:store.path,useDesktop:true,desktop:desktopExecutable(),powershell:'fake',view:()=>viewSource,
  spawn(executable,args){
   let loaded=!args.includes('--defer-model')||args[args.indexOf('--defer-model')+1]!=='true',hidden=false,token='model-'+ ++tokenIndex,motionTimer=null
   const child=new EventEmitter();child.pid=100000+tokenIndex;child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;children.push(child)
   const items=[{id:'motion-0',name:'Hello',enabled:true,error:null,durationMs:settings.durationMs??25,originalDurationMs:settings.durationMs??25},{id:'motion-1',name:'Missing',enabled:false,error:'Model parameter missing'}]
   const output=message=>{if(!child.killed)child.stdout.write(JSON.stringify(message)+'\n')}
   const state=()=>({phase:'ready',modelLoaded:loaded,visible:overlay.activated&&!hidden&&overlay.visibilityHolds===0,userHidden:hidden,modelToken:token,motionSignature:signature,motionCatalog:items,renderer:view==='keyboard'?'keyboard':'live2d',view})
   const sendStatus=()=>output({kind:'status',state:state()})
   child.stdin=new Writable({write(buffer,_,callback){const d=JSON.parse(buffer);records.push(d)
    if(d.kind==='state')sendStatus()
    else if(d.kind==='load-model')output({kind:'ack',id:d.id,ok:!settings.failLoad,error:'Mock model failed'})
    else if(d.kind==='commit-model'){loaded=true;token='model-'+ ++tokenIndex;sendStatus();output({kind:'ack',id:d.id,ok:true})}
    else if(d.kind==='get-motions')output({kind:'ack',id:d.id,ok:true,modelToken:token,signature,motions:items})
    else if(d.kind==='view'){view=d.view;sendStatus();output({kind:'ack',id:d.id,ok:true})}
    else if(d.kind==='control'){hidden=d.action==='hide'?true:d.action==='show'?false:hidden;sendStatus();output({kind:'ack',id:d.id,ok:true})}
    else if(d.kind==='play-motion'){
     output({kind:'ack',id:d.id,ok:!settings.failPlay,error:'Mock motion failed',durationMs:settings.durationMs??25,modelToken:token,ticket:d.ticket})
     h.current={...d,output,token};if(!settings.noEnd&&!settings.failPlay){motionTimer=setTimeout(()=>{timers.delete(motionTimer);output({kind:'motion-ended',token,ticket:d.ticket,reason:'finished'})},settings.durationMs??25);timers.add(motionTimer)}
    }else if(d.kind==='stop-motion'){clearTimeout(motionTimer);timers.delete(motionTimer);output({kind:'ack',id:d.id,ok:true})}
    else output({kind:'ack',id:d.id,ok:true})
    callback()
   }})
   const finish=()=>{if(child.killed)return;child.killed=true;clearTimeout(motionTimer);timers.delete(motionTimer);child.emit('exit',0);child.emit('close',0)};child.stdin.on('finish',finish);child.kill=finish
   queueMicrotask(()=>output({kind:'ready',protocolVersion:settings.protocol??3,modelLoaded:loaded,renderer:'live2d',capabilities:{management:true,model:true,motions:settings.motions!==false},bounds:{x:0,y:0,width:1920,height:1080}}))
   return child
  }
 });const manager=new OverlayManagement(overlay,{utility:async()=>({path:null})});Object.assign(h,{overlay,manager,view:value=>{viewSource=value},emit:value=>h.current.output(value)})
 try{return await run(h)}finally{await manager.close();await overlay.close();for(const t of timers)clearTimeout(t);if(!dir.startsWith(base+sep))throw Error('Unsafe fixture cleanup');await fs.rm(dir,{recursive:true,force:true})}
}
export async function catalog(h){await h.manager.command('refreshMotions');return (await h.manager.getState()).motionCatalog}
export const request=c=>({type:'playMotion',catalogGeneration:c.generation,motionId:'motion-0'})
export async function playing(h){for(let n=0;n<200;n++){if(h.manager.motions.active?.phase==='playing')return;await tick()}throw Error('Mock motion never started')}
