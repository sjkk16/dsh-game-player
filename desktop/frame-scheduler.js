/** One visible RAF loop, capped at 60 Hz. State expiry is independent of drawing. */
export class FrameScheduler {
  constructor(draw, clock = {}) {
    this.draw=draw;this.now=clock.now??(()=>performance.now())
    this.setTimer=clock.setTimer??((fn,ms)=>globalThis.setTimeout(fn,ms));this.clearTimer=clock.clearTimer??(id=>globalThis.clearTimeout(id))
    const nativeRaf=typeof globalThis.requestAnimationFrame==='function'&&!clock.setTimer
    this.requestFrame=clock.requestFrame??(nativeRaf?fn=>globalThis.requestAnimationFrame(fn):fn=>this.setTimer(()=>fn(this.now()),Math.max(0,this.nextAt-this.now())))
    this.cancelFrame=clock.cancelFrame??(nativeRaf?id=>globalThis.cancelAnimationFrame(id):this.clearTimer)
    this.visible=false;this.disposed=false;this.animating=false;this.timer=null;this.last=null;this.nextAt=0;this.epoch=0
  }
  touch() { this.schedule() }
  setAnimating(value) { this.animating=value===true;this.touch() }
  setVisible(value) {
    value=value===true
    if(this.visible===value||this.disposed)return
    this.visible=value;this.cancel();this.last=null;this.nextAt=this.now()
    if(value)this.schedule()
  }
  cancel() { this.epoch++;if(this.timer!==null)this.cancelFrame(this.timer);this.timer=null }
  schedule() {
    if(!this.visible||this.disposed||this.timer!==null)return
    const epoch=this.epoch
    this.timer=this.requestFrame(()=>{
      // A canceled callback may arrive after a hide/re-show. It cannot clear the new request.
      if(epoch!==this.epoch||!this.visible||this.disposed)return
      this.timer=null
      const now=Math.max(this.last??-Infinity,this.now()),period=1000/60
      if(this.last===null||now+.05>=this.nextAt){
        const dt=this.last===null?0:Math.min(.1,Math.max(0,(now-this.last)/1000))
        this.last=now
        // Deadlines are start-to-start, not draw-time plus a full frame sleep.
        this.nextAt=this.nextAt+Math.max(1,Math.floor((now-this.nextAt+.05)/period)+1)*period
        try{this.draw(now,dt)}catch(error){this.setVisible(false);throw error}
      }
      this.schedule()
    })
  }
  dispose() { this.disposed=true;this.visible=false;this.cancel();this.last=null }
}
