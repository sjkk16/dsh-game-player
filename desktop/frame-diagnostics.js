// Allocated only by private-canvas QA. No input text or desktop pixels.
export class FrameDiagnostics {
  constructor(limit = 512) { this.limit=limit; this.intervals=[]; this.updates=[]; this.draws=[]; this.frames=0; this.first=null; this.last=null; this.simulationSeconds=0 }
  record(now, dt, updateMs, drawMs) {
    if(this.first===null)this.first=now
    if(this.last!==null)this.push(this.intervals,Math.max(0,now-this.last))
    this.last=now;this.frames++;this.simulationSeconds+=dt;this.push(this.updates,updateMs);this.push(this.draws,drawMs)
  }
  push(list,value) { if(!Number.isFinite(value)||value<0)throw Error('Invalid private frame metric');if(list.length===this.limit)list.shift();list.push(value) }
  snapshot() {
    const stats=list=>{const sorted=[...list].sort((a,b)=>a-b);return {samples:list.length,meanMs:list.reduce((a,b)=>a+b,0)/(list.length||1),p95Ms:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??0,maxMs:sorted.at(-1)??0}}
    const elapsedMs=this.last===null?0:this.last-this.first
    return {frames:this.frames,elapsedMs,actualFps:elapsedMs>0?(this.frames-1)*1000/elapsedMs:0,simulationSeconds:this.simulationSeconds,frameInterval:stats(this.intervals),update:stats(this.updates),draw:stats(this.draws),retainedSamples:this.intervals.length}
  }
}
