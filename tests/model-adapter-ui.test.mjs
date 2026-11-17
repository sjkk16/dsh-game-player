import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
let definition;globalThis.window={__ModuleLoader__:{load:v=>definition=v}};await import('../client.js')
function harness(){const states=[],refs=[],deps=[],effects=[];let sc=0,rc=0,ec=0;const React={createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),useId:()=> 'adapter-test',useSyncExternalStore:(_,snapshot)=>snapshot(),useState(initial){const i=sc++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value]},useRef(initial){const i=rc++;return refs[i]??={current:initial}},useEffect(fn,values){const i=ec++,old=deps[i];if(!old||values.some((v,j)=>v!==old[j])){deps[i]=values;effects.push(fn)}}};const ui=definition.factory(id=>{assert.equal(id,'react');return React});return{ui,render(component,props,flush=true){sc=rc=ec=0;const result=ui[component](props);if(flush)this.flush();return result},flush(){while(effects.length)effects.shift()()}}}
const collect=(node,predicate,out=[])=>{if(node&&typeof node==='object'){if(predicate(node))out.push(node);for(const child of node.children??[])collect(child,predicate,out)}return out}
const button=(tree,key)=>collect(tree,n=>n.type==='button'&&n.props.key===key)[0],row=(tree,key)=>collect(tree,n=>n.type==='div'&&n.props.key===key)[0],select=tree=>collect(tree,n=>n.type==='select')[0]
const value=()=>({revision:3,enabled:true,visible:false,modelLoaded:false,loading:false,capabilities:{management:true,picker:true,adaptation:true,handStyles:true,model:false},adapterCatalog:{generation:randomUUID(),modelKey:'a'.repeat(64),parameters:[{id:'CatParamLeftHandDown',name:'Keyboard',min:0,max:1,default:0},{id:'ParamAngleX',name:'Head X',min:-30,max:30,default:0},{id:'ParamEyeLOpen',name:'Left eye',min:0,max:1,default:1},{id:'ParamEyeROpen',name:'Right eye',min:0,max:1,default:1},{id:'Paramshuiying',name:'Watermark',min:0,max:1,default:0}],inputs:[{role:'keyboard',id:'CatParamLeftHandDown',reverse:false,source:'auto',enabled:true},{role:'mouseX',id:null,reverse:false,source:'auto',enabled:false,error:'Model does not provide this input'}],effects:[{role:'headX',ids:['ParamAngleX'],reverse:false,source:'auto',enabled:true},{role:'blink',ids:['ParamEyeLOpen','ParamEyeROpen'],reverse:false,source:'auto',enabled:true}],handStyles:[{id:'default'},{id:'labels'},{id:'no-labels'}],handStyle:'default',warnings:[]}})
const props=v=>{
 const calls=[],state={status:'ready',pending:'',adapterSave:{status:'idle',draft:{}}}
 const manager={command:a=>calls.push(['command',a]),retryAdapter:()=>calls.push(['retry']),set:(k,a)=>{
  calls.push(['set',k,a]);if(k!=='modelAdapter')return
  const old=state.adapterSave.draft??{},draft={...old}
  for(const kind of ['bindings','effects'])if(a[kind])draft[kind]={...(old[kind]??{}),...a[kind]}
  if(a.handStyle)draft.handStyle=a.handStyle
  state.adapterSave={status:'saving',identity:JSON.stringify([v.adapterCatalog.modelKey,JSON.stringify([v.preferences?.modelPath??null,v.preferences?.modelEntry??null])]),catalogGeneration:a.catalogGeneration,draft}
 }}
 return {calls,manager,state,value:v,t:k=>k}
}
test('both host settings entries reuse shared candidate and adapter components',()=>{const h=harness(),p=props(value());assert.equal(typeof h.ui.ModelAdapterControls,'function');assert.equal(typeof h.ui.ModelCandidateControls,'function');const manager={...p.manager,subscribe:()=>()=>{},getSnapshot:()=>({...p.state,value:p.value})};const tree=h.render('OverlayControls',{manager,t:p.t});assert.equal(collect(tree,n=>n.type===h.ui.ModelAdapterControls).length,1);assert.equal(collect(tree,n=>n.type===h.ui.ModelCandidateControls).length,1)})
test('parameter read is available before model/catalog readiness and never sends show',()=>{
 const h=harness(),p=props({...value(),adapterCatalog:null}),tree=h.render('ModelAdapterControls',p)
 assert.equal(button(tree,'adapter-read').props.disabled,false);assert.equal(button(tree,'adapter-save'),undefined)
 assert.equal(collect(tree,n=>n.props.key==='adapter-status')[0].children[0],'local.adapterAutoSave')
 button(tree,'adapter-read').props.onClick();assert.deepEqual(p.calls,[['command','refreshAdapter']])
})
for(const [label,alter]of [['disabled',v=>v.enabled=false],['old runtime',v=>v.capabilities.adaptation=false],['no owner management',v=>v.capabilities.management=false],['busy',v=>v.loading=true]])test(label+' disables adapter controls with explicit reason',()=>{const h=harness(),v=value();alter(v);const tree=h.render('ModelAdapterControls',props(v));assert.equal(button(tree,'adapter-read').props.disabled,true);assert.ok(button(tree,'adapter-read').props.title)})
test('parameter selection and reversing automatically submit actual catalog bindings',()=>{
 const h=harness(),p=props(value());let tree=h.render('ModelAdapterControls',p)
 select(row(tree,'bindings-keyboard')).props.onChange({target:{value:'ParamAngleX'}})
 tree=h.render('ModelAdapterControls',p)
 collect(row(tree,'bindings-keyboard'),n=>n.type==='input')[0].props.onChange({target:{checked:true}})
 assert.deepEqual(p.calls,[['set','modelAdapter',{catalogGeneration:p.value.adapterCatalog.generation,bindings:{keyboard:{id:'ParamAngleX',reverse:false}}}],['set','modelAdapter',{catalogGeneration:p.value.adapterCatalog.generation,bindings:{keyboard:{id:'ParamAngleX',reverse:true}}}]])
 assert.equal(button(tree,'adapter-save'),undefined)
})
test('explicit disable automatically sends null, not a fake parameter or animation',()=>{
 const h=harness(),p=props(value()),tree=h.render('ModelAdapterControls',p)
 select(row(tree,'bindings-keyboard')).props.onChange({target:{value:''}})
 assert.deepEqual(p.calls,[['set','modelAdapter',{catalogGeneration:p.value.adapterCatalog.generation,bindings:{keyboard:null}}]])
})
test('blink groups and reversing automatically save all selected author parameters',()=>{
 const h=harness(),p=props(value());let tree=h.render('ModelAdapterControls',p)
 const picker=select(row(tree,'effects-blink'));assert.equal(picker.props.multiple,true)
 picker.props.onChange({target:{selectedOptions:[{value:'ParamEyeLOpen'},{value:'ParamEyeROpen'}]}})
 tree=h.render('ModelAdapterControls',p);collect(row(tree,'effects-blink'),n=>n.type==='input')[0].props.onChange({target:{checked:true}})
 assert.equal(p.calls.length,2);assert.deepEqual(p.calls[1],['set','modelAdapter',{catalogGeneration:p.value.adapterCatalog.generation,effects:{blink:{ids:['ParamEyeLOpen','ParamEyeROpen'],reverse:true}}}])
})
test('watermark and input-owned parameters are not selectable for decoration',()=>{const h=harness(),tree=h.render('ModelAdapterControls',props(value())),options=collect(row(tree,'effects-headX'),n=>n.type==='option');assert.equal(options.find(n=>n.props.value==='Paramshuiying').props.disabled,true);assert.equal(options.find(n=>n.props.value==='CatParamLeftHandDown').props.disabled,true)})
test('hand style changes save immediately without importing files or showing the pet',()=>{
 const h=harness(),p=props(value()),tree=h.render('ModelAdapterControls',p)
 select(row(tree,'hand-style')).props.onChange({target:{value:'labels'}})
 assert.deepEqual(p.calls,[['set','modelAdapter',{catalogGeneration:p.value.adapterCatalog.generation,handStyle:'labels'}]])
})
test('restore automatic mapping is a revision-safe preference edit',()=>{const h=harness(),p=props(value()),tree=h.render('ModelAdapterControls',p);button(tree,'adapter-reset').props.onClick();assert.deepEqual(p.calls,[['set','modelAdapter',{catalogGeneration:p.value.adapterCatalog.generation,reset:true}]])})
test('a canceled stale shared draft shows fresh catalog values and an explicit conflict notice',()=>{
 const h=harness(),p=props(value());let tree=h.render('ModelAdapterControls',p)
 select(row(tree,'bindings-keyboard')).props.onChange({target:{value:'ParamAngleX'}})
 const next={...p,state:{...p.state,adapterSave:{...p.state.adapterSave,status:'conflict',draft:{}}},value:{...p.value,adapterCatalog:{...p.value.adapterCatalog,generation:randomUUID()}}}
 tree=h.render('ModelAdapterControls',next)
 assert.equal(select(row(tree,'bindings-keyboard')).props.value,'@auto')
 assert.equal(button(tree,'adapter-retry'),undefined)
 assert.equal(collect(tree,n=>n.props.key==='adapter-status')[0].children[0],'local.adapterChanged')
 assert.equal(p.calls.length,1)
})
const candidateValue=()=>({...value(),modelCatalog:{generation:randomUUID(),items:[{id:'model-0',name:'First',entry:'first.model3.json',enabled:true},{id:'model-1',name:'Second',entry:'second.model3.json',enabled:true},{id:'model-2',name:'Broken',entry:'bad.model3.json',enabled:false,error:'Bad model'}]}})
test('multiple candidates have no default selection and require explicit confirmation',()=>{const h=harness(),p=props(candidateValue());let tree=h.render('ModelCandidateControls',p);assert.equal(button(tree,'model-confirm').props.disabled,true);assert.equal(select(tree).props.value,'');select(tree).props.onChange({target:{value:'model-1'}});tree=h.render('ModelCandidateControls',p);button(tree,'model-confirm').props.onClick();assert.deepEqual(p.calls,[['command',{type:'selectModel',catalogGeneration:p.value.modelCatalog.generation,modelId:'model-1',revision:3}]])})
test('candidate selection remains possible from failed/old rendering when the owner picker is available',()=>{const h=harness(),v=candidateValue();v.capabilities.management=false;v.capabilities.model=false;const p=props(v);let tree=h.render('ModelCandidateControls',p);assert.equal(select(tree).props.disabled,false);select(tree).props.onChange({target:{value:'model-0'}});tree=h.render('ModelCandidateControls',p);assert.equal(button(tree,'model-confirm').props.disabled,false)})
test('changed model candidate generations clear selection before effects flush',()=>{const h=harness(),p=props(candidateValue());let tree=h.render('ModelCandidateControls',p);select(tree).props.onChange({target:{value:'model-0'}});tree=h.render('ModelCandidateControls',p);assert.equal(button(tree,'model-confirm').props.disabled,false);tree=h.render('ModelCandidateControls',{...p,value:{...p.value,modelCatalog:{...p.value.modelCatalog,generation:randomUUID()}}},false);assert.equal(button(tree,'model-confirm').props.disabled,true);assert.equal(select(tree).props.value,'');h.flush()})
test('candidate cancel remains out of band during an active selection',()=>{const h=harness(),p=props(candidateValue());p.state.pending='selectModel';const tree=h.render('ModelCandidateControls',p);assert.equal(button(tree,'model-confirm').props.disabled,true);assert.equal(button(tree,'model-cancel').props.disabled,false);button(tree,'model-cancel').props.onClick();assert.deepEqual(p.calls,[['command','cancelLoad']])})
test('typed selection uses its own shared-controller pending key',async()=>{const h=harness(),c=new h.ui.OverlayUIController(),calls=[];let finish;const generation=randomUUID();c.attach({rpc:{call:async(_,endpoint,envelope)=>{calls.push(envelope.args.action);await new Promise(r=>finish=r);return{ok:true,value:{success:true,state:{revision:1,preferences:{},modelCatalog:null}}}}}});const pending=c.command({type:'selectModel',catalogGeneration:generation,modelId:'model-0',revision:0});await new Promise(r=>setImmediate(r));assert.equal(c.snapshot.pending,'selectModel');finish();await pending;assert.equal(c.snapshot.pending,'');c.detach()})
test('Chinese and English locales include all adaptation and candidate controls',()=>{const h=harness();for(const k of ['adapterTitle','refreshAdapter','adapterSave','adapterReset','adapterStale','modelChoice','modelChoose','modelStale'])for(const lang of ['zh','en'])assert.ok(h.ui.locales[lang]['local.'+k])})

