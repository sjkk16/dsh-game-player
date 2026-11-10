// Display-only feedback, driven only by confirmed AI targets or explicit simulation.
import { validParameter,resolveAdapter } from './model-adapter.js'
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x))
export class AnimatedFeedback {
 constructor(parameters,profile={}, {random=Math.random}={}){
  this.parameters=parameters;this.reserved=new Set(Object.values(profile.bindings??{}));this.random=random
  const resolved=resolveAdapter(parameters,{profile});this.roles=structuredClone(profile.effectMap??resolved.profile.effectMap);this.reverse={...(profile.effectReverse??{})};this.disabled={};this.reset()
 }
 reset(){this.time=0;this.nextBlink=3+clamp(this.random(),0,1)*3;this.blinkAt=null;this.x=0;this.y=0;this.resuming=true;this.pulse=0;this.previousKeys=new Set();this.previousPulses=new Set();this.wheeling=false}
 resume(){this.resuming=true;this.pulse=0;this.nextBlink=this.time+3+clamp(this.random(),0,1)*3;this.blinkAt=null;this.previousKeys=new Set();this.previousPulses=new Set();this.wheeling=false}
 disable(role,error){this.roles[role]=[];this.disabled[role]=error}
 update(state,dt,suspended=false){
  if(suspended||['unknown','locked'].includes(state.status))return {}
  dt=clamp(Number.isFinite(dt)?dt:0,0,.1);this.time+=dt
  const keys=new Set([...(state.keys??[]),...(state.buttons??[]).map(b=>'button:'+b)]),pulses=new Set((state.pulses??[]).filter(p=>p.ms>0).map(p=>p.id)),wheel=state.wheelMs>0
  const trigger=[...keys].some(k=>!this.previousKeys.has(k))||[...pulses].some(k=>!this.previousPulses.has(k))||(wheel&&!this.wheeling)
  this.pulse=Math.max(0,this.pulse-dt);if(trigger)this.pulse=.18
  this.previousKeys=keys;this.previousPulses=pulses;this.wheeling=wheel
  const pos=state.position,hasTarget=pos&&[pos.x,pos.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1),x=hasTarget?pos.x*2-1:0,y=hasTarget?1-pos.y*2:0,blend=this.resuming?1:1-Math.exp(-dt/.09)
  this.x+=(x-this.x)*blend;this.y+=(y-this.y)*blend;this.resuming=false
  if(this.blinkAt===null&&this.time>=this.nextBlink)this.blinkAt=this.nextBlink
  let closure=0;if(this.blinkAt!==null){const t=(this.time-this.blinkAt)/.16;if(t>=1){this.blinkAt=null;this.nextBlink=this.time+3+clamp(this.random(),0,1)*3}else closure=Math.sin(Math.PI*t)}
  const values={}
  const set=(role,unit)=>{for(const id of this.roles[role]??[]){const p=this.parameters[id];if(!validParameter(p)||this.reserved.has(id))continue;unit=clamp(unit*(this.reverse[role]?-1:1),-.35,.35);values[id]=clamp(p.default+unit*(unit>=0?p.max-p.default:p.default-p.min),p.min,p.max)}}
  for(const id of this.roles.blink??[]){const p=this.parameters[id];if(validParameter(p)&&!this.reserved.has(id))values[id]=p.default+((this.reverse.blink?p.max:p.min)-p.default)*closure}
  for(const id of this.roles.breath??[]){const p=this.parameters[id];if(validParameter(p)&&!this.reserved.has(id))values[id]=p.default+((this.reverse.breath?p.min:p.max)-p.default)*(.125-.125*Math.cos(this.time*Math.PI/2))}
  const bounce=this.pulse>0?Math.sin(Math.PI*(1-this.pulse/.18)):0
  set('headX',this.x*.35);set('headY',this.y*.35);set('headZ',this.x*.1+bounce*.1)
  set('bodyX',this.x*.25);set('bodyY',bounce*.3);set('bodyZ',this.x*.1)
  return values
 }
 report(){return {supported:[...new Set(Object.values(this.roles).flat())].filter(id=>!this.reserved.has(id)),reserved:[...this.reserved],disabled:{...this.disabled}}}
}
