import {test} from 'node:test'
import assert from 'node:assert/strict'
let definition;globalThis.window={__ModuleLoader__:{load:value=>{definition=value}}}
await import('../client.js');const module=definition.factory(id=>{if(id==='react')return {createElement(){}};throw Error('Unexpected dependency')})
const Controller=module.OverlayUIController
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function setup(){
 let id=0,visible='visible';const jobs=new Map(),events=new Map(),calls=[]
 const doc={get visibilityState(){return visible},addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)}
 const controller=new Controller({document:doc,setTimer:(fn,ms)=>{jobs.set(++id,{fn,ms});return id},clearTimer:id=>jobs.delete(id)})
 const connection={rpc:{call:async(_base,endpoint,envelope,signal)=>{calls.push({endpoint,envelope,signal});return {ok:true,value:{revision:0,preferences:{widthDip:420},stateRevision:1,stateGeneration:'one'}}}}}
 return {controller,connection,jobs,calls,events,hide(){visible='hidden';events.get('visibilitychange')?.()},show(){visible='visible';events.get('visibilitychange')?.()}}
}
test('both page mounts share one polling request and unsubscribe/hidden removes polling',async()=>{
 const h=setup();h.controller.attach(h.connection);assert.equal(h.calls.length,0)
 const a=h.controller.subscribe(()=>{}),b=h.controller.subscribe(()=>{});await tick();assert.equal(h.calls.length,1);assert.equal(h.jobs.size,1)
 h.hide();assert.equal(h.jobs.size,0);h.show();await tick();assert.equal(h.calls.length,2)
 a();assert.equal(h.jobs.size,1);b();assert.equal(h.jobs.size,0);assert.equal(h.events.size,0);h.controller.detach()
})
test('stale polling never overwrites a newer mutation and missing endpoints degrade only desktop controls',async()=>{
 const h=setup();h.controller.attach(h.connection);const generation=h.controller.generation
 assert.equal(h.controller.accept({revision:2,preferences:{widthDip:600},stateRevision:3,stateGeneration:'one'},3,generation),true)
 assert.equal(h.controller.accept({revision:1,preferences:{widthDip:500},stateRevision:2,stateGeneration:'one'},4,generation),false)
 assert.equal(h.controller.snapshot.value.preferences.widthDip,600)
 h.controller.sequence=4
 h.connection.rpc.call=async()=>({ok:false,error:{message:'Desktop endpoint missing'}})
 const unsubscribe=h.controller.subscribe(()=>{});await tick();assert.equal(h.controller.snapshot.status,'unavailable');assert.match(h.controller.snapshot.failure,/missing/)
 unsubscribe();h.controller.detach()
})
test('save conflicts refresh state and show an error without replaying a stale preference',async()=>{
 const h=setup();h.controller.attach(h.connection)
 h.controller.accept({revision:1,preferences:{widthDip:420}},1,h.controller.generation)
 h.connection.rpc.call=async(_base,endpoint,envelope)=>{h.calls.push({endpoint,envelope});return {ok:true,value:{success:false,error:{code:'preference_conflict',message:'changed'},state:{revision:2,preferences:{widthDip:550}}}}}
 await h.controller.set('widthDip',500);assert.equal(h.calls.length,1);assert.equal(h.calls[0].envelope.args.revision,1)
 assert.equal(h.controller.snapshot.value.preferences.widthDip,550);assert.equal(h.controller.snapshot.failure.code,'preference_conflict');h.controller.detach()
})
test('rapid sliders coalesce to a bounded queue and preserve the final value',async()=>{
 const h=setup();h.controller.attach(h.connection);h.controller.accept({revision:0,preferences:{widthDip:420}},1,h.controller.generation)
 let release;const gate=new Promise(resolve=>{release=resolve});let revision=0
 h.connection.rpc.call=async(_base,endpoint,envelope)=>{h.calls.push({endpoint,envelope});if(h.calls.length===1)await gate;revision++;return{ok:true,value:{success:true,state:{revision,preferences:envelope.args.patch}}}}
 const first=h.controller.set('widthDip',500);await tick();for(let n=501;n<1000;n++)void h.controller.set('widthDip',n)
 release();await first;assert.equal(h.calls.length,2);assert.equal(h.calls.at(-1).envelope.args.patch.widthDip,999);assert.equal(h.controller.snapshot.value.preferences.widthDip,999)
 h.controller.detach()
})
test('cancel actions run out-of-band while a native dialog command is pending',async()=>{
 const h=setup();h.controller.attach(h.connection);let finish
 h.connection.rpc.call=async(_base,endpoint,envelope)=>{h.calls.push({endpoint,envelope});if(envelope.args.action==='importModelFile')await new Promise(resolve=>{finish=resolve});return {ok:true,value:{success:true,state:{revision:0,preferences:{}}}}}
 const pending=h.controller.command('importModelFile');await tick();await h.controller.command('cancelLoad');assert.equal(h.calls.length,2)
 finish();await pending;h.controller.detach()
})