test('save progress is local to adaptation and does not disable selectors during its own request',()=>{
 const h=harness(),p=props(value());select(row(h.render('ModelAdapterControls',p),'hand-style')).props.onChange({target:{value:'labels'}})
 p.state.pending='adapter';const tree=h.render('ModelAdapterControls',p),status=collect(tree,n=>n.props.key==='adapter-status')[0]
 assert.equal(status.children[0],'local.adapterSaving');assert.equal(status.props['aria-live'],'polite')
 assert.equal(select(row(tree,'bindings-keyboard')).props.disabled,false);assert.equal(button(tree,'adapter-read').props.disabled,true)
 assert.equal(button(tree,'adapter-reset').props.disabled,true)
})
test('failed shared edits remain visible and expose retry without a normal save button',()=>{
 const h=harness(),p=props(value());select(row(h.render('ModelAdapterControls',p),'hand-style')).props.onChange({target:{value:'labels'}})
 p.state.adapterSave.status='failed';p.state.adapterSave.error={message:'Disk denied'}
 let tree=h.render('ModelAdapterControls',p)
 assert.equal(select(row(tree,'hand-style')).props.value,'labels');assert.equal(button(tree,'adapter-save'),undefined)
 button(tree,'adapter-retry').props.onClick();assert.deepEqual(p.calls.at(-1),['retry'])
 const status=collect(tree,n=>n.props.key==='adapter-status')[0];assert.equal(status.props.role,'alert');assert.match(status.children[0],/Disk denied/)
 p.state.adapterSave={status:'saved',draft:{}};tree=h.render('ModelAdapterControls',p)
 assert.equal(collect(tree,n=>n.props.key==='adapter-status')[0].children[0],'local.adapterSaved');assert.equal(button(tree,'adapter-retry'),undefined)
})
test('all automatic-save messages have Chinese and English translations',()=>{
 const h=harness();for(const key of ['adapterAutoSave','adapterPending','adapterSaving','adapterSaved','adapterSaveFailed','adapterRetry'])for(const lang of ['zh','en'])assert.ok(h.ui.locales[lang]['local.'+key])
})

