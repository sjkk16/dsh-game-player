import assert from 'node:assert/strict'
import { createSettingsHarness, collect, byKey, text } from './settings-fixture.mjs'
let checks=0
const run=async(name,test)=>{const h=createSettingsHarness();try{await test(h);checks++}catch(error){throw Error('Settings regression: '+name,{cause:error})}finally{h.close()}}
const tabs=tree=>collect(tree,n=>n.props?.role==='tab')
const panels=tree=>collect(tree,n=>n.props?.role==='tabpanel')
const tab=(tree,key)=>tabs(tree).find(n=>n.props.key===key)
const choose=(h,key)=>{tab(h.render(),key).props.onClick();return h.render()}
const press=key=>({key,preventDefault(){},stopPropagation(){}})
const button=(tree,key)=>collect(tree,n=>n.type==='button'&&n.props.key===key)[0]
const component=(h,name)=>[...h.instances.values()].find(i=>i.type.name===name)

await run('four tabs, one default panel and all editors mounted',h=>{
 const tree=h.render();assert.deepEqual(tabs(tree).map(n=>n.props.key),['common','models','appearance','safety'])
 assert.deepEqual(panels(tree).filter(n=>!n.props.hidden).map(n=>n.props.key),['common'])
 const fields=[...h.instances.values()].filter(i=>i.type.name==='FieldRow').map(i=>i.props.spec.key)
 assert.deepEqual(fields.sort(),h.ui.GROUPS.flatMap(g=>g.fields.map(f=>f.key)).sort());assert.equal(new Set(fields).size,12)
 assert.equal(collect(tree,n=>n.type==='select'&&n.props['aria-labelledby']&&n.children.some(c=>c?.props?.value==='auto')).length,1)
 assert.equal(h.calls.length,0)
})
await run('tab clicks preserve every component and issue no commands',h=>{
 h.render();const initial=[...h.instances.entries()]
 for(const key of h.ui.SETTINGS_TABS){const tree=choose(h,key);assert.equal(panels(tree).filter(n=>!n.props.hidden)[0].props.key,key)}
 assert.equal(h.instances.size,initial.length);for(const [key,instance]of initial)assert.equal(h.instances.get(key),instance)
 assert.equal(h.calls.length,0)
})
await run('shortcut only navigates to models',h=>{button(h.render(),'manage-models').props.onClick();assert.equal(panels(h.render()).find(n=>!n.props.hidden).props.key,'models');assert.equal(h.calls.length,0)})
await run('arrows wrap focus without activation; Enter and Space activate',h=>{
 let tree=h.render(),focused=[];for(const n of tabs(tree))n.props.ref({focus:()=>focused.push(n.props.key)})
 tab(tree,'common').props.onKeyDown(press('ArrowLeft'));assert.equal(focused.at(-1),'safety');assert.equal(panels(h.render()).find(n=>!n.props.hidden).props.key,'common')
 tab(h.render(),'safety').props.onKeyDown(press('Enter'));assert.equal(panels(h.render()).find(n=>!n.props.hidden).props.key,'safety')
 tab(h.render(),'safety').props.onKeyDown(press('ArrowRight'));assert.equal(focused.at(-1),'common')
 tab(h.render(),'common').props.onKeyDown(press(' '));assert.equal(panels(h.render()).find(n=>!n.props.hidden).props.key,'common')
 assert.equal(h.calls.length,0)
})
await run('Home End and vertical arrows move focus',h=>{
 const tree=h.render(),focused=[];for(const n of tabs(tree))n.props.ref({focus:()=>focused.push(n.props.key)})
 for(const [key,expected]of [['End','safety'],['Home','common'],['ArrowDown','models'],['ArrowUp','safety']]){tab(h.render(),'common').props.onKeyDown(press(key));assert.equal(focused.at(-1),expected)}
 assert.equal(h.calls.length,0)
})
await run('two mounts have unique IDs and independently selected tabs',h=>{
 const a=h.render(),b=h.render('GamePlayerSettings',h.props,'second')
 const ids=[...collect(a,n=>n.props.id),...collect(b,n=>n.props.id)].map(n=>n.props.id);assert.equal(new Set(ids).size,ids.length)
 for(const tree of [a,b])for(const n of tabs(tree))assert.ok(panels(tree).some(p=>p.props.id===n.props['aria-controls']&&p.props['aria-labelledby']===n.props.id))
 tab(a,'models').props.onClick();assert.equal(panels(h.render('GamePlayerSettings',h.props,'second')).find(n=>!n.props.hidden).props.key,'common')
 h.config.value.requireApproval=false;h.state.value.modelName='Shared change'
 for(const tree of [h.render(),h.render('GamePlayerSettings',h.props,'second')]){assert.ok(byKey(tree,'danger'));assert.ok(text(tree).includes('Shared change'))}
})
await run('approval warning stays outside every panel',h=>{h.config.value.requireApproval=false;for(const key of h.ui.SETTINGS_TABS){const tree=choose(h,key);assert.ok(byKey(tree,'danger'));for(const panel of panels(tree))assert.equal(byKey(panel,'danger'),undefined)}})
for(const [name,patch,action]of [['loading',{loading:true},'cancelLoad'],['pending selection',{},'cancelLoad'],['preview',{previewing:true},'stopPreview'],['motion',{motion:{name:'sample',phase:'playing'}},'stopMotion'],['position',{adjusting:true},'endAdjust']])await run(name+' exposes a common interrupt on all tabs',h=>{
 Object.assign(h.state.value,patch);if(name==='pending selection')h.state.pending='selectLibraryModel'
 for(const key of h.ui.SETTINGS_TABS){const tree=choose(h,key),runtime=byKey(tree,'runtime'),control=button(runtime,action);assert.ok(control);assert.equal(control.props.disabled,false);for(const p of panels(tree))assert.equal(byKey(p,'runtime'),undefined)}
 button(byKey(h.render(),'runtime'),action).props.onClick();assert.deepEqual(h.calls,[['command',action]])
})
await run('numeric draft survives navigation and normal blur still commits',h=>{
 choose(h,'safety');let instance=[...h.instances.values()].find(i=>i.type.name==='NumberControl'&&i.props.spec.key==='maxWidth')
 let input=collect(h.render(),n=>n.type==='input'&&n.props['aria-labelledby']===instance.props.labelId)[0]
 input.props.onFocus();input.props.onChange({target:{value:'1500'}});input=collect(h.render(),n=>n.type==='input'&&n.props['aria-labelledby']===instance.props.labelId)[0]
 input.props.onBlur({relatedTarget:{closest:()=>true}});choose(h,'common');choose(h,'safety')
 input=collect(h.render(),n=>n.type==='input'&&n.props['aria-labelledby']===instance.props.labelId)[0];assert.equal(input.props.value,'1500');assert.equal(h.calls.length,0)
 input.props.onBlur({relatedTarget:null});assert.deepEqual(h.calls,[['config','maxWidth',1500]])
})
await run('local range draft survives navigation without a preference write',h=>{
 h.render();const range=[...h.instances.values()].find(i=>i.type.name==='LocalRange'&&i.props.spec.key==='widthDip')
 let input=collect(range.raw,n=>n.props.type==='number')[0];input.props.onFocus();input.props.onChange({target:{value:'555'}});h.render()
 input=collect(range.raw,n=>n.props.type==='number')[0];input.props.onBlur({relatedTarget:{closest:()=>true}});choose(h,'models');choose(h,'common')
 assert.equal(collect(range.raw,n=>n.props.type==='number')[0].props.value,'555');assert.equal(h.calls.length,0)
})
await run('invalid numbers remain local and do not save',h=>{
 choose(h,'safety');const instance=[...h.instances.values()].find(i=>i.type.name==='NumberControl'&&i.props.spec.key==='maxWidth')
 let input=collect(instance.raw,n=>n.type==='input')[0];input.props.onChange({target:{value:'9'}});h.render();input=collect(instance.raw,n=>n.type==='input')[0];input.props.onBlur({});assert.equal(h.calls.length,0);assert.ok(text(h.render()).includes(h.ui.locales.zh.outOfRange))
})
await run('model candidate selections survive hidden panels',h=>{
 h.state.value.modelCatalog={generation:'fixture-candidate',items:[{id:'one',name:'One',enabled:true},{id:'two',name:'Two',enabled:true}]};choose(h,'models')
 const candidate=component(h,'ModelCandidateControls'),select=collect(candidate.raw,n=>n.type==='select')[0];select.props.onChange({target:{value:'two'}})
 choose(h,'common');choose(h,'models');assert.equal(collect(candidate.raw,n=>n.type==='select')[0].props.value,'two');assert.equal(h.calls.length,0)
})
await run('library candidate checkbox draft survives hidden panels',h=>{
 h.state.value.libraryCatalog={generation:'fixture-library',items:[{id:'one',name:'One',enabled:true}]};choose(h,'models');const c=component(h,'LibraryCandidateControls')
 collect(c.raw,n=>n.type==='input')[0].props.onChange({target:{checked:false}});choose(h,'common');choose(h,'models');assert.equal(collect(c.raw,n=>n.type==='input')[0].props.checked,false);assert.equal(h.calls.length,0)
})
await run('pending config save and row failure survive navigation',async h=>{
 let finish;h.controller.set=()=>new Promise(resolve=>{finish=resolve});h.render();const field=[...h.instances.values()].find(i=>i.type.name==='FieldRow'&&i.props.spec.key==='maxWidth')
 const promise=field.props.onSet('maxWidth',1440);choose(h,'models');assert.ok(text(h.render()).includes(h.ui.locales.zh.saving));finish(false);await promise
 choose(h,'safety');assert.ok(text(h.render()).includes(h.ui.locales.zh.saveFailed));assert.equal(field.props.failure.key,'maxWidth');assert.ok(collect(field.raw,n=>n.props.role==='alert').length)
})
await run('adapter draft and save state are not reset by tab changes',h=>{
 h.state.adapterSave={status:'saving',draft:{bindings:{keyboard:{id:'Sample'}}}};h.state.pending='adapter';const draft=h.state.adapterSave
 for(const key of h.ui.SETTINGS_TABS)choose(h,key);assert.equal(h.state.adapterSave,draft);assert.equal(h.calls.length,0);assert.ok(text(byKey(h.render(),'runtime')).includes(h.ui.locales.zh['local.pending']))
})
await run('read-only Host fields disabled without disabling unrelated local preferences',h=>{
 h.config.writable=false;const tree=h.render();assert.ok(text(tree).includes(h.ui.locales.zh.readOnly))
 for(const i of h.instances.values())if(i.type.name==='FieldRow')assert.equal(collect(i.raw,n=>n.props.disabled!==undefined)[0].props.disabled,true)
 assert.equal(button(tree,'show')?.props.disabled??button(tree,'hide').props.disabled,false)
})
await run('missing management does not disable Host fields or trigger recovery',h=>{
 h.state.status='unavailable';h.state.value=null;const tree=h.render();assert.ok(text(tree).includes(h.ui.locales.zh['local.unavailable']))
 for(const i of h.instances.values())if(i.type.name==='FieldRow')assert.equal(collect(i.raw,n=>n.props.disabled!==undefined)[0].props.disabled,false)
 assert.equal(h.calls.length,0)
})
await run('disabled overlay retains explicit recovery reason',h=>{h.state.value.enabled=false;assert.ok(text(h.render()).includes(h.ui.locales.zh['local.disabled']));assert.equal(button(h.render(),'hide').props.disabled,true)})
await run('empty library and failed operations show visible messages',h=>{h.state.value.modelLibrary.items=[];h.state.failure={message:'Fixture failure'};const tree=choose(h,'models');assert.ok(text(tree).includes(h.ui.locales.zh['page.emptyLibrary']));assert.ok(text(byKey(tree,'runtime')).includes('Fixture failure'))})
await run('all new labels exist in both languages',h=>{for(const key of Object.keys(h.ui.locales.zh).filter(k=>k.startsWith('page.')||k.startsWith('tabs.')))assert.ok(h.ui.locales.en[key]);for(const key of h.ui.SETTINGS_TABS)assert.ok(h.ui.locales.zh['page.'+key+'Hint'])})
await run('recovery is secondary and imports remain distinct',h=>{
 const tree=h.render(),recovery=byKey(tree,'recovery');for(const action of ['reloadModel','retryDisplay'])assert.ok(button(recovery,action))
 for(const action of ['addLibraryFile','addLibraryFolder','importModelFile','importModelFolder']){assert.equal(collect(tree,n=>n.type==='button'&&n.props.key===action).length,1);button(tree,action).props.onClick()}
 assert.deepEqual(h.calls.map(c=>c[1]),['addLibraryFile','addLibraryFolder','importModelFile','importModelFolder'])
})
await run('CSS hides inactive panels and responds to container width',h=>{const css=byKey(h.render(),'style').children.join('');assert.match(css,/\[hidden\]\{display:none!important\}/);assert.match(css,/@container dgp \(max-width:480px\)/);assert.match(css,/@container dgp \(max-width:640px\)/);assert.match(css,/prefers-reduced-motion/)})
await run('range save failure remains beside its control and does not auto-retry',async h=>{
 h.manager.set=async()=>{h.calls.push(['failed-range']);h.state.failure={message:'Fixture disk full'};return false}
 h.render();const range=[...h.instances.values()].find(i=>i.type.name==='LocalRange'&&i.props.spec.key==='widthDip')
 collect(range.raw,n=>n.props.type==='number')[0].props.onChange({target:{value:'580'}});h.render()
 collect(range.raw,n=>n.props.type==='number')[0].props.onBlur({});await Promise.resolve();await Promise.resolve();h.render()
 assert.ok(text(range.raw).includes('Fixture disk full'));choose(h,'models');choose(h,'common');assert.equal(h.calls.length,1)
})
for(const pending of ['importProfile','importKeyboardImage'])await run(pending+' keeps cancellation available across tabs',h=>{
 h.state.pending=pending;for(const key of h.ui.SETTINGS_TABS)assert.equal(button(byKey(choose(h,key),'runtime'),'cancelLoad').props.disabled,false)
 assert.equal(h.calls.length,0)
})
console.log('Settings UI regression passed: '+checks+' isolated scenarios; no real Host, desktop process or input.')
