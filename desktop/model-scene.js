// One context, actual Core identities and immutable local assets. No OS input/capture.
import { CubismFramework } from '@cubism/live2dcubismframework'
import { CubismUserModel } from '@cubism/model/cubismusermodel'
import { CubismShaderManager_WebGL } from '@cubism/rendering/cubismshader_webgl'
import { CubismMatrix44 } from '@cubism/math/cubismmatrix44'
import { mapPose } from '../src/live2d/adapter.js'
import { AnimatedFeedback } from '../src/live2d/effects.js'
import { SystemCursorGaze,cursorHandYCorrection } from '../src/live2d/cursor-gaze.js'
import { validateMotion } from '../src/live2d/motions.js'
import { resolveAdapter,validatePose } from '../src/live2d/model-adapter.js'
import { HandImageCache } from '../src/live2d/hand-cache.js'
import { validatePhysics } from '../src/live2d/physics-validation.js'
import { VisualState, PhysicsOutputState } from './frame-state.js'
let started=false
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a))
class Pet extends CubismUserModel {
 init(buffer,gl,w,h){this.loadModel(buffer,true);if(!this._model)throw Error('Core rejected model consistency/version');this.createRenderer(w,h);this.getRenderer().startUp(gl)}
 core(){return this._model}
 step(dt){this._physics?.evaluate(this._model,dt)}
 stabilize(){this._physics?.stabilization(this._model)}
 poseStep(dt){this._pose?.updateParameters(this._model,dt)}
 resetPose(){this._pose?.reset(this._model)}
 begin(motion,parts=[]){this._motionManager.stopAllMotions();this.activeParts=parts;motion.setLoop(false);this._motionManager.startMotionPriority(motion,false,3);this.animate(0)}
 animate(dt){this._motionManager.updateMotion(this._model,dt);if(!this._pose)for(const id of this.activeParts??[]){const handle=CubismFramework.getIdManager().getId(id);this._model.setPartOpacityById(handle,clamp(this._model.getParameterValueById(handle),0,1))}}
 stop(){this._motionManager.stopAllMotions();this.activeParts=[]}
}
async function bytes(url,signal){const r=await fetch(url,{signal});if(!r.ok)throw Error('Resource unavailable: '+r.status);return r.arrayBuffer()}
async function image(url,signal){const bitmap=await createImageBitmap(new Blob([await bytes(url,signal)],{type:'image/png'}));if(signal.aborted){bitmap.close();signal.throwIfAborted()}return bitmap}
const union=(a,b)=>({minX:Math.min(a.minX,b.minX),minY:Math.min(a.minY,b.minY),maxX:Math.max(a.maxX,b.maxX),maxY:Math.max(a.maxY,b.maxY)})
export class ModelScene {
 constructor(manifest,gl,keys){this.manifest=manifest;this.gl=gl;this.keys=keys;this.parameters=Object.create(null);this.parameterIndices=Object.create(null);this.parameterRecords=[];this.parts=Object.create(null);this.committed=false;this.textures=[];this.hands=[];this.pose=null;this.realPose=null;this.realFrame=null;this.hasRealFrame=false;this.released=false;this.physicsSteps=0;this.physicsSeconds=0;this.physicsIds=[];this.needsStabilize=false;this.wasFrozen=false;this.handRequestKey=null;this.motions=new Map();this.catalog=[];this.motion=null;this.completion=null;this.poseIds=[];this.poseDefaults=Object.create(null);this.poseOpacityState=Object.create(null);this.lastMode=null;this.warnings=[...(manifest.warnings??[])];this.onHandReady=()=>{}}
 static async load(manifest,gl,keys,signal){
  const s=new ModelScene(manifest,gl,keys)
  try{
   if(!started){CubismFramework.startUp({logFunction:m=>console.log(m),loggingLevel:4});started=true}if(!CubismFramework.isInitialized())CubismFramework.initialize()
   const mocBytes=await bytes(manifest.moc,signal),mocHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',mocBytes)),v=>v.toString(16).padStart(2,'0')).join('');
    s.mocHash=mocHash;if(manifest.mocHash&&manifest.mocHash!==mocHash)throw Error('MOC content hash mismatch');s.model=new Pet();s.model.init(mocBytes,gl,1,1)
   if(manifest.qa){const core=s.model.core(),update=core.update.bind(core);s.coreUpdateCalls=0;core.update=()=>{s.coreUpdateCalls++;update()}}
   const shader=CubismShaderManager_WebGL.getInstance().getShader(gl);if(!shader._isShaderLoaded&&!shader._isShaderLoading){shader.setShaderPath('/app/shaders/');shader.generateShaders()}
   const deadline=performance.now()+8000;while(!shader._isShaderLoaded){signal.throwIfAborted();if(performance.now()>deadline)throw Error('Shader initialization timed out');await new Promise(r=>setTimeout(r,20))}
   const c=s.model.core();s.defaults=Object.create(null);s.ids=CubismFramework.getIdManager()
   for(let i=0;i<c.getParameterCount();i++){const id=c.getParameterId(i).getString();s.parameters[id]={min:c.getParameterMinimumValue(i),max:c.getParameterMaximumValue(i),default:c.getParameterDefaultValue(i)};s.defaults[id]=s.parameters[id].default;s.parameterIndices[id]=i;s.parameterRecords.push([id,i,s.parameters[id]])}
   for(let i=0;i<c.getPartCount();i++){const id=c.getPartId(i).getString();s.parts[id]={index:i,default:c.getPartOpacityByIndex(i)}}
   s.adaptation=resolveAdapter(s.parameters,manifest);s.profile=s.adaptation.profile;s.effects=new AnimatedFeedback(s.parameters,s.profile,manifest.qa?{random:()=>0}:undefined);s.cursorGaze=new SystemCursorGaze(s.parameters,s.effects,manifest.token)
   for(let i=0;i<manifest.textures.length;i++){const bitmap=await image(manifest.textures[i],signal);try{const tex=gl.createTexture();s.textures.push(tex);gl.bindTexture(gl.TEXTURE_2D,tex);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);s.model.getRenderer().bindTexture(i,tex)}finally{bitmap.close()}}
   s.model.getRenderer().setIsPremultipliedAlpha(true)
   if(manifest.physics)try{
    const data=await bytes(manifest.physics,signal),metadata=JSON.parse(new TextDecoder().decode(data));validatePhysics(metadata,s.parameters)
    s.model.loadPhysics(data,data.byteLength);s.physicsIds=[...new Set(metadata.PhysicsSettings.flatMap(setting=>setting.Output.map(output=>output.Destination.Id)))]
   }catch(e){if(signal.aborted)throw e;s.warnings.push('Physics unavailable: '+e.message)}
   if(manifest.pose)try{const data=await bytes(manifest.pose,signal);s.poseIds=validatePose(new TextDecoder().decode(data),s.parts);s.model.loadPose(data,data.byteLength);s.model.resetPose();for(const id of s.poseIds)s.poseDefaults[id]=c.getParameterValueById(s.ids.getId(id))}catch(e){if(signal.aborted)throw e;s.warnings.push('Pose unavailable: '+e.message)}
   // Initialize pendulums at the actual neutral inputs before establishing the immutable baseline.
   s.model.stabilize();s.clampParameters();s.physicsState=new PhysicsOutputState(c,s.physicsIds.map(id=>s.parameterIndices[id]))
   const slots=Object.values(s.parameterIndices),parts=Object.values(s.parts).map(p=>p.index),gates=s.poseIds.map(id=>s.ids.getId(id))
   s.baseFrame=new VisualState(c,slots,parts,gates);s.realFrame=new VisualState(c,slots,parts,gates)
   s.baseVisual=s.visualSnapshot();s.poseOpacityState={...s.baseVisual.parts}
   const mm=s.model.getModelMatrix(),before=mm.getArray().slice();mm.setupFromLayout(new Map(Object.entries(manifest.authorLayout??{})));const after=mm.getArray();s.author={x:after[12]-before[12],y:after[13]-before[13],sx:after[0]/before[0],sy:after[5]/before[5]}
   s.handCache=new HandImageCache(manifest.hands??[],image,{onReady:()=>s.onHandReady()});s.hands=manifest.hands??[]
   signal.throwIfAborted();s.resetFrame();c.update();s.bounds=s.drawableBounds();s.baseBounds={...s.bounds}
   s.validateEffects();s.calibrateCursorHandAxes();s.cursorHandBounds=s.measureCursorHandBounds();if(manifest.layout.autoFrame)s.bounds={...s.cursorHandBounds};s.baseBounds={...s.bounds};await s.loadMotions(signal);s.resetFrame();c.update();
    c.update();return s
  }catch(e){s.release();throw e}
 }
 apply(values){const c=this.model.core();for(const id in values){const p=this.parameters[id];if(p)c.setParameterValueByIndex(this.parameterIndices[id],clamp(Number.isFinite(values[id])?values[id]:p.default,p.min,p.max))}}
 clampParameters(){const c=this.model.core();for(const [id,index,p]of this.parameterRecords){const value=c.getParameterValueByIndex(index);if(!Number.isFinite(value))throw Error('Model produced a non-finite parameter: '+id);if(value<p.min||value>p.max)c.setParameterValueByIndex(index,clamp(value,p.min,p.max))}}
 snapshot(){const v=Object.create(null);for(const id of Object.keys(this.parameters))v[id]=this.model.core().getParameterValueByIndex(this.parameterIndices[id]);return v}
 visualSnapshot(){const c=this.model.core(),parts=Object.create(null);for(const [id,p]of Object.entries(this.parts))parts[id]=c.getPartOpacityByIndex(p.index);const gates=Object.create(null);for(const id of this.poseIds)gates[id]=c.getParameterValueById(this.ids.getId(id));return {parameters:this.snapshot(),parts,opacity:c.getModelOapcity(),gates}}
 restoreVisual(v){if(!v)return;this.apply(v.parameters??{});const c=this.model.core();for(const [id,value]of Object.entries(v.parts??{})){const p=this.parts[id];if(p)c.setPartOpacityByIndex(p.index,clamp(value,0,1))}c.setModelOapcity(clamp(v.opacity??1,0,1));for(const [id,value]of Object.entries(v.gates??{}))if(this.poseIds.includes(id))c.setParameterValueById(this.ids.getId(id),value)}
 trackPose(){for(const id of this.poseIds)this.poseOpacityState[id]=this.model.core().getPartOpacityByIndex(this.parts[id].index)}
 resetPoseState(){this.model.resetPose();this.poseOpacityState={...(this.baseVisual?.parts??{})}}
 resetFrame(){this.baseFrame.restore(this.model.core());for(const id of this.poseIds)this.model.core().setPartOpacityByIndex(this.parts[id].index,this.poseOpacityState[id]??this.parts[id].default)}
 drawableBounds(){const c=this.model.core();let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(let i=0;i<c.getDrawableCount();i++)if(c.getDrawableOpacity(i)>0){const v=c.getDrawableVertices(i);for(let j=0;j<v.length;j+=2){minX=Math.min(minX,v[j]);maxX=Math.max(maxX,v[j]);minY=Math.min(minY,v[j+1]);maxY=Math.max(maxY,v[j+1])}}if(![minX,minY,maxX,maxY].every(Number.isFinite)||maxX<=minX||maxY<=minY)throw Error('Model has no drawable bounds');return {minX,minY,maxX,maxY}}
 withFrame(size,run){const gl=this.gl,previous=gl.getParameter(gl.FRAMEBUFFER_BINDING),frame=gl.createFramebuffer(),texture=gl.createTexture();try{gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.bindFramebuffer(gl.FRAMEBUFFER,frame);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Private validation framebuffer unavailable');return run(frame)}finally{gl.bindFramebuffer(gl.FRAMEBUFFER,previous);gl.deleteFramebuffer(frame);gl.deleteTexture(texture)}}
 capture(v,size,frame){this.restoreVisual(v);this.model.core().update();this.render(size,size,frame);const pixels=new Uint8Array(size*size*4);this.gl.readPixels(0,0,size,size,this.gl.RGBA,this.gl.UNSIGNED_BYTE,pixels);if(this.gl.getError()!==this.gl.NO_ERROR)throw Error('Model failed private draw validation');return pixels}
 changed(a,b){let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])+Math.abs(a[i+3]-b[i+3])>24&&++n>=8)return true;return false}
 validateEffects(){this.withFrame(192,frame=>{const baseline=this.capture(this.baseVisual,192,frame);for(const effect of this.adaptation.effects){if(!effect.enabled)continue;let visible=false;for(const sign of [1,-1]){this.resetFrame();const values={};for(const id of effect.ids){const p=this.parameters[id];if(effect.role==='blink')values[id]=p.default+((effect.reverse?p.max:p.min)-p.default);else if(effect.role==='breath')values[id]=p.default+((effect.reverse?p.min:p.max)-p.default)*.6;else {const direction=sign*(effect.reverse?-1:1);values[id]=p.default+direction*.35*(direction>0?p.max-p.default:p.default-p.min)}}this.apply(values);this.model.poseStep(0);if(this.changed(baseline,this.capture(this.visualSnapshot(),192,frame))){visible=true;break}}if(!visible){effect.enabled=false;effect.error='Parameter has no visible effect in this model';this.effects.disable(effect.role,effect.error)}}});this.resetFrame();this.model.core().update()}
 async loadMotions(signal){for(const item of this.manifest.motions??[]){signal.throwIfAborted();const record={id:item.id,name:item.name,enabled:false,error:item.error??null};let motion;try{if(item.error||!item.url)throw Error(item.error??'Motion resource missing');const data=await bytes(item.url,signal),info=validateMotion(new TextDecoder().decode(data),this.parameters,this.parts);motion=this.model.loadMotion(data,data.byteLength,item.name,undefined,undefined,undefined,undefined,undefined,true);if(!motion)throw Error('Cubism rejected motion consistency');const blink=this.profile.effectMap.blink.map(id=>this.ids.getId(id)),lipGroup=(Array.isArray(this.manifest.groups)?this.manifest.groups:[]).find(g=>g?.Target==='Parameter'&&g.Name==='LipSync')?.Ids,lip=Array.isArray(lipGroup)?lipGroup.slice(0,64):[];motion.setEffectIds(blink,lip.filter(id=>this.parameters[id]).map(id=>this.ids.getId(id)));motion.setLoop(false);motion.setFadeInTime(item.FadeInTime??.12);motion.setFadeOutTime(item.FadeOutTime??.12);const bounds=this.validateVisibleMotion(motion,info.durationMs,info.partIds);this.motions.set(item.id,{motion,...info,bounds,name:item.name});Object.assign(record,{enabled:true,error:null,durationMs:info.durationMs,originalDurationMs:info.originalDurationMs})}catch(e){motion?.release();if(signal.aborted)throw e;record.error=String(e.message).slice(0,120);if(this.manifest.qa)record.debug=String(e.stack).slice(0,3000)}this.catalog.push(record)}}
 validateVisibleMotion(motion,durationMs,partIds){const core=this.model.core(),frames=[];let bounds={...this.baseBounds};this.resetFrame();core.update();this.model.begin(motion,partIds);let previous=0;try{for(let i=0;i<=16;i++){const at=durationMs/1000*i/16;this.resetFrame();this.model.animate(at-previous);this.model.poseStep(Math.min(.1,at-previous));this.trackPose();this.apply(this.snapshot());core.update();frames.push(this.visualSnapshot());bounds=union(bounds,this.drawableBounds());previous=at}this.model.stop();this.bounds=bounds;return this.withFrame(128,frame=>{const base=this.capture(this.baseVisual,128,frame);if(!frames.some(v=>this.changed(base,this.capture(v,128,frame))))throw Error('Motion has no visible effect in this model');return bounds})}finally{this.model.stop();this.resetPoseState();this.bounds={...this.baseBounds};this.resetFrame();core.update()}}
 startMotion(id,ticket){const entry=this.motions.get(id);if(!entry)throw Error('Motion unavailable');if(this.motion)throw Error('Another motion is playing');this.effects.resume();this.needsStabilize=true;this.bounds=entry.bounds;this.resetFrame();this.model.begin(entry.motion,entry.partIds);this.motion={id,ticket,elapsedMs:0,durationMs:entry.durationMs};return entry.durationMs}
 stopMotion(reason='stopped'){if(!this.motion)return;const value={...this.motion,reason};this.motion=null;this.model.stop();this.resetPoseState();this.bounds={...this.baseBounds};this.needsStabilize=true;this.effects.resume();this.completion=value}
 // Measure only the already-authorized axis IDs. Apply explicit reversal after direction measurement.
 calibrateCursorHandAxes(){
  const c=this.model.core();this.cursorHandCalibration={};this.profile.cursorHandDirections={}
  // Keep the built-in unchanged; reverse every other model's valid mouse-hand Y base.
  this.profile.cursorHandYCorrection=cursorHandYCorrection(this.mocHash,this.profile.bindings.mouseY)
  try{for(const axis of this.adaptation.inputs.filter(a=>a.enabled&&['mouseX','mouseY'].includes(a.role))){
   const p=this.parameters[axis.id],coordinate=axis.role==='mouseX'?0:1
   this.resetFrame();this.apply({[axis.id]:p.min});c.update()
   const low=Array.from({length:c.getDrawableCount()},(_,i)=>c.getDrawableOpacity(i)>0?c.getDrawableVertices(i).slice():null)
   this.resetFrame();this.apply({[axis.id]:p.max});c.update();let sum=0,count=0
   for(let i=0;i<low.length;i++){if(!low[i]||c.getDrawableOpacity(i)<=0)continue;const high=c.getDrawableVertices(i);for(let j=coordinate;j<high.length;j+=2){const delta=high[j]-low[i][j];if(Math.abs(delta)>1e-7){sum+=delta;count++}}}
   const displacement=count?sum/count:0,calibrated=Math.abs(displacement)>1e-6
   if(calibrated)this.profile.cursorHandDirections[axis.role]=Math.sign(displacement)*(axis.role==='mouseX'?(this.manifest.layout.flip?-1:1)*Math.sign(this.author.sx):Math.sign(this.author.sy))
   this.cursorHandCalibration[axis.role]={id:axis.id,bindingSource:axis.source,source:'visible-core-vertices',changedCoordinates:count,displacement,calibrated,direction:this.profile.cursorHandDirections[axis.role]??(axis.role==='mouseX'?1:-1)}
  }}finally{this.resetFrame();c.update()}
 }
 // Establish one fixed automatic projection from the authored hand range, not live bounds.
 measureCursorHandBounds(){
  const c=this.model.core();let bounds={...this.baseBounds}
  try{for(const x of [-1,0,1])for(const y of [-1,0,1]){this.resetFrame();this.apply(this.cursorGaze.headValues({x,y}));this.apply(this.cursorGaze.handValues(this.profile,{x,y}));c.update();bounds=union(bounds,this.drawableBounds())}return bounds}
  finally{this.resetFrame();c.update()}
 }
 displayPoseValues(pose){return {...pose.values,...this.cursorGaze.handValues(this.profile)}}
 rawPose(state,previous){return mapPose(state,this.parameters,{...this.profile,hands:this.manifest.hands},previous,this.keys)}
 availablePose(pose){const wanted=pose.hand;if(wanted>=0&&!this.handCache.get(wanted)){const id=this.profile.bindings.keyboard;if(this.parameters[id])pose.values[id]=this.parameters[id].default;pose.hand=-1}return pose}
 requestHand(pose){const pinned=this.realPose?.hand??-1,key=pose.hand+':'+pinned;if(key!==this.handRequestKey){this.handRequestKey=key;return this.handCache.request(pose.hand,pinned)}return this.handCache.pending.get(pose.hand)}
 async warm(state){if(this.released||!this.committed)return;const pose=this.rawPose(state,state.mode==='real'?this.realPose:this.pose);return this.requestHand(pose)}
 resume(){this.effects.resume();this.needsStabilize=true}
 rememberState(state){
  if(state.mode!=='real'||['unknown','locked'].includes(state.status))return
  const pose=this.rawPose(state,this.realPose);if(this.committed)void this.requestHand(pose)
  this.realPose=this.availablePose(pose)
  // AI reports may update click/key feedback, but cannot overwrite the last drawn cursor hand.
  const confirmedValues={...this.realPose.values};for(const id of Object.keys(this.cursorGaze.handValues(this.profile)))delete confirmedValues[id]
  this.realFrame.overlay(confirmedValues,this.parameterIndices);this.hasRealFrame=true
 }
 update(state,dt){
  dt=clamp(dt,0,.1);const c=this.model.core(),frozen=['unknown','locked'].includes(state.status)
  if(this.motion&&(state.mode!=='simulation'||frozen))this.stopMotion('real-input')
  if(state.mode==='real'&&this.lastMode==='simulation'){
    this.resetPoseState();if(this.hasRealFrame)for(const id of this.poseIds)this.poseOpacityState[id]=this.realFrame.parts[this.parts[id].index]
    this.needsStabilize=true
  }
  this.lastMode=state.mode;const previous=state.mode==='real'?this.realPose:this.pose;this.pose=this.rawPose(state,previous)
  if(frozen){
    const confirmed=this.realPose??this.pose;this.pose={...confirmed,values:{...confirmed.values},frozen:true}
    ;(this.hasRealFrame?this.realFrame:this.baseFrame).restore(c);this.wasFrozen=true;c.update();return
  }
  if(this.wasFrozen){this.needsStabilize=true;this.wasFrozen=false}
  if(this.committed)void this.requestHand(this.pose)
  this.pose=this.availablePose(this.pose);this.resetFrame()
  if(this.motion){this.motion.elapsedMs+=dt*1000;this.model.animate(dt);if(this.motion.elapsedMs>=this.motion.durationMs){this.stopMotion('finished');this.resetFrame()}}
  if(!this.motion){this.apply(this.effects.update(state,dt));this.apply(this.cursorGaze.update(dt));this.apply(this.displayPoseValues(this.pose))}
  if(this.needsStabilize){this.model.stabilize();this.clampParameters();this.physicsState.capture(c);this.needsStabilize=false}
  if(dt>0){
    // The SDK performs author-FPS substeps and interpolation itself. One call per frame.
    this.model.step(dt);this.physicsSteps++;this.physicsSeconds+=dt
  }else{
    // A zero-time first-frame/probe/resize must not erase the last physics result.
    this.physicsState.restore(c)
  }
  this.model.poseStep(dt);this.trackPose();if(!this.motion)this.apply(this.displayPoseValues(this.pose))
  this.clampParameters();this.physicsState.capture(c);c.update()
  if(state.mode==='real'){this.realPose={...this.pose,values:{...this.pose.values}};this.realFrame.capture(c);this.hasRealFrame=true}
 }

 render(width,height,framebuffer=null,handContext=null){const gl=this.gl,c=this.model.core(),l=this.manifest.layout,b=this.bounds,aspect=width/height;const fit=l.autoFrame?Math.min(2/(b.maxX-b.minX),2*aspect/(b.maxY-b.minY))*.94:2/c.getCanvasWidth();let sx=fit*l.scale*(l.flip?-1:1),sy=Math.abs(fit*l.scale)*aspect,tx=-(b.minX+b.maxX)/2*sx+2*l.offset[0]/l.size[0],ty=-(b.minY+b.maxY)/2*sy-2*l.offset[1]/l.size[1];tx=tx*this.author.sx+this.author.x;ty=ty*this.author.sy+this.author.y;sx*=this.author.sx;sy*=this.author.sy;const mat=this.renderMatrix??=new CubismMatrix44(),values=this.renderValues??=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);values[0]=sx;values[5]=sy;values[12]=tx;values[13]=ty;mat.setMatrix(values);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);this.model.getRenderer().setMvpMatrix(mat);this.model.getRenderer().setRenderState(framebuffer,[0,0,width,height]);this.model.getRenderer().drawModel();if(!handContext)return;handContext.clearRect(0,0,width,height);const bitmap=this.handCache.get(this.pose?.hand??-1);if(bitmap){const cw=c.getCanvasWidth(),ch=c.getCanvasHeight();handContext.save();handContext.setTransform(sx*cw*width/(2*bitmap.width),0,0,sy*ch*height/(2*bitmap.height),(1+tx-sx*cw/2)*width/2,(1-ty-sy*ch/2)*height/2);handContext.drawImage(bitmap,l.handOffset[0]/l.size[0]*bitmap.width,l.handOffset[1]/l.size[1]*bitmap.height);handContext.restore()}}
 probe(state){this.withFrame(64,frame=>{this.update(state,0);this.render(64,64,frame);const p=new Uint8Array(64*64*4);this.gl.readPixels(0,0,64,64,this.gl.RGBA,this.gl.UNSIGNED_BYTE,p);if(this.gl.getError()!==this.gl.NO_ERROR||!p.some((v,i)=>i%4===3&&v>8))throw Error('Model has no visible pixels')})}
 qaSnapshot(){
  const c=this.model.core(),raw=c.getModel().parameters.values,values=this.snapshot(),viewMismatches=[]
  for(const [id,index]of Object.entries(this.parameterIndices))if(!Number.isFinite(raw[index])||Math.abs(raw[index]-values[id])>1e-5)viewMismatches.push({id,framework:values[id],core:raw[index]})
  const physics=this.model._physics,rig=physics?._physicsRig,outputs={}
  for(const output of rig?.outputs??[]){const id=output.destination.id.getString(),index=this.parameterIndices[id];outputs[id]={index,value:raw[index]}}
  // QA-only authored dependency graph: distinguish hand-driven physics from regressions.
  const dependencies=(rig?.settings??[]).map(s=>({inputs:rig.inputs.slice(s.baseInputIndex,s.baseInputIndex+s.inputCount).map(i=>i.source.id.getString()),outputs:rig.outputs.slice(s.baseOutputIndex,s.baseOutputIndex+s.outputCount).map(o=>o.destination.id.getString())}))
  const renderer=this.model.getRenderer(),clipping=renderer._clippingManager??renderer._drawableClippingManager
  const coreModel=c.getModel();let nonfiniteVertices=0,visibleDrawables=0,changedVertices=0
  for(let i=0;i<c.getDrawableCount();i++){if(c.getDrawableOpacity(i)>0)visibleDrawables++;if(c.getDrawableDynamicFlagVertexPositionsDidChange(i))changedVertices++;for(const v of c.getDrawableVertices(i))if(!Number.isFinite(v))nonfiniteVertices++}
  return {projection:Array.from(this.renderValues??[]),drawableBounds:this.drawableBounds(),cursorHandFollow:{...this.cursorHandReport(),values:this.cursorGaze.handValues(this.profile)},coreUpdateCalls:this.coreUpdateCalls,physicsCalls:this.physicsSteps,physicsSeconds:this.physicsSeconds,physicsEnabled:!!physics,physicsFps:rig?.fps??0,physicsOutputs:outputs,physicsDependencies:dependencies,parameterViewAligned:c._parameterValues===raw,viewMismatches,parameterViewLength:c._parameterValues?.length,coreParameterLength:raw.length,nonfiniteVertices,visibleDrawables,changedVertices,drawableCount:c.getDrawableCount(),clippingMasks:clipping?._clippingContextListForMask?.length??0,offscreenTargets:renderer._offscreenList?.length??0,glError:this.gl.getError()}
 }
 cursorHandReport(){return {source:'system-cursor',yCorrection:this.profile.cursorHandYCorrection??1,calibration:this.cursorHandCalibration,axes:this.cursorGaze.handAxes(this.profile),envelope:this.cursorHandBounds}}
 adapterReport(){return {cursorHandFollow:this.cursorHandReport(),parameters:Object.entries(this.parameters).map(([id,p])=>({id,...p,name:this.manifest.labels?.[id]??id})),inputs:this.adaptation.inputs,effects:this.adaptation.effects,handStyles:this.manifest.handStyles??[{id:'default',name:'Original'}],handStyle:this.manifest.handStyle??'default',warnings:[...this.warnings],handGroups:this.hands.length,handCache:this.handCache.stats(),poseSupported:this.poseIds.length>0}}
 report(){const c=this.model.core();return {canvas:{width:c.getCanvasWidth(),height:c.getCanvasHeight()},parameters:this.parameters,missing:this.pose?.missing??[],coreVersion:Live2DCubismCore.Version.csmGetVersion(),bounds:this.bounds,effects:this.effects.report(),adapterCatalog:this.adapterReport(),motionCatalog:this.catalog,motionSignature:this.manifest.signature}}
 release(){if(this.released)return;this.released=true;this.cursorGaze?.suspend();this.onHandReady=()=>{};this.handCache?.release();this.model?.stop();for(const e of this.motions.values())e.motion.release();this.motions.clear();this.motion=null;this.hands=[];this.model?.release();this.model=null;for(const tex of this.textures)this.gl.deleteTexture(tex);this.textures=[]}
}
export function releaseFramework(){CubismShaderManager_WebGL.deleteInstance();CubismFramework.dispose()}
