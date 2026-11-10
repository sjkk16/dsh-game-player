// Reusable per-model visual buffers. Baselines and confirmed real state never alias.
const finite=value=>{if(!Number.isFinite(value))throw Error('Non-finite model state');return value}
export class VisualState {
  constructor(core,parameterSlots,partSlots,gateSlots) {
    this.parameterSlots=parameterSlots;this.partSlots=partSlots;this.gateSlots=gateSlots
    this.values=new Float32Array(parameterSlots.length);this.parts=new Float32Array(partSlots.length);this.gates=new Float32Array(gateSlots.length);this.opacity=1
    this.capture(core)
  }
  capture(core) {
    for(let i=0;i<this.parameterSlots.length;i++)this.values[i]=finite(core.getParameterValueByIndex(this.parameterSlots[i]))
    for(let i=0;i<this.partSlots.length;i++)this.parts[i]=finite(core.getPartOpacityByIndex(this.partSlots[i]))
    for(let i=0;i<this.gateSlots.length;i++)this.gates[i]=finite(core.getParameterValueById(this.gateSlots[i]))
    this.opacity=finite(core.getModelOapcity())
  }
  restore(core) {
    for(let i=0;i<this.parameterSlots.length;i++)core.setParameterValueByIndex(this.parameterSlots[i],this.values[i])
    for(let i=0;i<this.partSlots.length;i++)core.setPartOpacityByIndex(this.partSlots[i],this.parts[i])
    for(let i=0;i<this.gateSlots.length;i++)core.setParameterValueById(this.gateSlots[i],this.gates[i])
    core.setModelOapcity(this.opacity)
  }
  copyFrom(source) { this.values.set(source.values);this.parts.set(source.parts);this.gates.set(source.gates);this.opacity=source.opacity }
  overlay(values,indices) { for(const [id,value]of Object.entries(values))if(Object.hasOwn(indices,id))this.values[indices[id]]=finite(value) }
}
export class PhysicsOutputState {
  constructor(core,slots) { this.slots=slots;this.values=new Float32Array(slots.length);this.capture(core) }
  capture(core) { for(let i=0;i<this.slots.length;i++)this.values[i]=finite(core.getParameterValueByIndex(this.slots[i])) }
  restore(core) { for(let i=0;i<this.slots.length;i++)core.setParameterValueByIndex(this.slots[i],this.values[i]) }
}