function rangeRenderer(){
 const states=[],refs=[],dependencies=[];let sc=0,rc=0,ec=0
 const React={createElement:(type,props,children)=>({type,props,children}),useId:()=> 'range-test',
  useState(initial){const id=sc++;if(!(id in states))states[id]=initial;return[states[id],value=>{states[id]=value}]},
  useRef(initial){const id=rc++;return refs[id]??=( {current:initial} )},
  useEffect(fn,deps){const id=ec++,old=dependencies[id];if(!old||deps.some((v,i)=>v!==old[i])){dependencies[id]=deps;fn()}},
 }
 const ui=definition.factory(id=>{assert.equal(id,'react');return React})
 return{states,render(props){sc=rc=ec=0;return ui.LocalRange(props)}}
}
function numberInput(node){if(node?.props?.type==='number')return node;for(const child of node?.children??[]){const found=numberInput(child);if(found)return found}}
function rangeInput(node){if(node?.props?.type==='range')return node;for(const child of node?.children??[]){const found=rangeInput(child);if(found)return found}}
test('Escape restores a local edit without saving or bubbling into the settings-dialog shortcut',()=>{
 const r=rangeRenderer();let calls=0,prevented=0,stopped=0
 const tree=r.render({manager:{set:()=>calls++},spec:{key:'widthDip',min:220,max:1000},value:420,disabled:false,t:key=>key,resetToken:null}),input=numberInput(tree)
 input.props.onChange({target:{value:'200'}})
 input.props.onKeyDown({key:'Escape',preventDefault:()=>prevented++,stopPropagation:()=>stopped++,nativeEvent:{stopImmediatePropagation:()=>stopped++},currentTarget:{blur:()=>input.props.onBlur()}})
 assert.equal(calls,0);assert.equal(r.states[0],'420');assert.equal(prevented,1);assert.equal(stopped,2)
 rangeInput(tree).props.onKeyUp({key:'Tab',currentTarget:{value:'420'}});assert.equal(calls,0)
})
test('a rejected backend save restores the committed local range value even when its numeric prop did not change',()=>{
 const r=rangeRenderer(),props={manager:{set:()=>{}},spec:{key:'widthDip',min:220,max:1000},value:420,disabled:false,t:key=>key,resetToken:null}
 const input=numberInput(r.render(props));input.props.onChange({target:{value:'580'}});assert.equal(r.states[0],'580')
 r.render({...props,resetToken:'disk full'});assert.equal(r.states[0],'420')
})

function controls(state){
 const React={createElement:(type,props,children)=>({type,props,children}),useSyncExternalStore:(_subscribe,snapshot)=>snapshot()}
 const ui=definition.factory(id=>{assert.equal(id,'react');return React}),commands=[]
 const manager={subscribe:()=>()=>{},getSnapshot:()=>state,command:action=>commands.push(action)}
 return {tree:ui.OverlayControls({manager,t:key=>key}),commands,ui}
}
function findControl(node,key){if(Array.isArray(node)){for(const item of node){const found=findControl(item,key);if(found)return found}}else if(node){if(node.type==='button'&&node.props.key===key)return node;return findControl(node.children,key)}}
test('both shared settings entries remove legacy model import buttons',()=>{
 const state={status:'ready',pending:'',value:{enabled:true,phase:'fallback',loading:false,preferences:{},capabilities:{management:false,model:false,picker:true}}}
 for(const entry of ['settings','plugin-row']){
  const c=controls(state);for(const action of ['importModelFile','importModelFolder'])assert.equal(findControl(c.tree,action),undefined,entry+' '+action)
  assert.deepEqual(c.commands,[]);assert.equal(findControl(c.tree,'show').props.disabled,true)
 }
})
test('model import disables only for missing Remote, disabled overlay, missing picker or active operation',()=>{
 const base={status:'ready',pending:'',value:{enabled:true,loading:false,preferences:{},capabilities:{management:false,model:false,picker:true}}}
 const cases=[{state:{...base,status:'unavailable'},reason:'local.unavailable'},{state:{...base,value:{...base.value,enabled:false}},reason:'local.disabled'},{state:{...base,value:{...base.value,capabilities:{picker:false}}},reason:'local.pickerUnavailable'},{state:{...base,pending:'show'},reason:'local.importBusy'},{state:{...base,value:{...base.value,loading:true}},reason:'local.importBusy'}]
 for(const {state,reason}of cases){const c=controls(state);assert.equal(c.ui.modelImportUnavailable(state),reason);for(const action of ['importModelFile','importModelFolder'])assert.equal(findControl(c.tree,action),undefined)}
})
