// Bundled against the pinned, unmodified official Cubism Framework R5.
import { ModelScene, releaseFramework } from './model-scene.js'
import { FrameScheduler } from './frame-scheduler.js'
import { displayText } from '../src/live2d/adapter.js'
import { FrameDiagnostics } from './frame-diagnostics.js'
import { CursorProgress } from './cursor-progress.js'
const cursorProgress=new CursorProgress()
const host = window.chrome.webview, canvas = document.querySelector('#model'), hands = document.querySelector('#hands')
const handContext=hands.getContext('2d')
const identity = document.querySelector('#identity'), activity = document.querySelector('#activity'), capabilities = document.querySelector('#capabilities')
const notify = value => host.postMessage(value)
let gl, active, candidate, loadController, generation = 0, disposed = false, lost = false
let state = { mode:'simulation',keys:[],buttons:[],status:'ready' }, stateAt = performance.now(), expiryTimer
let rendered = 0, labels = '', keys, queue = Promise.resolve(), showGeneration = 0, handStatus = ''
let diagnostics=null, privateRun=null
const resizeObserver = new ResizeObserver(()=>scheduler.touch())
const scheduler = new FrameScheduler((now, dt) => { try { draw(now, dt) } catch (error) { report(error) } })
function effective(now = performance.now()) {
  const elapsed = now - stateAt
  const next = { ...state, pulses:(state.pulses??[]).map(p=>({...p,ms:Math.max(0,p.ms-elapsed)})),
    moveMs:Math.max(0,(state.moveMs??0)-elapsed),wheelMs:Math.max(0,(state.wheelMs??0)-elapsed),textMs:Math.max(0,(state.textMs??0)-elapsed) }
  if (next.mode === 'real' && elapsed > 1500) next.status = 'unknown'
  return next
}
function updateLabels(now = performance.now()) {
  const current = effective(now), missing = active?.pose?.missing ?? []
  const values = [current.mode==='simulation'?'模拟预览 · 未操作电脑':'真实 AI 输入',displayText(current),missing.length?'模型未提供：'+missing.join(' / '):'',current.mode,['unknown','locked'].includes(current.status),current.pulses.some(p=>p.ms>0)]
  const next = JSON.stringify(values)
  if (next === labels) return
  labels = next; identity.textContent = values[0]; activity.textContent = values[1]; capabilities.textContent = values[2]
  document.body.style.setProperty('--accent',current.mode==='simulation'?'#ffb753':'#49dfbe')
  document.body.classList.toggle('warning',values[4]);document.body.classList.toggle('pulse',values[5])
}
function scheduleExpiry() {
  clearTimeout(expiryTimer)
  const elapsed = performance.now()-stateAt
  const deadlines = [...(state.pulses??[]).map(p=>p.ms),state.moveMs,state.wheelMs,state.textMs,state.mode==='real'?1501:0].filter(t=>t>elapsed)
  if (deadlines.length) expiryTimer = setTimeout(()=>{updateLabels();scheduleExpiry()},Math.max(1,Math.min(...deadlines)-elapsed))
}
function draw(now = performance.now(), dt = 0) {
  updateLabels(now)
  if (!active || disposed || lost) return
  const current = effective(now), updateAt=diagnostics?performance.now():0; active.update(current,dt); motionComplete(); updateLabels(now)
  const drawAt=diagnostics?performance.now():0
  const dpr = Math.min(2,devicePixelRatio),width=Math.max(1,Math.round(canvas.clientWidth*dpr)),height=Math.max(1,Math.round(canvas.clientHeight*dpr))
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;hands.width=width;hands.height=height}
  active.render(width,height,null,handContext);rendered++
  const progress=cursorProgress.update(now,active.manifest.token,active.cursorGaze.sequence,rendered,scheduler.visible||privateRun?.scene===active)
  if(progress)notify(progress)
  if(diagnostics)diagnostics.record(now,dt,drawAt-updateAt,performance.now()-drawAt)
}
function motionComplete() {
  if(!active?.completion)return
  const value=active.completion;active.completion=null;scheduler.setAnimating(false)
  notify({kind:'motion-ended',token:active.manifest.token,...value})
}
function handChanged(scene) {
  if(scene!==active||disposed)return
  const cache=scene.handCache.stats(),key=JSON.stringify(cache)
  if(key!==handStatus){handStatus=key;notify({kind:'adapter-status',token:scene.manifest.token,handCache:cache})}
  if(scheduler.visible&&!['unknown','locked'].includes(effective().status))scheduler.touch()
}
function stopMotion(reason){active?.stopMotion(reason);motionComplete()}
function report(error, token = active?.manifest.token) {
  if (disposed) return
  if(token===active?.manifest.token||token===null){active?.cursorGaze.suspend();scheduler.setVisible(false)}
  notify({kind:'model-error',token,error:String(error?.message??error).slice(0,500)})
}
async function load(manifest) {
  stopMotion('model-loading')
  const ticket = ++generation
  loadController?.abort(); candidate?.release(); candidate = null
  const controller = new AbortController(); loadController = controller
  try {
    if(manifest.qa){document.body.style.width='768px';document.body.style.height='844px'}
    if (!gl) {
      gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true,preserveDrawingBuffer:true})
      if(!gl)throw Error('WebGL unavailable')
    }
    if(!keys)keys=(await(await fetch('/app/key-map.json',{signal:controller.signal})).json()).keys
    const loaded = await ModelScene.load(manifest,gl,keys,controller.signal)
    if(ticket!==generation||controller.signal.aborted){loaded.release();return}
    try{loaded.probe(effective())}catch(error){loaded.release();throw error}
    candidate=loaded
    notify({kind:'model-ready',token:manifest.token,...loaded.report()})
  } catch(error) { if(ticket===generation&&!controller.signal.aborted)report(error,manifest.token) }
}
function privateSample(id,name) {
  const combined=document.createElement('canvas');combined.width=canvas.width;combined.height=canvas.height
  const context=combined.getContext('2d');context.drawImage(canvas,0,0);context.drawImage(hands,0,0)
  return {id,name,image:combined.toDataURL('image/png'),values:active.snapshot(),visual:active.visualSnapshot(),pose:active.pose,motion:active.motion,bounds:active.bounds,physicsSteps:active.physicsSteps,physicsSeconds:active.physicsSeconds,handCache:active.handCache.stats(),diagnostics:active.qaSnapshot(),timing:diagnostics?.snapshot(),gaze:{enabled:active.cursorGaze.enabled,x:active.cursorGaze.x,y:active.cursorGaze.y,sequence:active.cursorGaze.sequence}}
}
async function runPrivateFrames(message) {
  const scene=active,duration=Number(message.durationMs),name=message.name,times=message.sampleMs??[0,duration]
  if(privateRun||!scene?.manifest.qa||!Number.isFinite(duration)||duration<10||duration>600000||!/^[a-zA-Z0-9_-]{1,48}$/.test(name)||!Array.isArray(times)||times.length>16||times.some(x=>!Number.isFinite(x)||x<0||x>duration))throw Error('Invalid bounded private frame run')
  if(message.cursorPath!==undefined&&!['tour','native'].includes(message.cursorPath))throw Error('Invalid private cursor path')
  const run={scene,canceled:false};privateRun=run;scheduler.setVisible(false);diagnostics=new FrameDiagnostics()
  if(message.state){state=message.state;stateAt=performance.now();updateLabels();scheduleExpiry()}
  await scene.warm(effective());const start=performance.now();let last=start,next=start,sample=0;const samples=[...times].sort((a,b)=>a-b),names=[]
  const cursorAudit=message.cursorPath?{frames:0,targets:0,geometryChecks:0,maxAppearanceDrift:0,maxPartDrift:0,nonfiniteParameters:0,nonfiniteVertices:0,glErrors:0,handOutOfRange:0,maxHandError:0}:null
  const owned=new Set([...(scene.adaptation.effects.filter(e=>e.enabled).flatMap(e=>e.ids)),...scene.physicsIds,...Object.keys(scene.cursorGaze.handValues(scene.profile))]),partRecords=Object.entries(scene.parts),baseline=scene.baseVisual.parameters
  let cursorTick=-1,geometryAt=0
  const cursorTarget=elapsed=>{
    const t=(duration>60000?elapsed%60000:elapsed)/1000
    if(t<1)return {valid:true,x:0,y:0}
    if(t<3)return {valid:true,x:-(t-1)/2,y:0}
    if(t<5)return {valid:true,x:-1,y:0}
    if(t<7)return {valid:true,x:-1+(t-5),y:0}
    if(t<9)return {valid:true,x:1,y:0}
    if(t<11)return {valid:true,x:0,y:1}
    if(t<13)return {valid:true,x:0,y:-1}
    if(t<17){const v=(t-13)/2-1;return {valid:true,x:v,y:v}}
    if(t<25)return {valid:true,x:Math.sin((t-17)*Math.PI/2),y:Math.cos((t-17)*Math.PI/2)}
    if(t<35)return {valid:true,x:Math.floor(t*4)%2?1:-1,y:Math.floor(t*4)%2?-1:1}
    if(t<45)return {valid:false}
    return {valid:true,x:.6,y:-.4}
  }
  try {
    for(;;){
      if(run.canceled||scene!==active||disposed||lost)throw Error('Private frame run canceled or model changed')
      const now=performance.now(),elapsed=now-start,dt=last===start&&diagnostics.frames===0?0:Math.min(.1,Math.max(0,(now-last)/1000));last=now
      if(cursorAudit&&message.cursorPath==='tour'){const tick=Math.floor(elapsed/(1000/30));if(tick!==cursorTick){scene.cursorGaze.accept({token:scene.manifest.token,sequence:scene.cursorGaze.sequence+1,...cursorTarget(elapsed)});cursorTick=tick;cursorAudit.targets++}}
      draw(now,dt)
      if(cursorAudit&&message.cursorPath==='native')cursorAudit.targets=scene.cursorGaze.sequence
      if(cursorAudit){
        cursorAudit.frames++;const core=scene.model.core()
        for(const [id,wanted]of Object.entries(scene.cursorGaze.handValues(scene.profile))){const value=core.getParameterValueByIndex(scene.parameterIndices[id]),p=scene.parameters[id];if(!Number.isFinite(value)||value<p.min-1e-5||value>p.max+1e-5)cursorAudit.handOutOfRange++;cursorAudit.maxHandError=Math.max(cursorAudit.maxHandError,Math.abs(value-wanted))}
        for(const [id,index]of scene.parameterRecords){const value=core.getParameterValueByIndex(index);if(!Number.isFinite(value))cursorAudit.nonfiniteParameters++;if(!owned.has(id))cursorAudit.maxAppearanceDrift=Math.max(cursorAudit.maxAppearanceDrift,Math.abs(value-baseline[id]))}
        for(const [id,p]of partRecords)cursorAudit.maxPartDrift=Math.max(cursorAudit.maxPartDrift,Math.abs(core.getPartOpacityByIndex(p.index)-scene.baseVisual.parts[id]))
        if(elapsed>=geometryAt){const audit=scene.qaSnapshot();cursorAudit.geometryChecks++;cursorAudit.nonfiniteVertices+=audit.nonfiniteVertices;cursorAudit.glErrors+=Number(audit.glError!==0);geometryAt=elapsed+250}
      }
      while(sample<samples.length&&elapsed>=samples[sample]){const frameName=name+'-'+sample;names.push(frameName);notify({kind:'qa-run-sample',elapsedMs:elapsed,...privateSample(message.id,frameName)});sample++}
      if(elapsed>=duration)break
      next+=1000/60;if(next<performance.now())next+=Math.ceil((performance.now()-next)/(1000/60))*(1000/60)
      await new Promise(r=>setTimeout(r,Math.max(0,next-performance.now())))
    }
    notify({kind:'qa-run-ended',id:message.id,ok:true,driver:'private-realtime-per-frame',cursorAudit,timing:diagnostics.snapshot(),diagnostics:scene.qaSnapshot(),samples:names,rendered,handCache:scene.handCache.stats()})
  } finally { if(privateRun===run)privateRun=null }
}
function cancel() { generation++;loadController?.abort();candidate?.release();candidate=null }
function commit(token) {
  if(!candidate||candidate.manifest.token!==token)return
  cursorProgress.reset();identity.title='';const previous=active;active=candidate;candidate=null;active.committed=true;showGeneration++;const scene=active;active.onHandReady=()=>handChanged(scene);handStatus=""
  try { draw();previous?.release();notify({kind:'model-committed',token});scheduler.touch() }
  catch(error){const failed=active;active=previous;failed.release();report(error,token)}
}
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;active?.cursorGaze.suspend();scheduler.setVisible(false);report('WebGL context lost',null)})
window.addEventListener('error',event=>report(event.message));window.addEventListener('unhandledrejection',event=>report(event.reason))
resizeObserver.observe(document.querySelector('main'))
host.addEventListener('message',event=>{
  const message=event.data
  if(message.kind==='cursor-gaze-control'){
    if(!disposed&&!lost)cursorProgress.control(message,active?.manifest.token)
  }else if(message.kind==='cursor-gaze'){
    // Separate display channel: never touch state/stateAt, labels, previews or motion ownership.
    if(!disposed&&!lost&&(scheduler.visible||active?.manifest.qa)&&active?.cursorGaze.accept(message))identity.title='系统鼠标驱动可用的头部与手部位置参数；未知/锁定时暂停 · 仅显示'
    if(Number.isSafeInteger(message.sequence)&&typeof message.token==='string')notify({kind:'cursor-gaze-ack',token:message.token,sequence:message.sequence})
  }else if(message.kind==='state'){
    if(message.mode!=='simulation'||['unknown','locked'].includes(message.status))stopMotion('real-input')
    const before=JSON.stringify([state.mode,state.status,state.keys,state.buttons,state.position,(state.pulses??[]).map(p=>p.id),state.moveMs>0,state.wheelMs>0,state.textMs>0])
    state=message;active?.rememberState(message);stateAt=performance.now();updateLabels();scheduleExpiry()
    const after=JSON.stringify([state.mode,state.status,state.keys,state.buttons,state.position,(state.pulses??[]).map(p=>p.id),state.moveMs>0,state.wheelMs>0,state.textMs>0])
    if(before!==after)scheduler.touch()
  }else if(message.kind==='visibility'){if(!message.visible){showGeneration++;active?.cursorGaze.suspend();stopMotion('hidden')}else active?.resume();scheduler.setVisible(message.visible===true);updateLabels()}
  else if(message.kind==='prepare-show'){
    const scene=active,ticket=++showGeneration
    if(scene&&message.token===scene.manifest.token&&!disposed&&!lost){
      if(message.state){state=message.state;scene.rememberState(state);stateAt=performance.now();updateLabels();scheduleExpiry()}
      void scene.warm(effective()).then(()=>{if(ticket!==showGeneration||scene!==active||disposed||lost)return;scene.resume();draw(performance.now(),0);gl.finish();notify({kind:'show-ready',id:message.id,ticket:message.ticket,token:scene.manifest.token,...(scene.manifest.qa?{values:scene.snapshot(),visual:scene.visualSnapshot()}: {})})}).catch(error=>report(error,scene.manifest.token))
    }
  }
  else if(message.kind==='get-adapter')notify({kind:'adapter-catalog',id:message.id,token:active?.manifest.token,signature:active?.manifest.signature,adapter:active?.adapterReport()})
  else if(message.kind==='get-motions')notify({kind:'motion-catalog',id:message.id,token:active?.manifest.token,signature:active?.manifest.signature,motions:active?.catalog??[]})
  else if(message.kind==='play-motion'){
    try{
      if(!active||message.token!==active.manifest.token)throw Error('Motion model generation changed')
      const current=effective();if(current.mode!=='simulation'||current.keys?.length||current.buttons?.length||['unknown','locked','releasing','syncing'].includes(current.status))throw Error('Real input is held or its state is unsafe')
      const durationMs=active.startMotion(message.motionId,message.ticket);scheduler.setAnimating(true)
      notify({kind:'motion-started',id:message.id,token:active.manifest.token,ticket:message.ticket,durationMs,ok:true})
    }catch(error){notify({kind:'motion-started',id:message.id,token:active?.manifest.token,ticket:message.ticket,ok:false,error:String(error.message)})}
  }
  else if(message.kind==='stop-motion'){stopMotion(message.reason??'stopped');notify({kind:'motion-stopped',id:message.id,token:active?.manifest.token,ok:true})}
  else if(message.kind==='qa-run'&&active?.manifest.qa){void runPrivateFrames(message).catch(error=>notify({kind:'qa-run-ended',id:message.id,ok:false,error:String(error.message)}))}
  else if(message.kind==='qa-run-cancel'&&active?.manifest.qa){if(privateRun)privateRun.canceled=true;notify({kind:'qa-run-ended',id:message.id,ok:true})}
  else if(message.kind==='qa-step'&&active?.manifest.qa){
    queue=queue.then(async()=>{
      if(message.visibility!==undefined){if(!message.visibility){active.cursorGaze.suspend();stopMotion('hidden')}else active.resume();scheduler.setVisible(message.visibility===true)}
      if(message.state){state=message.state;stateAt=performance.now();updateLabels();scheduleExpiry()}
      await active.warm(effective());
      const savedLayout=active.manifest.layout
      if(message.projection!==undefined){
        const q=message.projection
        if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).some(k=>!['flip','scale','offset'].includes(k))||q.flip!==undefined&&typeof q.flip!=='boolean'||q.scale!==undefined&&(!Number.isFinite(q.scale)||q.scale<.1||q.scale>4)||q.offset!==undefined&&(!Array.isArray(q.offset)||q.offset.length!==2||q.offset.some(v=>!Number.isFinite(v)||Math.abs(v)>4096)))throw Error('Invalid private projection')
        active.manifest.layout={...savedLayout,...q}
      }
      try{
      const steps=Math.max(0,Math.min(1200,message.steps??0)),dt=Math.max(0,Math.min(.1,message.dt??1/60))
      for(let i=0;i<steps;i++){if(message.drawEachFrame)draw(performance.now(),dt);else{active.update(effective(),dt);motionComplete()}}
      draw(performance.now(),0)
      const combined=document.createElement('canvas');combined.width=canvas.width;combined.height=canvas.height
      const context=combined.getContext('2d');context.drawImage(canvas,0,0);context.drawImage(hands,0,0)
      notify({kind:'qa-step',id:message.id,name:message.name,image:combined.toDataURL('image/png'),pose:active.pose,values:active.snapshot(),physicsSteps:active.physicsSteps,physicsSeconds:active.physicsSeconds,bounds:active.bounds,motion:active.motion,visual:active.visualSnapshot(),handCache:active.handCache.stats(),diagnostics:active.qaSnapshot(),gaze:{enabled:active.cursorGaze.enabled,x:active.cursorGaze.x,y:active.cursorGaze.y,sequence:active.cursorGaze.sequence},projection:{...active.manifest.layout}})
      }finally{active.manifest.layout=savedLayout}
    }).catch(report)
  }
  else if(message.kind==='load')void load(message.manifest)
  else if(message.kind==='commit')commit(message.token)
  else if(message.kind==='cancel-load')cancel()
  else if(message.kind==='qa-frame')queue=queue.then(async()=>{
    await active.warm(effective());draw();const combined=document.createElement('canvas');combined.width=canvas.width;combined.height=canvas.height
    const context=combined.getContext('2d');context.drawImage(canvas,0,0);context.drawImage(hands,0,0)
    notify({kind:'qa-frame',image:combined.toDataURL('image/png'),pose:active?.pose,parameters:active?.parameters})
  }).catch(report)
  else if(message.kind==='metrics')notify({kind:'metrics',id:message.id,rendered,visible:scheduler.visible,activeModels:Number(Boolean(active)),stagedModels:Number(Boolean(candidate)),stagedHandImages:candidate?.handCache.cache.size??0,stagedHandPending:candidate?.handCache.pending.size??0,textures:active?.textures.length??0,handImages:active?.handCache.cache.size??0,handPixels:active?.handCache.pixels??0,handPending:active?.handCache.pending.size??0,motions:active?.motions.size??0,drawTimer:scheduler.timer!==null,...(active?.manifest.qa?{timing:diagnostics?.snapshot(),diagnostics:active.qaSnapshot()}: {})})
})
window.addEventListener('pagehide',()=>{disposed=true;cancel();resizeObserver.disconnect();clearTimeout(expiryTimer);scheduler.dispose();active?.release();active=null;releaseFramework()},{once:true})
notify({kind:'web-ready'})