test('global auto selection and reverse-only edits do not capture the current model parameter ID',()=>{
 const h=harness(),p=props(value());let tree=h.render('ModelAdapterControls',p)
 assert.equal(select(row(tree,'bindings-keyboard')).props.value,'@auto')
 const reverse=collect(row(tree,'bindings-keyboard'),n=>n.type==='input')[0];assert.equal(reverse.props.disabled,false);reverse.props.onChange({target:{checked:true}})
 assert.deepEqual(p.calls[0][2].bindings.keyboard,{reverse:true})
 tree=h.render('ModelAdapterControls',p);assert.equal(select(row(tree,'bindings-keyboard')).props.value,'@auto')
})
test('global desired mapping and artwork stay selected while actual model uses fallback',()=>{
 const h=harness(),v=value();v.preferences={globalAdapter:{bindings:{keyboard:{id:'MissingKeyboard',reverse:true}},handStyle:'no-labels'}};v.adapterCatalog.handStyles=[{id:'default'}];v.adapterCatalog.fallbacks=[{kind:'bindings',role:'keyboard',requested:'MissingKeyboard',effective:'CatParamLeftHandDown',reason:'missing'},{kind:'handStyle',role:'handStyle',requested:'no-labels',effective:'default',reason:'missing'}]
 const tree=h.render('ModelAdapterControls',props(v));assert.equal(select(row(tree,'bindings-keyboard')).props.value,'MissingKeyboard');assert.equal(select(row(tree,'hand-style')).props.value,'no-labels')
 assert.equal(collect(tree,n=>String(n.props.key).startsWith('fallback-')).length,2);assert.ok(collect(row(tree,'bindings-keyboard'),n=>n.props.key==='effective')[0].children[0].includes('CatParamLeftHandDown'))
})
test('explicitly disabled global roles remain disabled even when the current model has a default',()=>{
 const h=harness(),v=value();v.preferences={globalAdapter:{bindings:{keyboard:null}}};const tree=h.render('ModelAdapterControls',props(v));assert.equal(select(row(tree,'bindings-keyboard')).props.value,'');assert.equal(collect(row(tree,'bindings-keyboard'),n=>n.type==='input')[0].props.disabled,true)
})

