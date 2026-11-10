import {inputTool} from './tools.js'
import {regionSchema} from './geometry.js'
import {normalizeAction,validateBalanced,validateBudget} from './keys.js'
const actionSchema=inputTool({options:{maxHoldMs:3000},normalize:normalizeAction}).parameters.properties.actions.items
export const clientSchema={type:'object',additionalProperties:false,required:['x','y','width','height'],properties:regionSchema.properties}
export const windowSchema={type:'object',additionalProperties:false,required:['windowId','title','pid','processStart','valid','focused','minimized','client'],properties:{windowId:{type:'string'},title:{type:'string'},pid:{type:'integer'},processStart:{type:'string'},valid:{type:'boolean'},focused:{type:'boolean'},minimized:{type:'boolean'},client:clientSchema}}
const sizeSchema={type:'object',additionalProperties:false,required:['width','height'],properties:{width:{type:'integer'},height:{type:'integer'}}}
const templateMeta={type:'object',additionalProperties:false,required:['name','revision'],properties:{name:{type:'string'},revision:{type:'string'},referenceSize:sizeSchema}}
const jsonRender=(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}]
export function windowTool({windows}){
  return {name:'game_window',description:'List visible top-level windows; explicitly bind one windowId before real input. Bindings belong to this agent only and are not saved. No automatic focusing. bind/unbind cancels input, confirms release and stops old watchers.',parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['list','bind','status','unbind']},windowId:{type:'string'}}},output:{schema:{type:'object',additionalProperties:false,properties:{windows:{type:'array',items:windowSchema},bound:{type:'boolean'},inputLocked:{type:'boolean'},...windowSchema.properties,lastError:{type:'string'}}},render:jsonRender},isConcurrencySafe:()=>false,async execute(args,exec){
    if(exec.signal?.aborted)throw new Error('Window call canceled.')
    switch(args.action){case'list':return{windows:await windows.list(exec.signal)};case'bind':if(typeof args.windowId!=='string'||!args.windowId)throw new Error('Explicit windowId required.');return windows.bind(exec.agent,args.windowId);case'status':return windows.status(exec.agent);case'unbind':return windows.unbind(exec.agent);default:throw new Error('Invalid game_window action.')}
  }}
}
export function macroTool({store,windows,options}){
  return {name:'game_macro',description:'Manage a shared, plaintext local template library: list/get/save/delete. Reading or writing requires host approval when enabled. Do not store credentials. Templates use client-relative coordinates and exact reference dimensions; they never save window bindings or approval. Run with game_input macro + revision.',parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['list','get','save','delete']},name:{type:'string'},actions:{type:'array',items:actionSchema},expectedRevision:{type:'string'}}},output:{schema:{type:'object',additionalProperties:false,properties:{templates:{type:'array',items:templateMeta},name:{type:'string'},revision:{type:'string'},referenceSize:sizeSchema,actions:{type:'array',items:actionSchema},deleted:{type:'boolean'}}},render:jsonRender},isConcurrencySafe:()=>false,async execute(args,exec){
    if(exec.signal?.aborted)throw new Error('Template call canceled.')
    switch(args.action){
      case'list':return store.list();case'get':return store.get(args.name);case'delete':return store.delete(args.name,args.expectedRevision)
      case'save':{
        if(!Array.isArray(args.actions)||!args.actions.length||args.actions.length>12)throw new Error('Template needs 1 to 12 steps.')
        const actions=args.actions.map(a=>normalizeAction(a,options.maxHoldMs));validateBalanced(actions,options.maxHoldMs);validateBudget(actions,options.helperTimeoutMs)
        let referenceSize
        if(actions.some(a=>a.x!==undefined)){const info=await windows.current(exec.agent,exec.signal);if(!info.valid||info.minimized)throw new Error('Valid bound window required to save coordinates.');referenceSize={width:info.client.width,height:info.client.height}}
        if(exec.signal?.aborted)throw new Error('Template save canceled.')
        return store.save(args.name,{actions,referenceSize},args.expectedRevision)
      }
      default:throw new Error('Invalid game_macro action.')
    }
  }}
}
