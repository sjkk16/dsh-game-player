/** Bounded duration-only samples. Never accepts request bodies, images or key identities. */
const STAGES = new Set(['readonlyQueueMs','readonlyStartupMs','readonlyRoundTripMs','captureMs','fingerprintMs','resizeMs','encodeMs','base64Ms','attachmentMs','screenTotalMs']);
export class PerformanceTimings {
  constructor(limit=128){this.limit=Math.max(1,Math.min(128,limit));this.samples=new Map()}
  record(stage,ms){if(!STAGES.has(stage)||!Number.isFinite(ms)||ms<0)return;const values=this.samples.get(stage)??[];if(values.length===this.limit)values.shift();values.push(ms);this.samples.set(stage,values)}
  snapshot(){return Object.fromEntries([...this.samples].map(([stage,values])=>{const sorted=[...values].sort((a,b)=>a-b),at=p=>Math.round(sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]*100)/100;return [stage,{count:values.length,p50:at(.5),p95:at(.95)}]}))}
}
