import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,readdir,unlink,rmdir,open} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {MacroStore} from '../src/macros.js'
import {normalizeAction,validateBalanced,validateBudget} from '../src/keys.js'
import {selectCapture,clientActions,normalizeRegion} from '../src/geometry.js'
import {screenTool,inputTool} from '../src/tools.js'
import {createWatchController,createImageDemand} from '../src/watch.js'
import {apply,resolveConfig,Config} from '../index.js'
import {styleFor} from '../src/keyboard-style.js'
const options=resolveConfig({},()=>{})
const info={windowId:'1:1:1',title:'fake',pid:1,processStart:'1',valid:true,focused:true,minimized:false,client:{x:-100,y:-50,width:100,height:100}}
function context(){const effects=[],timers=[],registered=[],handlers=new Map();return {effects,timers,registered,handlers,logger:{warn(){}},on(n,f){handlers.set(n,f)},effect(fn){const d=fn();effects.push(d);return d},interval(fn){timers.push(fn);return()=>{}},inject(deps,fn){fn({systemPrompt:{section(){}}})},tools:{register(t){registered.push(t);return()=>registered.splice(registered.indexOf(t),1)}},attachments:{async saveImage({data,mediaType}){return{attachmentId:'a',mediaType,bytes:data.length,width:10,height:10}}},async dispose(){for(const f of [...effects].reverse())await f?.()}}}
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'dsh-macro-'));try{await fn(new MacroStore(join(dir,'macros.json')),dir)}finally{for(const n of await readdir(dir))await unlink(join(dir,n));await rmdir(dir)}}
const actions=[{kind:'key',keys:['ctrl','s']},{kind:'wait',durationMs:10}]
test('saved templates survive new instances and use revision-protected overwrite/delete',()=>fixture(async(store,dir)=>{
 const saved=await store.save('保存', {actions});const next=new MacroStore(store.path);assert.deepEqual(await next.get('保存'),saved)
 assert.equal((await next.list()).templates.length,1)
 await assert.rejects(next.save('保存',{actions}),/conflict/);await assert.rejects(next.delete('保存','bad'),/conflict/)
 const updated=await next.save('保存',{actions:[{kind:'key',keys:['enter']}]},saved.revision);assert.notEqual(updated.revision,saved.revision)
 await next.delete('保存',updated.revision);assert.deepEqual((await store.list()).templates,[])
}))
test('template names are data keys, including path-like and prototype names',()=>fixture(async(store,dir)=>{
 for(const name of ['../outside','__proto__','constructor'])await store.save(name,{actions})
 assert.equal((await store.list()).templates.length,3);assert.equal((await store.get('__proto__')).name,'__proto__');assert.deepEqual(await readdir(dir),['macros.json'])
 await assert.rejects(store.save('bad\nname',{actions}),/name/)
}))
test('corrupt/version-invalid/oversize stores and lock conflicts are preserved',()=>fixture(async(store)=>{
 for(const text of ['broken','{"version":2,"macros":{}}',' '.repeat(1024*1024+1)]){await writeFile(store.path,text);await assert.rejects(store.list());assert.equal(await readFile(store.path,'utf8'),text)}
 await unlink(store.path);const lock=await open(store.path+'.lock','wx');try{await assert.rejects(store.list(),/busy/)}finally{await lock.close();await unlink(store.path+'.lock')}
}))
test('atomic replacement failure preserves old store and removes only owned temporary files',()=>fixture(async(store,dir)=>{
 const saved=await store.save('a',{actions});const before=await readFile(store.path,'utf8')
 const failing=new MacroStore(store.path,{replace:async()=>{throw new Error('simulated replace failure')}})
 await assert.rejects(failing.save('a',{actions:[{kind:'key',keys:['enter']}]},saved.revision),/replace failure/)
 assert.equal(await readFile(store.path,'utf8'),before);assert.deepEqual(await readdir(dir),['macros.json'])
}))
test('multiple store instances observe committed changes without lost updates',()=>fixture(async(store)=>{
 const other=new MacroStore(store.path);await store.save('a',{actions});await other.save('b',{actions});assert.equal((await store.list()).templates.length,2)
 const old=await other.get('a');await store.save('a',{actions:[{kind:'key',keys:['enter']}]},old.revision);await assert.rejects(other.save('a',{actions},old.revision),/conflict/)
}))
test('template count and structural/action safety caps reject before replacement',()=>fixture(async(store)=>{
 for(let i=0;i<100;i++)await store.save(String(i),{actions})
 await assert.rejects(store.save('overflow',{actions}),/100/);assert.equal((await store.list()).templates.length,100)
 await assert.rejects(store.save('bad',{actions:[{kind:'keydown',keys:['w']}]}),/release/)
 await assert.rejects(store.save('pos',{actions:[{kind:'click',x:1,y:1}]}),/reference/)
}))
test('wait/repeat budgets and standalone held-state validation are bounded',()=>{
 assert.equal(normalizeAction({kind:'wait',durationMs:10}).durationMs,10)
 for(const n of [-1,NaN,60001])assert.throws(()=>normalizeAction({kind:'wait',durationMs:n}))
 assert.throws(()=>validateBudget(actions,15000,21),/repeat/);assert.throws(()=>validateBudget(Array(12).fill(actions[0]),15000,11),/120/)
 assert.throws(()=>validateBudget([{kind:'wait',durationMs:1000}],15000,20),/budget/)
 validateBalanced([{kind:'keydown',keys:['w']},{kind:'wait',durationMs:10},{kind:'keyup',keys:['w']}])
 assert.throws(()=>validateBalanced([{kind:'up',button:'left'}]),/did not press/)
 assert.throws(()=>validateBalanced([{kind:'keydown',keys:['w']},{kind:'wait',durationMs:3000},{kind:'keyup',keys:['w']}]),/maxHold/)
})
test('capture defaults/legacy monitor, region validation and negative-origin client conversion',()=>{
 assert.equal(selectCapture({},options,true).target,'window');assert.equal(selectCapture({},options,false).target,'primary')
 assert.equal(selectCapture({monitor:'virtual'},options,true).target,'virtual');assert.throws(()=>selectCapture({target:'window',monitor:'primary'},options,true),/not both/)
 assert.throws(()=>normalizeRegion({x:-1,y:0,width:10,height:10}));assert.throws(()=>normalizeRegion({x:0,y:0,width:0,height:1}))
 assert.deepEqual(clientActions([{kind:'click',x:10,y:20}],info,'client')[0],{kind:'click',x:-90,y:-30})
 assert.throws(()=>clientActions([{kind:'click',x:100,y:0}],info,'client'),/outside/)
})
test('ordinary first screenshot attachment failure retries a fresh image without watcher demand',async()=>{
 const demand=createImageDemand();let calls=0,attach=0;const tool=screenTool({options,imageDemand:demand,capture:async()=>({width:10,height:10,screenWidth:20,screenHeight:20,screenX:0,screenY:0,scale:.5,diff:calls++?0:-1}),attach:async()=>{if(!attach++)throw Error('store failed');return{attachmentId:'ok'}}})
 await assert.rejects(tool.execute({}, {agent:{id:'a'}}),/store failed/)
 assert.equal((await tool.execute({}, {agent:{id:'a'}})).attached,true);assert.equal(demand.current('a'),undefined)
})
test('disabled watcher never inherits capture errors or schedules agent work',async()=>{
 const ctx=context(),a={id:'a',ctx:context(),followup(){throw Error('no wake')}},b={id:'b',ctx:context(),followup(){throw Error('no wake')}};let captures=0
 const watch=createWatchController({ctx,options,capture:async()=>{captures++;throw Error('must not capture')},warn(){},imageDemand:createImageDemand()})
 watch.start(a,{intervalMs:500,threshold:.1,maxWakes:1});assert.deepEqual(watch.status(a),watch.status(b));assert.equal(watch.status(a).running,false);assert.equal(watch.status(a).wakes,0);assert.match(watch.status(a).lastError,/permanently disabled/)
 assert.equal(captures,0);assert.equal(a.ctx.timers.length,0);assert.equal(ctx.timers.length,0);await ctx.dispose();await a.ctx.dispose()
})
test('five host tools require binding, convert clients, default to window crop and stop on unbind',async()=>{
 const ctx=context(),agentCtx=context(),agent={id:'a',ctx:agentCtx,followup(){}},calls=[];let released=0,closed=0
 const bridge={running:true,async request(req){calls.push(req);if(req.op==='window')return{window:structuredClone(info)};if(req.op==='frame')return{width:10,height:10,screenWidth:20,screenHeight:20,screenX:-100,screenY:-50,scale:.5,diff:1,data:Buffer.from('fake').toString('base64')};return{heldKeys:[],heldButtons:[]}},async releaseAll(){released++;return true},async disposeOwner(){return true},async close(){closed++}}
 apply(ctx,{overlayEnabled:false},{bridgeFactory:()=>bridge});const tool=n=>ctx.registered.find(t=>t.name===n);assert.equal(ctx.registered.length,5)
 await assert.rejects(tool('game_input').execute({kind:'key',keys:['w']},{agent}),/bound/)
 await tool('game_window').execute({action:'bind',windowId:info.windowId},{agent})
 await tool('game_input').execute({kind:'click',x:10,y:20,coordinateSpace:'client'},{agent});assert.equal(calls.find(r=>r.op==='input').actions[0].x,-90)
 await tool('game_screen').execute({region:{x:0,y:0,width:20,height:20}},{agent});assert.equal(calls.find(r=>r.op==='frame').target,'window')
 await tool('game_watch').execute({action:'start'},{agent});await tool('game_window').execute({action:'unbind'},{agent});assert.equal((await tool('game_watch').execute({action:'status'},{agent})).running,false);assert.equal(released,2)
 await agentCtx.dispose();await ctx.dispose();assert.equal(ctx.registered.length,0);assert.equal(closed,1)
})
test('macro approval deny never touches store; valid revisions use only the mocked input transport',async()=>{
 const ctx=context();let reads=0,sends=0;const store={async get(){reads++;return{actions,revision:'good'}}}
 apply(ctx,{overlayEnabled:false}, {bridgeFactory:()=>({close:async()=>{}}),macroStoreFactory:()=>store})
 const gate=ctx.handlers.get('tools/pre-execute');assert.equal((await gate({name:'game_macro'},async()=>({kind:'deny'}))).kind,'deny');assert.equal(reads,0)
 assert.equal((await gate({name:'game_macro'},async()=>({kind:'allow'}))).kind,'ask')
 const tool=inputTool({options,normalize:normalizeAction,macros:store,send:async()=>{sends++;return{}}})
 await assert.rejects(tool.execute({macro:'a',revision:'bad'},{}),/revision mismatch/);assert.equal(sends,0)
 const result=await tool.execute({macro:'a',revision:'good',repeat:2},{})
 assert.equal(result.ok,true);assert.equal(Object.hasOwn(result,'dryRun'),false);assert.equal(sends,1);await ctx.dispose()
})
test('macro real-input size mismatch and failed binding release are fail closed',async()=>{
 const ctx=context(),ac=context(),agent={id:'a',ctx:ac},calls=[];let release=true
 const bridge={running:true,request:async req=>{calls.push(req);return{window:structuredClone(info)}},releaseAll:async()=>release,disposeOwner:async()=>true,close:async()=>{}}
 apply(ctx,{overlayEnabled:false},{bridgeFactory:()=>bridge,macroStoreFactory:()=>({get:async()=>({actions:[{kind:'click',x:1,y:1}],referenceSize:{width:200,height:100},revision:'good'})})});const t=n=>ctx.registered.find(t=>t.name===n)
 await t('game_window').execute({action:'bind',windowId:info.windowId},{agent});await assert.rejects(t('game_input').execute({macro:'a',revision:'good'},{agent}),/size mismatch/);assert.equal(calls.filter(r=>r.op==='input').length,0)
 release=false;await assert.rejects(t('game_window').execute({action:'unbind'},{agent}),/unconfirmed/);await ac.dispose();await ctx.dispose()
})
test('binding changes abort in-flight and pending input leases, with no later injection',async()=>{
 const ctx=context(),ac=context(),agent={id:'a',ctx:ac},pending=[],signals=[]
 const bridge={running:true,async request(req,signal){if(req.op==='window')return{window:structuredClone(info)};if(req.op==='input'){signals.push(signal);return new Promise((resolve,reject)=>{const abort=()=>reject(Error('binding aborted'));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});pending.push(resolve)})}},releaseAll:async()=>true,disposeOwner:async()=>true,close:async()=>{}}
 apply(ctx,{overlayEnabled:false},{bridgeFactory:()=>bridge});const t=n=>ctx.registered.find(t=>t.name===n)
 await t('game_window').execute({action:'bind',windowId:info.windowId},{agent})
 const p=t('game_input').execute({kind:'key',keys:['w']},{agent}).then(()=>{throw Error('unexpected success')},e=>e)
 while(!signals.length)await new Promise(r=>setImmediate(r))
 await t('game_window').execute({action:'unbind'},{agent});assert.match((await p).message,/aborted/);assert.equal(signals[0].aborted,true)
 await assert.rejects(t('game_input').execute({kind:'key',keys:['s']},{agent}),/bound/);assert.equal(signals.length,1);await ac.dispose();await ctx.dispose()
})
test('disabled window watcher leaves fresh-image demand intact and never resolves a window',async()=>{
 const ctx=context(),ac=context(),agent={id:'a',ctx:ac,followup(){throw Error('no wake')}},demand=createImageDemand();let captures=0
 const watch=createWatchController({ctx,options,imageDemand:demand,warn(){},capture:async()=>{captures++;throw Error('no capture')}})
 demand.mark('a');const token=demand.current('a');watch.start(agent,{intervalMs:500,threshold:.1,maxWakes:2,target:'window',windowId:'1:1:1',region:{x:0,y:0,width:10,height:10}})
 assert.equal(watch.status(agent).running,false);assert.match(watch.status(agent).lastError,/permanently disabled/);assert.equal(demand.current('a'),token);assert.equal(captures,0);assert.equal(ac.timers.length,0);await ac.dispose();await ctx.dispose()
})
test('configuration schema declares every field, exposes thirteen live settings, and validates ranges',()=>{
 const defaults=Config({})
 const live=Object.entries(Config.dict).filter(([,field])=>field.meta.volatile===true).map(([key])=>key)
 assert.deepEqual(live,['requireApproval','overlayEnabled','overlayView','keyboardTheme','keyboardAccent','keyboardLayout','keyboardSkin','maxWidth','jpegQuality','monitor','maxHoldMs','helperTimeoutMs','persona'])
 assert.equal(defaults.requireApproval.get(),true);assert.equal(Object.hasOwn(defaults,'dryRun'),false)
 assert.equal(defaults.overlayEnabled.get(),true)
 assert.equal(defaults.overlayView.get(),'auto');assert.equal(defaults.keyboardTheme.get(),'dark')
 assert.equal(defaults.keyboardAccent.get(),'teal');assert.equal(defaults.keyboardLayout.get(),'full');assert.equal(defaults.keyboardSkin.get(),'builtin')
 assert.equal(defaults.maxWidth.get(),1280);assert.equal(defaults.jpegQuality.get(),60);assert.equal(defaults.monitor.get(),'primary')
 assert.equal(defaults.maxHoldMs.get(),3000);assert.equal(defaults.helperTimeoutMs.get(),15000)
 for(const key of ['watchIntervalMs','watchThreshold','watchMaxWakes'])assert.equal(Object.hasOwn(defaults,key),false)
 assert.ok(defaults.macroStoragePath.endsWith('macros.json'));assert.equal(defaults.powershellPath,undefined)
 assert.throws(()=>Config({maxWidth:300}),/320/)
 assert.throws(()=>Config({monitor:'other'}))
 assert.throws(()=>Config({keyboardTheme:'neon'}));assert.throws(()=>Config({keyboardLayout:'mini'}))
 assert.equal(resolveConfig(Config({overlayEnabled:false}),()=>{}).overlayEnabled,false)
 assert.equal(resolveConfig({},()=>{}).overlayEnabled,true)
 // A hand-written profile value that is not one of the offered choices falls
 // back to the default with one warning instead of failing the whole load.
 const invalid=[],appearance=resolveConfig({overlayView:'both',keyboardAccent:7,keyboardLayout:'mini'},m=>invalid.push(m))
 assert.equal(appearance.overlayView,'auto');assert.equal(appearance.keyboardAccent,'teal');assert.equal(appearance.keyboardLayout,'full')
 assert.equal(invalid.length,3)
})
test('the appearance tables, key-count presets and style payload stay consistent',async()=>{
 const themes=JSON.parse(await readFile(new URL('../src/keyboard-themes.json',import.meta.url)))
 const layout=JSON.parse(await readFile(new URL('../src/overlay-layout.json',import.meta.url)))
 const hex=/^#[0-9a-fA-F]{6}$/
 for(const [id,row] of Object.entries(themes.themes))for(const name of ['background','text','muted','keyFill','keyEdge'])assert.match(row[name],hex,id+'.'+name)
 for(const [accent,row] of Object.entries(themes.accents))for(const theme of Object.keys(themes.themes))assert.match(row[theme],hex,accent+'/'+theme)
 for(const theme of Object.keys(themes.themes)){
   assert.match(themes.simulation[theme],hex)
   // Simulation must never be mistakable for real input.
   assert.notEqual(themes.simulation[theme],themes.accents.teal[theme])
   assert.notEqual(themes.simulation[theme],themes.accents.sky[theme])
 }
 const ids=new Set(layout.keys.map(k=>k.id))
 assert.deepEqual(Object.keys(layout.layouts),['full','tkl','compact'])
 assert.deepEqual(layout.layouts.full.hide,[])
 for(const [name,preset] of Object.entries(layout.layouts))for(const id of preset.hide)assert.ok(ids.has(id),name+' hides an unknown key: '+id)
 const tkl=new Set(layout.layouts.tkl.hide),compact=new Set(layout.layouts.compact.hide)
 for(const id of ['num7','numenter','decimal','add','subtract'])assert.ok(tkl.has(id))
 for(const id of tkl)assert.ok(compact.has(id),'compact must also hide '+id)
 for(const id of ['f1','esc','insert','pagedown'])assert.ok(compact.has(id))
 for(const id of ['q','a','space','up','left','lctrl','rshift'])assert.ok(!compact.has(id))
 assert.equal(layout.keys.length-tkl.size,87);assert.equal(layout.keys.length-compact.size,65)
 const style=styleFor({theme:'light',accent:'sky',layout:'compact',skin:'custom'})
 assert.deepEqual(style.colors,{background:'#F2F5FA',text:'#1B2430',muted:'#5B6B80',keyFill:'#FFFFFF',keyEdge:'#C8D2E0',accent:'#0B62C4',accentSim:'#B45F00'})
 const dark=styleFor({})
 assert.deepEqual(dark,{theme:'dark',accent:'teal',layout:'full',skin:'builtin',colors:{background:'#111722',text:'#E6EDF6',muted:'#8795A9',keyFill:'#1F2937',keyEdge:'#39475A',accent:'#49DFBE',accentSim:'#FFB753'}})
 assert.equal(styleFor({theme:'nope',accent:'nope',layout:'nope',skin:'nope'}).theme,'dark')
})
test('appearance settings repaint the live panel without a remount',async()=>{
 const calls=[],state={overlayView:'auto',keyboardTheme:'dark',keyboardLayout:'full',overlayEnabled:true}
 const ref=(key)=>({get:()=>state[key],[Symbol.for('cosmokit.volatile.write')](){}})
 const overlay={observe(){},beginReal(){},simulate(){},capture:async fn=>fn(),close:async()=>{},
   syncEnabled:async()=>calls.push('enabled'),syncStyle:async()=>calls.push('style'),syncView:async()=>calls.push('view')}
 const ctx=context()
 apply(ctx,{overlayEnabled:ref('overlayEnabled'),overlayView:ref('overlayView'),keyboardTheme:ref('keyboardTheme'),keyboardLayout:ref('keyboardLayout')},
   {overlayFactory:()=>overlay,bridgeFactory:()=>({close:async()=>{},request:async()=>({})}),macroStoreFactory:()=>({})})
 const update=ctx.handlers.get('loader/volatile-update')
 state.keyboardTheme='light';update([['keyboardTheme']])
 state.keyboardLayout='tkl';update([['keyboardLayout']])
 await new Promise(r=>setImmediate(r))
 assert.deepEqual(calls,['style','style'])
 state.overlayView='keyboard';update([['overlayView']])
 await new Promise(r=>setImmediate(r))
 assert.deepEqual(calls,['style','style','view'])
 state.overlayEnabled=false;update([['overlayEnabled']])
 await new Promise(r=>setImmediate(r))
 assert.deepEqual(calls,['style','style','view','enabled'])
 // Fields with no repaint work stay silent.
 update([['maxWidth']]);update([['watchThreshold']])
 await new Promise(r=>setImmediate(r))
 assert.deepEqual(calls,['style','style','view','enabled'])
 await ctx.dispose()
})
test('volatile config references stay live while plain configuration keeps its validated snapshot',()=>{
 let current=false
 const ref={get:()=>current,[Symbol.for('cosmokit.volatile.write')](){}}
 const options=resolveConfig({overlayEnabled:ref,maxWidth:640},message=>{throw Error('unexpected warning: '+message)})
 assert.equal(options.overlayEnabled,false)
 current=true
 assert.equal(options.overlayEnabled,true)
 assert.equal(options.maxWidth,640);assert.equal(options.requireApproval,true)
 const warnings=[],fallback=resolveConfig({maxWidth:'wide'},message=>warnings.push(message))
 assert.equal(fallback.maxWidth,1280);assert.equal(warnings.length,1)
})
test('the approval switch is a live reference: one registered gate follows it without remounting',async()=>{
 const ctx=context(),state={value:true},ref={get:()=>state.value,[Symbol.for('cosmokit.volatile.write')](){}}
 apply(ctx,{requireApproval:ref,overlayEnabled:false},{bridgeFactory:()=>({close:async()=>{}}),macroStoreFactory:()=>({})})
 const gate=ctx.handlers.get('tools/pre-execute');assert.equal(typeof gate,'function')
 assert.equal((await gate({name:'game_input'},async()=>({kind:'allow'}))).kind,'ask')
 assert.equal((await gate({name:'game_macro'},async()=>({kind:'allow'}))).kind,'ask')
 state.value=false
 assert.deepEqual(await gate({name:'game_input'},async()=>({kind:'allow'})),{kind:'allow'})
 assert.deepEqual(await gate({name:'game_screen'},async()=>({kind:'allow'})),{kind:'allow'})
 assert.deepEqual(await gate({name:'game_macro'},async()=>({kind:'deny',reason:'x'})),{kind:'deny',reason:'x'})
 state.value=true
 assert.equal((await gate({name:'game_input'},async()=>({kind:'deny',reason:'y'}))).kind,'deny')
 await ctx.dispose()
})
test('disabled approval warns once per change and re-arms after recovery without a simulation flag',async()=>{
 const state={requireApproval:false},warnings=[]
 const ref=(key)=>({get:()=>state[key],[Symbol.for('cosmokit.volatile.write')](){}})
 const ctx={...context(),logger:{warn(message){warnings.push(message)}}}
 apply(ctx,{requireApproval:ref('requireApproval'),overlayEnabled:false},{bridgeFactory:()=>({close:async()=>{}}),macroStoreFactory:()=>({})})
 assert.equal(warnings.filter(m=>m.includes('config.requireApproval is off')).length,1)
 const update=ctx.handlers.get('loader/volatile-update')
 update([['requireApproval']])
 assert.equal(warnings.filter(m=>m.includes('config.requireApproval is off')).length,1)
 state.requireApproval=true
 update([['requireApproval']])
 state.requireApproval=false
 update([['requireApproval']])
 assert.equal(warnings.filter(m=>m.includes('config.requireApproval is off')).length,2)
 update([['maxWidth']])
 assert.equal(warnings.filter(m=>m.includes('config.requireApproval is off')).length,2)
 await ctx.dispose()
})

test('retired dryRun values and live references are ignored without changing approval',()=>{
 let reads=0;const warnings=[]
 const legacyRef={get(){reads++;return true},[Symbol.for('cosmokit.volatile.write')](){}}
 for(const value of [true,false,'true',legacyRef]){
  const config=resolveConfig({dryRun:value},message=>warnings.push(message))
  assert.equal(Object.hasOwn(config,'dryRun'),false);assert.equal(config.requireApproval,true)
 }
 assert.equal(Object.hasOwn(Config.dict,'dryRun'),false);assert.equal(reads,0);assert.deepEqual(warnings,[])
 assert.equal(resolveConfig({requireApproval:false,dryRun:true},()=>{}).requireApproval,false)
})
