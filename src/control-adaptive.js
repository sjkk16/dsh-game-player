import { KEY_MAP } from './keys.js'
import { AFTERGLOW_MS, validPosition } from './overlay-state.js'
const keyNames=new Map(Object.entries(KEY_MAP.keys).map(([name,code])=>[code,name]));keyNames.set(256,'numenter')
const buttonNames=['left','right','middle','x1','x2']
const meaningful=new Set(['down','up','move','wheel'])
export { actorText } from './live2d/control-labels.js'
// Render-only state: never owns, injects or releases operating-system input.
export class AdaptiveDisplayState {
 constructor(now=Date.now){this.now=now;this.lastActor=null;this.order=0;this.aiWheelOrder=-Infinity;this.humanWheelOrder=-Infinity;this.aiAt=null;this.aiPositionAt=-Infinity;this.humanPositionAt=-Infinity;this.externalUntil=0;this.session=null;this.sequence=0;this.humanAt=null;this.clearHuman()}
 clearHuman(){this.human={keys:[],buttons:[],pulses:new Map(),position:null,moveUntil:0,wheelUntil:0,wheelDirection:0};this.humanError=null;this.humanPositionAt=-Infinity;this.humanWheelOrder=-Infinity}
 observeAI(m,state){
  this.aiAt=this.now()
  if(m.kind!=='input-observation'||!meaningful.has(m.event)||m.uncertain||m.event==='fault')return false
  const order=++this.order;this.lastActor='ai';if(m.event==='move')this.aiPositionAt=order;if(m.event==='wheel')this.aiWheelOrder=order;return true
 }
 observeHuman(m){
  if(m?.kind==='human-observer-status'){
   if(m.status==='connected'&&typeof m.session==='string'&&m.session.length<=128){this.clearHuman();this.session=m.session;this.sequence=0;this.humanAt=this.now()}
   else if(m.session===this.session||m.session===''){this.clearHuman();this.session=null;if(m.status==='error')this.humanError='人的输入监听不可用；仅保留已确认的 AI 状态'}
   return true
  }
  if(m?.kind!=='human-observation'||m.session!==this.session||!Number.isSafeInteger(m.sequence)||m.sequence<=this.sequence||!['human','external'].includes(m.source)||!['state',...meaningful].includes(m.event)||!Array.isArray(m.heldKeys)||m.heldKeys.length>256||m.heldKeys.some(v=>!Number.isInteger(v)||v<0||v>256)||!Array.isArray(m.heldButtons)||m.heldButtons.length>5||m.heldButtons.some(v=>!Number.isInteger(v)||v<0||v>4)||!validPosition(m.position)||![0,1,2].includes(m.device)||!Number.isInteger(m.code)||m.code<0||m.code>256||!Number.isInteger(m.amount)||Math.abs(m.amount)>65536||(meaningful.has(m.event)&&m.device===0))return false
  const now=this.now(),gap=this.sequence>0&&m.sequence!==this.sequence+1;this.sequence=m.sequence
  if(m.source==='external'){this.externalUntil=now+1500;return true}
  this.humanAt=now;this.humanError=null
  const h=this.human,keys=m.heldKeys.map(c=>keyNames.get(c)??('vk_'+c)),buttons=m.heldButtons.map(c=>buttonNames[c])
  for(const k of h.keys)if(!keys.includes(k))h.pulses.set('key:'+k,now+AFTERGLOW_MS)
  for(const b of h.buttons)if(!buttons.includes(b))h.pulses.set('button:'+b,now+AFTERGLOW_MS)
  h.keys=keys;h.buttons=buttons;h.position=m.position?{...m.position}:null
  if(gap||m.resync)h.pulses.clear() // full held snapshot repairs a lost edge without inventing it
  if(meaningful.has(m.event)){
   const order=++this.order;this.lastActor='human';this.humanError=null
   if(['down','up'].includes(m.event)){const id=m.device===1?'key:'+(keyNames.get(m.code)??('vk_'+m.code)):m.device===2?'button:'+buttonNames[m.code]:null;if(id)h.pulses.set(id,now+AFTERGLOW_MS)}
   if(m.event==='move'){h.moveUntil=now+AFTERGLOW_MS;this.humanPositionAt=order}
   if(m.event==='wheel'){h.wheelUntil=now+AFTERGLOW_MS;h.wheelDirection=Math.sign(m.amount);this.humanWheelOrder=order}
  }
  return true
 }
 snapshot(ai,selected=ai){
  const now=this.now();if(this.session&&this.humanAt!==null&&now-this.humanAt>1500){this.clearHuman();this.humanError='人的输入监听已过期；不推测持续按键'}
  const h=this.human,preview=selected.mode==='simulation',base=preview?selected:ai
  for(const[id,t]of h.pulses)if(t<=now)h.pulses.delete(id)
  const keys=[...new Set([...base.keys,...h.keys])],buttons=[...new Set([...base.buttons,...h.buttons])]
  const pulses=new Map((base.pulses??[]).map(p=>[p.id,p.ms]));for(const[id,t]of h.pulses)pulses.set(id,Math.max(pulses.get(id)??0,t-now))
  // Preserve each source's safety independently; human heartbeat cannot refresh AI.
  const aiStatus=ai.status==='locked'?'locked':this.aiAt!==null&&now-this.aiAt>1500?'unknown':ai.status
  const humanWheel=Math.max(0,h.wheelUntil-now),baseWheel=base.wheelMs??0
  return {...base,status:['locked','unknown','releasing','syncing'].includes(aiStatus)?aiStatus:base.status,
   keys,buttons,pulses:[...pulses].map(([id,ms])=>({id,ms})),moveMs:Math.max(base.moveMs??0,h.moveUntil-now,0),wheelMs:Math.max(baseWheel,humanWheel),wheelDirection:humanWheel>0&&(baseWheel<=0||this.humanWheelOrder>this.aiWheelOrder)?h.wheelDirection:base.wheelDirection,
   position:this.humanPositionAt>this.aiPositionAt&&h.position?h.position:base.position,
   controlMode:'adaptive',lastActor:this.lastActor,humanError:this.humanError,externalInput:now<this.externalUntil,preview:preview}
 }
}
