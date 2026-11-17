// Private WebView canvas only. Never capture the desktop or import an input bridge/helper.
import {spawn,spawnSync} from 'node:child_process'
import * as fs from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {desktopExecutable} from '../src/desktop-runtime.js'
const out=resolve(process.env.DSH_MODELS_QA_DIR??'.qa/model-adaptation/visual');await fs.mkdir(out,{recursive:true})
const executable=process.env.DSH_DESKTOP_EXECUTABLE??desktopExecutable(),cat=resolve('../cat'),sdk=resolve('.qa/sdk/CubismSdkForWeb-5-r.5/Samples/Resources')
const child=spawn(executable,['--parent',String(process.pid),'--settings',join(out,'unused-preferences.json'),'--default-model',resolve('../Deepseek桌宠'),'--defer-model','true','--qa-dir',out,'--qa-interactive','true','--managed','true'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
const checks=[],models=[],events=[],pending=new Map();let buffer='',stderr='',sequence=0,readyResolve,readyReject
const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j}),exited=new Promise(r=>child.once('exit',r));child.once('error',readyReject)
child.stderr.on('data',d=>stderr+=d)
child.stdout.on('data',d=>{buffer+=d;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;let m;try{m=JSON.parse(line)}catch{continue}if(m.kind==='ready')readyResolve(m);else if(m.kind==='ack'||m.kind==='metrics'){const p=pending.get(m.id);if(p){pending.delete(m.id);m.ok===false?p.reject(Error(m.error)):p.resolve(m)}}else events.push(m)}})
const call=(value,timeout=30000)=>{const id='models-'+ ++sequence;return new Promise((r,j)=>{const timer=setTimeout(()=>{pending.delete(id);j(Error('Private canvas timeout: '+value.kind))},timeout);pending.set(id,{resolve:m=>{clearTimeout(timer);r(m)},reject:e=>{clearTimeout(timer);j(e)}});child.stdin.write(JSON.stringify({...value,id})+'\n')})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),neutral={kind:'state',mode:'simulation',status:'ready',keys:[],buttons:[],pulses:[],position:{x:.5,y:.5},activated:false}
const frame=async(name,state=neutral,steps=0,extra={})=>{const r=await call({kind:'qa-step',name,state,steps,dt:1/60,...extra});assert.ok((await fs.stat(join(out,name+'.png'))).size>5000,'Non-empty private frame '+name);return r}
const check=(value,name)=>{assert.ok(value,name);checks.push(name);console.log('PASS '+name)}
const utility=path=>{const result=spawnSync(executable,['--parent',String(process.pid),'--discover-model',path],{windowsHide:true,encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);return JSON.parse(result.stdout).candidates}
const watchdog=setTimeout(()=>child.kill(),240000)
try{
 let timer;const hello=await Promise.race([ready,new Promise((_,j)=>{timer=setTimeout(()=>j(Error('Hidden initialization exceeded 25 seconds')),25000)})]).finally(()=>clearTimeout(timer));check(hello.capabilities.archives&&hello.capabilities.adaptation&&hello.capabilities.handStyles&&!hello.modelLoaded,'Hidden deferred runtime declares independent ZIP/adapter/style capabilities')
 check(hello.capabilities.confirmedVisibility===true,'The 0.3.0 native runtime advertises first-frame visible confirmation');
 const discovered=utility(cat),valid=discovered.filter(x=>!x.error);check(valid.length===5&&valid.every(x=>x.entry.includes('/standard/')),'The supplied directory discovers all five standard ZIP models, not backup/demonstration manifests')
 for(let index=0;index<valid.length;index++){
  const candidate=valid[index],name='cat-'+index;child.stdin.write(JSON.stringify(neutral)+'\n')
  const loaded=await call({kind:'load-model',modelPath:candidate.sourcePath,modelEntry:candidate.entry});const staged=await call({kind:'metrics'});check(staged.stagedModels===1&&(staged.stagedHandImages??0)===0,'Candidate '+candidate.name+' validates hidden without decoding a whole hand set')
  await call({kind:'commit-model'});const adapter=await call({kind:'get-adapter'}),motions=await call({kind:'get-motions'});models.push({name:candidate.name,source:candidate.sourcePath,entry:candidate.entry,modelKey:adapter.modelKey,adapter:adapter.adapter,motions:motions.motions})
  await assert.rejects(call({kind:'control',action:'show-confirmed',modelToken:loaded.modelToken}),/real display window/);check(true,'Private QA never claims actual window visibility for '+candidate.name)
  check(adapter.modelKey===candidate.modelKey&&adapter.adapter.inputs.filter(x=>['keyboard','mouseX','mouseY','left','right'].includes(x.role)).every(x=>x.enabled),'Actual Core owns the dedicated input parameters for '+candidate.name)
  check(adapter.adapter.handStyles.length===3&&adapter.adapter.handGroups>=25,'Author hand styles and groups are available for '+candidate.name)
  check(motions.motions.every(x=>!x.enabled&&/Watermark/.test(x.error)),'Watermark switches are not exposed as character motions for '+candidate.name)
  const idle=await frame(name+'-idle'),breath=await frame(name+'-breath',neutral,120),blink=await frame(name+'-blink',neutral,65)
  const eye=adapter.adapter.effects.find(x=>x.role==='blink');if(eye.enabled)check(eye.ids.every(id=>blink.values[id]<.15),'Provided eye parameters blink for '+candidate.name)
  const breathing=adapter.adapter.effects.find(x=>x.role==='breath');if(breathing.enabled)check(breath.values[breathing.ids[0]]>.2&&breath.values[breathing.ids[0]]<=.251,'Visible breath reaches its intended phase for '+candidate.name);else check(/visible|provide/.test(breathing.error),'Invisible/missing breath is accurately disabled for '+candidate.name)
  const held=await frame(name+'-held',{...neutral,mode:'real',keys:['a']},6);check(held.values.CatParamLeftHandDown===1&&held.pose.hand>=0,'Author hand image aligns with a confirmed held key for '+candidate.name)
  const released=await frame(name+'-released',{...neutral,mode:'real'});check(released.values.CatParamLeftHandDown===0&&released.pose.hand===-1,'Release restores the native hand immediately for '+candidate.name)
  await call({kind:'qa-cursor',token:adapter.modelToken,sequence:sequence+1,valid:true,x:1,y:1});const moved=await frame(name+'-mouse',{...neutral,mode:'real',position:{x:0,y:1},buttons:['left']},90);check(moved.values.ParamMouseLeftDown===1&&Math.abs(moved.values.ParamMouseX-30)<1e-4&&moved.pose.values.ParamMouseX===-30,'System cursor owns hand location while confirmed AI click feedback is preserved for '+candidate.name)
  const unknown=await frame(name+'-frozen',{...neutral,mode:'real',status:'unknown'},20);check(unknown.pose.frozen&&JSON.stringify(unknown.values)===JSON.stringify(moved.values),'Unknown state freezes real values, not animation for '+candidate.name)
  await frame(name+'-neutral',neutral)
  for(const style of ['no-labels','labels']){
   await call({kind:'load-model',modelPath:candidate.sourcePath,modelEntry:candidate.entry,adapter:{handStyle:style}});await call({kind:'commit-model'});const art=await call({kind:'get-adapter'});const heldStyle=await frame(name+'-'+style,{...neutral,keys:['a']},6);check(art.adapter.handStyle===style&&heldStyle.pose.hand>=0,'Only author '+style+' artwork is selected for '+candidate.name)
  }
  // Walk confirmed display-only identities, never OS keys. Only one current/confirmed bitmap may be pinned.
  for(const key of ['a','s','d','f','g','q','w','e','r','t','z','x','c','v','b','space','enter','shift','ctrl','alt']){
   child.stdin.write(JSON.stringify({...neutral,keys:[key]})+'\n');await call({kind:'qa-prepare',state:{...neutral,keys:[key]}})
  }
  const bounded=await call({kind:'metrics'});models[models.length-1].lastMetrics=bounded;console.log('CACHE',JSON.stringify(bounded));check(bounded.handImages<=8&&bounded.handPixels<=16*1024*1024&&bounded.handPending===0,'Repeated keys keep the hand cache bounded for '+candidate.name)
  await frame(name+'-after-cache',neutral)
  if(adapter.adapter.handGroups===91)check(adapter.adapter.warnings.some(x=>/Hand 90 unavailable/.test(x)),'Yuno preserves and reports the missing hand-image group')
 }
 for(const label of ['Haru','Hiyori','Wanko']){
  const model=join(sdk,label,label+'.model3.json');child.stdin.write(JSON.stringify(neutral)+'\n');await call({kind:'load-model',modelPath:model});await call({kind:'commit-model'});const a=await call({kind:'get-adapter'}),motions=await call({kind:'get-motions'});models.push({name:label,source:model,adapter:a.adapter,motions:motions.motions})
  check(a.adapter.inputs.every(x=>!x.enabled),'No humanoid/dog head parameter is guessed as a held input for '+label)
  check(label==='Wanko'?!a.adapter.poseSupported:a.adapter.poseSupported,'Author Pose support is accurate for '+label)
  await frame(label+'-idle');const blink=await frame(label+'-blink',neutral,185),eyes=a.adapter.effects.find(x=>x.role==='blink');check(eyes.enabled&&eyes.ids.every(id=>blink.values[id]<.15),'Author eye group and modern/legacy blink IDs work for '+label)
  const available=motions.motions.filter(x=>x.enabled)
  if(available.length){
   check(true,'Declared character motions pass visible validation for '+label)
   const item=available[0];await frame(label+'-before-motion');await call({kind:'play-motion',token:motions.modelToken,motionId:item.id,ticket:randomUUID()});await frame(label+'-motion',neutral,Math.max(1,Math.ceil(item.durationMs/1000*30)));const ended=await frame(label+'-motion-ended',neutral,Math.ceil(item.durationMs/1000*30)+3);check(!ended.motion&&ended.visual.opacity===1,'Single-shot motion restores model opacity and completes for '+label)
  }else check(motions.motions.length>0&&motions.motions.every(m=>/not provided|visible/.test(m.error)),'Author motions with absent parts/parameters or no effect stay disabled for '+label)

 }
 // A separate QA-only copy exercises legal Model/PartOpacity curves; no SDK/author file is modified or shipped.
 const fixture=join(out,'qa-pose-fixture'),author=join(sdk,'Haru');await fs.mkdir(fixture,{recursive:true})
 const manifest=JSON.parse(await fs.readFile(join(author,'Haru.model3.json'),'utf8'))
 for(const relative of [manifest.FileReferences.Moc,...manifest.FileReferences.Textures,manifest.FileReferences.Physics,manifest.FileReferences.Pose,manifest.FileReferences.DisplayInfo].filter(Boolean)){
  const target=join(fixture,relative);await fs.mkdir(resolve(target,'..'),{recursive:true});await fs.copyFile(join(author,relative),target)
 }
 const curves=[{Target:'Model',Id:'Opacity',Segments:[0,1,0,1,.3]},{Target:'PartOpacity',Id:'Part01ArmRA001',Segments:[0,1,0,.1,0,0,1,0]},{Target:'PartOpacity',Id:'Part01ArmRB001',Segments:[0,0,0,.1,1,0,1,1]}]
 await fs.writeFile(join(fixture,'qa.motion3.json'),JSON.stringify({Version:3,Meta:{Duration:1,Fps:30,Loop:true,AreBeziersRestricted:true,CurveCount:3,TotalSegmentCount:5,TotalPointCount:8},Curves:curves}))
 manifest.FileReferences.Motions={QA:[{File:'qa.motion3.json',FadeInTime:0,FadeOutTime:0}]};delete manifest.FileReferences.Expressions
 await fs.writeFile(join(fixture,'qa.model3.json'),JSON.stringify(manifest))
 await call({kind:'load-model',modelPath:join(fixture,'qa.model3.json')});await call({kind:'commit-model'});const qaMotion=await call({kind:'get-motions'});check(qaMotion.motions[0].enabled,'QA-only legal model/part curves pass actual Core visible validation')
 const qaBefore=await frame('qa-pose-before');await call({kind:'play-motion',token:qaMotion.modelToken,motionId:'motion-0',ticket:randomUUID()});const qaDuring=await frame('qa-pose-during',neutral,40);check(qaDuring.visual.opacity<.8&&qaDuring.visual.parts.Part01ArmRB001>qaBefore.visual.parts.Part01ArmRB001,'SDK Model opacity and real Pose-part opacity animate together')
 const qaAfter=await frame('qa-pose-after',neutral,24);check(!qaAfter.motion&&qaAfter.visual.opacity===qaBefore.visual.opacity&&Math.abs(qaAfter.visual.parts.Part01ArmRB001-qaBefore.visual.parts.Part01ArmRB001)<1e-6,'Motion end restores author model/part opacity baseline without residue')
 let pose60,pose15
 for(const fps of [60,15]){await call({kind:'load-model',modelPath:join(fixture,'qa.model3.json')});await call({kind:'commit-model'});const motion=await call({kind:'get-motions'});await frame('qa-pose-'+fps+'-idle');await call({kind:'play-motion',token:motion.modelToken,motionId:'motion-0',ticket:randomUUID()});const f=await frame('qa-pose-'+fps,neutral,Math.round(fps*.8),{dt:1/fps});if(fps===60)pose60=f;else pose15=f;await call({kind:'stop-motion'})}
 check(pose60.visual.parts.Part01ArmRB001>.95&&pose15.visual.parts.Part01ArmRB001>.95&&Math.abs(pose60.visual.opacity-pose15.visual.opacity)<1e-6,'15/60 FPS complete the same Pose fade without resetting progress each frame')
 const motion=await call({kind:'get-motions'});await call({kind:'play-motion',token:motion.modelToken,motionId:'motion-0',ticket:randomUUID()});await frame('qa-before-real',neutral,40);const real=await frame('qa-real-interrupt',{...neutral,mode:'real'});const frozen=await frame('qa-real-frozen',{...neutral,mode:'real',status:'unknown'},30)
 check(!real.motion&&real.visual.opacity===1&&real.visual.parts.Part01ArmRB001===0&&JSON.stringify(real.visual)===JSON.stringify(frozen.visual),'Real input priority and unknown state never inherit simulated opacity/Pose state')
 const before=await call({kind:'metrics'});await sleep(200);const after=await call({kind:'metrics'});check(before.rendered===after.rendered&&!after.drawTimer,'Hidden renderer has zero continuous draws during the multi-model run')
 child.stdin.write(JSON.stringify({...neutral,mode:'real',keys:[]})+'\n');await sleep(30);child.stdin.write(JSON.stringify({...neutral,mode:'real',status:'unknown'})+'\n');await sleep(30);await call({kind:'qa-prepare',state:{...neutral,mode:'real',status:'unknown'}});check((await call({kind:'metrics'})).visible===false,'Latest hidden confirmation is prepared without changing visibility')
 const reference=valid[0];let sixty,fifteen
 for(const fps of [60,15]){await call({kind:'load-model',modelPath:reference.sourcePath,modelEntry:reference.entry});await call({kind:'commit-model'});const data=await frame('time-'+fps,neutral,fps*2,{dt:1/fps});if(fps===60)sixty=data;else fifteen=data}
 check(Math.abs(sixty.physicsSeconds-fifteen.physicsSeconds)<1e-6&&Math.abs(sixty.values.ParamBreath-fifteen.values.ParamBreath)<1e-6,'15/60 FPS advance equal physical and animation time')
 for(let i=0;i<3;i++){await call({kind:'load-model',modelPath:reference.sourcePath,modelEntry:reference.entry});await call({kind:'commit-model'});const m=await call({kind:'metrics'});check(m.activeModels===1&&m.stagedModels===0&&m.textures===1&&m.handImages<=8,'Reload '+(i+1)+' releases prior model, textures and hand images')}
 check(!(await fs.stat(join(out,'unused-preferences.json')).catch(()=>null)),'Private visual verification never writes user preferences')
}finally{
 clearTimeout(watchdog);child.stdin.end();await Promise.race([exited,sleep(5000).then(()=>child.kill())]);for(const p of pending.values())p.reject(Error('Private renderer closed'));pending.clear();await sleep(100)
 await fs.writeFile(join(out,'report.json'),JSON.stringify({checks,models,events,stderr,realDesktopCaptured:false,realInputInjected:false,inputHelpersStarted:0},null,2))
}
const pids=JSON.parse(await fs.readFile(join(out,'browser-pids.json'),'utf8')),alive=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code!=='ESRCH'}}
for(let i=0;i<60&&pids.some(alive);i++)await sleep(100);check(!pids.some(alive),'All plugin-owned WebView2 processes exited after multi-model disposal')
await fs.writeFile(join(out,'report.json'),JSON.stringify({checks,models,events,stderr,realDesktopCaptured:false,realInputInjected:false,inputHelpersStarted:0,ownedBrowsersExited:true},null,2));console.log('Five ZIP cats and three official samples passed private-canvas checks; visual inspection remains required.')
