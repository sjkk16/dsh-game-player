// Bounded, in-memory pipeline counters. Never retains key identities, text or history.
export class InputDisplayDiagnostics {
  constructor(now=Date.now){this.now=now;this.stages=new Map()}
  record(stage,value={}){
    if(!['human','ai','merged','sent','received','rendered'].includes(stage))return
    const old=this.stages.get(stage)
    this.stages.set(stage,{messages:(old?.messages??0)+1,sequence:Number.isSafeInteger(value.sequence)?value.sequence:null,
      keyCount:Array.isArray(value.keys)?value.keys.length:Array.isArray(value.heldKeys)?value.heldKeys.length:0,
      status:['ready','syncing','releasing','unknown','locked'].includes(value.status)?value.status:null,at:this.now()})
  }
  snapshot(){return Object.fromEntries([...this.stages].map(([stage,{at,...value}])=>[stage,{...value,ageMs:Math.max(0,this.now()-at)}]))}
}
