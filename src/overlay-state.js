import { KEY_MAP } from './keys.js'
const names = new Map(Object.entries(KEY_MAP.keys).map(([key, code]) => [code, key]))
const buttonNames = ['left', 'right', 'middle']
const events = new Set(['state','down','up','move','wheel','fault'])
export const AFTERGLOW_MS = 180
export function validPosition(p) { return p === null || (p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1) }
export function normalizePosition(x,y,bounds) {
  if(!bounds || ![x,y,bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite) || bounds.width<=0 || bounds.height<=0)return null
  return {x:Math.max(0,Math.min(1,(x-bounds.x)/Math.max(1,bounds.width-1))),y:Math.max(0,Math.min(1,(y-bounds.y)/Math.max(1,bounds.height-1)))}
}
export function isInputObservation(m) {
  return m?.kind === 'input-observation' && typeof m.session === 'string' && m.session.length <= 128
    && Number.isSafeInteger(m.sequence) && m.sequence > 0 && ['worker','guard'].includes(m.source)
    && Number.isFinite(m.timestamp) && Number.isInteger(m.ownerId) && m.ownerId >= 0
    && (m.position === undefined || validPosition(m.position))
    && events.has(m.event) && [0,1,2,3].includes(m.device) && Number.isInteger(m.code)
    && Number.isInteger(m.amount) && [0,1,2].includes(m.state) && typeof m.uncertain === 'boolean'
    && Array.isArray(m.heldKeys) && m.heldKeys.length <= 256 && m.heldKeys.every(k => Number.isInteger(k) && k >= 0 && k <= 255)
    && Array.isArray(m.heldButtons) && m.heldButtons.length <= 3 && m.heldButtons.every(k => [0,1,2].includes(k))
    && (m.resync === undefined || typeof m.resync === 'boolean')
    && (m.locked === undefined || typeof m.locked === 'boolean')
    && (m.device !== 3 || m.code === 0)
    && (!['down','up'].includes(m.event) || m.device!==1 || (m.code>=0&&m.code<=255))
    && (!['down','up'].includes(m.event) || m.device!==2 || [0,1,2].includes(m.code))
}
export class InputDisplayState {
  constructor(now = Date.now) { this.now=now; this.session=undefined; this.sequence=0; this.reset('real') }
  reset(mode) {
    this.position=null; this.mode=mode; this.status='ready'; this.keys=new Set(); this.buttons=new Set(); this.pulses=new Map()
    this.moveUntil=0; this.textUntil=0; this.wheelUntil=0; this.wheelDirection=0; this.hint=''
  }
  pulse(id) { this.pulses.set(id, this.now()+AFTERGLOW_MS) }
  accept(m) {
    if(m.kind==='observation-status') {
      if(m.status==='connected') { this.session=m.session; this.sequence=0; this.reset('real');if(m.locked)this.status='locked'; return true }
      if(m.session!==this.session) return false
      this.status=m.locked?'locked':m.status==='released'?'ready':'unknown'
      if(m.status==='released') { this.keys.clear(); this.buttons.clear() }
      return true
    }
    if(!isInputObservation(m) || m.session!==this.session || m.sequence<=this.sequence) return false
    const gap=this.sequence>0 && m.sequence!==this.sequence+1
    this.sequence=m.sequence
    this.position=m.position ? {...m.position} : null
    const nextKeys=new Set(m.heldKeys.map(code=>names.get(code)??('vk_'+code)))
    const nextButtons=new Set(m.heldButtons.map(code=>buttonNames[code]))
    for(const key of this.keys) if(!nextKeys.has(key)) this.pulse('key:'+key)
    for(const button of this.buttons) if(!nextButtons.has(button)) this.pulse('button:'+button)
    this.keys=nextKeys; this.buttons=nextButtons
    this.status=m.locked?'locked':m.uncertain||m.state===2||m.event==='fault'?'unknown':m.resync||gap?'syncing':m.state===1&&(nextKeys.size+nextButtons.size)>0?'releasing':'ready'
    if(['down','up'].includes(m.event)) {
      if(m.device===1) this.pulse('key:'+(names.get(m.code)??('vk_'+m.code)))
      if(m.device===2) this.pulse('button:'+buttonNames[m.code])
      if(m.device===3) this.textUntil=this.now()+AFTERGLOW_MS
    }
    if(m.event==='move') this.moveUntil=this.now()+AFTERGLOW_MS
    if(m.event==='wheel') { this.wheelUntil=this.now()+AFTERGLOW_MS; this.wheelDirection=Math.sign(m.amount) }
    return true
  }
  snapshot() {
    const now=this.now(); for(const [id,till] of this.pulses) if(till<=now) this.pulses.delete(id)
    // Relative lifetimes allow the UI to use its own monotonic clock.
    return { mode:this.mode,status:this.status,keys:[...this.keys],buttons:[...this.buttons],
      pulses:[...this.pulses].map(([id,till])=>({id,ms:Math.max(0,till-now)})),
      moveMs:Math.max(0,this.moveUntil-now),textMs:Math.max(0,this.textUntil-now),
      wheelMs:Math.max(0,this.wheelUntil-now),wheelDirection:this.wheelDirection,hint:this.hint,position:this.position }
  }
}