test('global input reset remains enabled after JSON import retires its original file path',()=>{
 const h=harness(),v=value(),calls=[];v.preferences={profilePath:null,globalAdapter:{bindings:{mouseY:{reverse:true}}}};const state={status:'ready',pending:'',value:v},manager={subscribe:()=>()=>{},getSnapshot:()=>state,command:action=>calls.push(action)}
 const tree=h.render('OverlayControls',{manager,t:k=>k}),clear=button(tree,'clearProfile');assert.equal(clear.props.disabled,false);clear.props.onClick();assert.deepEqual(calls,['clearProfile'])
})

for(const entry of ['settings','plugin-row'])test(entry+' separates direct import, parameter bindings, adapter file and motions',()=>{
 const h=harness(),v=value(),calls=[]
 v.preferences={profilePath:null,globalAdapter:{bindings:{mouseY:{reverse:true}}}}
 const state={status:'ready',pending:'',value:v},manager={subscribe:()=>()=>{},getSnapshot:()=>state,command:action=>calls.push(action)}
 const tree=h.render('OverlayControls',{manager,t:k=>k,section:'models'})
 const details=key=>collect(tree,n=>n.type==='details'&&n.props.key===key)[0]
 const advanced=details('advanced'),profile=details('adapter-file'),motions=details('motion-advanced')
 for(const group of [advanced,profile,motions])assert.notEqual(group.props.open,true)
 for(const action of ['importModelFile','importModelFolder','importProfile','clearProfile']){
  assert.equal(collect(tree,n=>n.type==='button'&&n.props.key===action).length,1)
  assert.equal(button(advanced,action),undefined);assert.equal(button(tree,action).props.disabled,false)
  button(tree,action).props.onClick()
 }
 assert.deepEqual(calls,['importModelFile','importModelFolder','importProfile','clearProfile'])
 for(const action of ['importProfile','clearProfile'])assert.ok(button(profile,action))
 for(const group of [advanced,profile,motions])for(const action of ['importModelFile','importModelFolder'])assert.equal(button(group,action),undefined)
 assert.equal(collect(advanced,n=>n.type===h.ui.ModelAdapterControls).length,1)
 assert.equal(collect(motions,n=>n.type===h.ui.MotionControls).length,1)
 assert.equal(collect(advanced,n=>n.type===h.ui.ModelCandidateControls).length,0)
 assert.equal(tree.children.findIndex(n=>n?.props.key==='library-card')<tree.children.findIndex(n=>n?.props.key==='watermark'),true)
})
test('model candidates and import recovery remain outside every advanced fold',()=>{
 const h=harness(),v=value();v.modelCatalog={generation:randomUUID(),items:[]}
 const p=props(v),manager={...p.manager,subscribe:()=>()=>{},getSnapshot:()=>({...p.state,value:v})}
 const tree=h.render('OverlayControls',{manager,t:p.t,section:'models'})
 assert.equal(collect(tree,n=>n.type===h.ui.ModelCandidateControls).length,1)
 assert.equal(collect(tree,n=>n.props.key==='importRecovery').length,1)
 for(const advanced of collect(tree,n=>n.type==='details')){
  assert.notEqual(advanced.props.open,true)
  assert.equal(collect(advanced,n=>n.props.key==='importRecovery'||n.props.key==='modelCandidates').length,0)
 }
})
