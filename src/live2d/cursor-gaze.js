// Display-only system cursor gaze. Never a source of input state or model baselines.
import {validParameter,PROTECTED_PARAMETERS} from './model-adapter.js'
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v))
const BUILTIN_MOC_HASH='9c455e9bfe672951e234ecc74b2f71fa3fe98eea67ebdd0cb43bed41599d64d0'
// Preserve the built-in's 0.3.6 branches, including custom/absent Y bindings.
// Other models receive a display-only base correction before manual reversal.
export function cursorHandYCorrection(mocHash,mouseYId){
 if(mocHash===BUILTIN_MOC_HASH)return mouseYId==='ParamMouseY'?-1:1
 return -1
}
export class SystemCursorGaze {
 constructor(parameters,effects,token){this.parameters=parameters;this.effects=effects;this.token=token;this.sequence=0;this.enabled=false;this.initialized=false;this.x=0;this.y=0;this.targetX=0;this.targetY=0}
 accept(message){
  if(message?.token!==this.token||!Number.isSafeInteger(message.sequence)||message.sequence<=this.sequence||typeof message.valid!=='boolean')return false
  if(message.valid&&(!Number.isFinite(message.x)||!Number.isFinite(message.y)||Math.abs(message.x)>1||Math.abs(message.y)>1))return false
  this.sequence=message.sequence;this.enabled=true;this.initialized=true;this.targetX=message.valid?message.x:0;this.targetY=message.valid?message.y:0;return true
 }
 // Pure readers of the once-per-frame smoothed cursor; never advance clocks or input state.
 handAxes(profile={}){
  return ['mouseX','mouseY'].map(role=>{
   const id=profile.bindings?.[role]??null,p=id?this.parameters[id]:null
   const conflict=!!id&&Object.entries(profile.bindings??{}).some(([other,value])=>other!==role&&value===id)
   const enabled=!!id&&validParameter(p)&&!PROTECTED_PARAMETERS.includes(id)&&!conflict
   const calibratedDirection=[-1,1].includes(profile.cursorHandDirections?.[role])?profile.cursorHandDirections[role]:role==='mouseX'?1:-1
   // Model-scoped field correction: never invert shared cursor/head coordinates or hand X.
   const direction=calibratedDirection*(role==='mouseY'&&profile.cursorHandYCorrection===-1?-1:1)
   return {role,id,direction,reverse:profile.reverse?.[role]===true||(role==='mouseY'&&profile.invertY===true),enabled,error:enabled?null:conflict?'Parameter is owned by another input role':id?'Parameter missing, fixed or protected':'Model does not provide this hand axis'}
  })
 }
 handValues(profile={},point=null){
  const values={},x=point?.x??this.x,y=point?.y??this.y
  for(const axis of this.handAxes(profile)){
   if(!axis.enabled)continue
   const p=this.parameters[axis.id],amount=(axis.role==='mouseX'?x:y)*axis.direction
   const unit=clamp(Number.isFinite(amount)?amount:0,-1,1)*(axis.reverse?-1:1)
   values[axis.id]=clamp(p.default+unit*(unit>=0?p.max-p.default:p.default-p.min),p.min,p.max)
  }
  return values
 }
 suspend(){this.enabled=false;this.targetX=this.x;this.targetY=this.y}
 update(dt,suspended=false){
  if(!this.initialized||suspended)return {}
  dt=clamp(Number.isFinite(dt)?dt:0,0,.1);const blend=this.enabled?1-Math.exp(-dt/.09):0
  this.x+=(this.targetX-this.x)*blend;this.y+=(this.targetY-this.y)*blend
  return this.headValues()
 }
 headValues(point=null){
  const x=point?.x??this.x,y=point?.y??this.y
  const values={},units={headX:x*.35,headY:y*.35,headZ:x*.1}
  for(const [role,amount]of Object.entries(units))for(const id of this.effects.roles[role]??[]){
   const p=this.parameters[id];if(!validParameter(p)||this.effects.reserved.has(id)||PROTECTED_PARAMETERS.includes(id))continue
   const unit=amount*(this.effects.reverse[role]?-1:1)
   values[id]=clamp(p.default+unit*(unit>=0?p.max-p.default:p.default-p.min),p.min,p.max)
  }
  return values
 }
}