// A private, cancelable visual timeline, never an operating-system input source.
export class InputPreview {
  constructor(state, changed, {sleep}={}) {
    this.bounds=null; this.state=state; this.changed=changed; this.controller=undefined
    this.sleep=sleep??((ms,signal)=>new Promise(resolve=>{
      if(signal.aborted)return resolve()
      const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve()}
      const timer=setTimeout(finish,ms);timer.unref?.();signal.addEventListener('abort',finish,{once:true})
    }))
  }
  stop() { this.controller?.abort(); this.controller=undefined }
  start(actions, repeat=1, maxHoldMs=3000, signal) {
    this.stop(); const c=new AbortController(); this.controller=c
    const abort=()=>c.abort(); signal?.addEventListener('abort',abort,{once:true})
    this.state.reset('simulation'); this.changed()
    const emit=()=>{if(!c.signal.aborted)this.changed()}
    const down=(kind,names)=>{const set=kind==='key'?this.state.keys:this.state.buttons;const added=names.filter(n=>!set.has(n));for(const n of added)set.add(n);emit();return added}
    const up=(kind,names)=>{const set=kind==='key'?this.state.keys:this.state.buttons;for(const n of names){set.delete(n);this.state.pulse(kind+':'+n)}emit()}
    const deadlines=new Map()
    const wait=async ms=>{
      const end=this.state.now()+ms
      while(!c.signal.aborted&&this.state.now()<end){
        const next=Math.min(end,...deadlines.values())
        await this.sleep(Math.max(0,next-this.state.now()),c.signal)
        if(c.signal.aborted)return
        for(const [id,until] of deadlines)if(this.state.now()>=until){const [kind,name]=id.split(':');up(kind,[name]);deadlines.delete(id)}
      }
    }
    const run=async()=>{
      try {
        if(signal?.aborted)c.abort()
        for(let round=0;round<repeat&&!c.signal.aborted;round++) for(const a of actions) {
          if(c.signal.aborted)return
          // Release illustrative persistent downs at their configured deadline.
          for(const [id,until] of deadlines)if(this.state.now()>=until){const [kind,name]=id.split(':');up(kind,[name]);deadlines.delete(id)}
          const button=a.button??'left'
          const move=(x,y)=>{this.state.position=normalizePosition(x,y,this.bounds);this.state.moveUntil=this.state.now()+AFTERGLOW_MS;emit()}
          switch(a.kind) {
            case 'keydown': for(const n of down('key',a.keys))deadlines.set('key:'+n,this.state.now()+maxHoldMs);break
            case 'keyup': up('key',a.keys);for(const n of a.keys)deadlines.delete('key:'+n);break
            case 'down': for(const n of down('button',[button]))deadlines.set('button:'+n,this.state.now()+maxHoldMs);break
            case 'up': up('button',[button]);deadlines.delete('button:'+button);break
            case 'key': case 'hold': {const added=down('key',a.keys);await wait(a.kind==='hold'?(a.holdMs??200):30);if(c.signal.aborted)return;up('key',added);break}
            case 'click': if(a.x!==undefined)move(a.x,a.y);for(let i=0;i<(a.count??1)&&!c.signal.aborted;i++){const added=down('button',[button]);await wait(28);if(c.signal.aborted)return;up('button',added);if(i+1<(a.count??1))await wait(60)}break
            case 'drag': {move(a.fromX,a.fromY);const added=down('button',[button]);await wait(40);for(let i=1;i<=(a.steps??12)&&!c.signal.aborted;i++){move(a.fromX+(a.x-a.fromX)*i/(a.steps??12),a.fromY+(a.y-a.fromY)*i/(a.steps??12));await wait(18)}if(c.signal.aborted)return;up('button',added);break}
            case 'move': move(a.x,a.y);break
            case 'scroll': this.state.wheelUntil=this.state.now()+AFTERGLOW_MS;this.state.wheelDirection=Math.sign(a.amount??120);emit();break
            case 'type': this.state.textUntil=this.state.now()+Math.max(AFTERGLOW_MS,a.text.length*8);emit();await wait(a.text.length*8);break
            case 'wait': await wait(a.durationMs);break
          }
        }
        if(this.state.keys.size||this.state.buttons.size) await wait(Math.max(0,...[...deadlines.values()].map(t=>t-this.state.now())))
        if(!c.signal.aborted){up('key',[...this.state.keys]);up('button',[...this.state.buttons])}
      } finally {signal?.removeEventListener('abort',abort);if(this.controller===c){if(c.signal.aborted){this.state.reset('simulation');this.changed()}this.controller=undefined}}
    }
    this.done=run().catch(()=>{if(this.controller===c){this.state.reset('simulation');this.state.status='unknown';this.changed()}})
  }
}
