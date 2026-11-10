import { assertClient } from './geometry.js'
/** Agent-local bindings; pending requests carry abortable binding generations. */
export function createWindowController({ctx, bridge, ownerId, stopWatch, imageDemand}) {
  const states=new Map(),dead=new WeakSet();let disposed=false
  const own=agent=>{
    if(disposed||!agent||agent.id===undefined||typeof agent.ctx?.effect!=='function'||dead.has(agent))throw new Error('Window control needs a live owning agent.')
    const id=String(agent.id)
    if(!states.has(id)){
      const s={controller:new AbortController(),queue:Promise.resolve(),generation:0};states.set(id,s)
      agent.ctx.effect(()=>()=>{dead.add(agent);s.controller.abort();states.delete(id);stopWatch(agent);imageDemand.clear(id)},'game-player.window-owner')
    }
    return states.get(id)
  }
  const bound=agent=>states.get(String(agent?.id))?.binding!==undefined
  const current=async(agent,signal)=>{
    const s=own(agent),binding=s.binding,generation=s.generation
    if(!binding)throw new Error('Bind a target window with game_window before real input/window capture.')
    const value=await bridge.request({op:'window',windowId:binding.windowId},signal)
    if(s.generation!==generation||s.binding!==binding)throw new Error('Window binding changed during request.')
    return value.window
  }
  const change=(agent,windowId)=>{
    const s=own(agent)
    // Invalidate immediately, including requests queued before the mutation.
    s.controller.abort();s.blocked=true;s.generation++;s.controller=new AbortController();const generation=s.generation
    const run=async()=>{
      if(s.generation!==generation||disposed||dead.has(agent))throw new Error('Window change superseded or disposed.')
      stopWatch(agent)
      if(!(await bridge.releaseAll(ownerId(agent))))throw new Error('Input release unconfirmed; binding unchanged and input locked.')
      if(s.generation!==generation||disposed||dead.has(agent))throw new Error('Window change superseded or disposed.')
      s.binding=undefined
      if(windowId!==undefined){const response=await bridge.request({op:'window',windowId});if(!response.window.valid)throw new Error('Invalid target window.');if(s.generation!==generation||dead.has(agent))throw new Error('Window change superseded.');s.binding={windowId:response.window.windowId}}
      s.blocked=false
      imageDemand.mark(String(agent.id))
      return status(agent)
    }
    const result=s.queue.then(run,run);s.queue=result.catch(()=>{});return result
  }
  const status=async agent=>{
    const s=own(agent);if(!s.binding)return {bound:false}
    try{return {bound:true,inputLocked:s.blocked===true,...await current(agent)}}catch(error){return {bound:true,valid:false,windowId:s.binding?.windowId,lastError:String(error.message)}}
  }
  const lease=agent=>{const s=own(agent);if(s.blocked)throw new Error('Window change pending or release unconfirmed; input locked.');if(!s.binding)throw new Error('A target window must be bound before real input.');return s.controller.signal}
  ctx.effect(()=>()=>{disposed=true;for(const s of states.values())s.controller.abort();states.clear()},'game-player.windows')
  return {bound,current,lease,status,bind:(a,id)=>change(a,id),unbind:a=>change(a),list:async signal=>(await bridge.request({op:'windows'},signal)).windows}
}
