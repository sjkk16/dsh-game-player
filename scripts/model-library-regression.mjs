import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { OverlayController } from '../src/overlay.js'
import { OverlayManagement } from '../src/overlay-management.js'
import { ModelLibrary } from '../src/model-library.js'

const root=dirname(dirname(fileURLToPath(import.meta.url))),base=join(root,'.qa'),hash=s=>createHash('sha256').update(s).digest('hex')
await fs.mkdir(base,{recursive:true})
let scenarios=0
async function fixture(options,run){
  const directory=await fs.mkdtemp(join(base,'library-delete-'))
  if(!resolve(directory).startsWith(resolve(base)+sep))throw Error('Fixture escaped the project QA directory')
  const control={...options},events=[],warnings=[]
  let library,overlay
  const io={...fs,async rename(from,to){if(control.failIndex&&library&&to===library.path)throw Error('Synthetic index write failure');if(control.failPreferences&&to===join(directory,'overlay.json'))throw Error('Synthetic preference write failure');return fs.rename(from,to)},async rm(path,settings){events.push(['remove',path]);if(control.newActivity){overlay.activity++;overlay.activated=true;overlay.runtime.userHidden=false}return fs.rm(path,settings)}}
  try{
    const items=options.items??['first']
    const records=items.map((name,index)=>{const bundleId=hash(options.shared?'shared':name),entry=name+'.model3.json';return {id:hash(bundleId+'\0'+entry.toLowerCase()),bundleId,entry,name,kind:'zip',modelKey:hash(name+'-model')}})
    for(const record of records){const folder=join(directory,'models',record.bundleId);await fs.mkdir(folder,{recursive:true});await fs.writeFile(join(folder,'source.zip'),'synthetic fixture bytes')}
    const external=join(directory,'external-original.zip');await fs.writeFile(external,'original author resources')
    overlay=new OverlayController({settingsPath:join(directory,'overlay.json'),defaultModel:join(directory,'no-default'),enabled:options.enabled!==false,spawn(){throw Error('Regression tests must never start a real process')},warn(message){warnings.push(message)}})
    const store=overlay.preferences;await store.ready;store.io=io
    const selected=options.active===false?null:records[0]
    if(selected)await store.update({modelPath:join(directory,'models',selected.bundleId,'source.zip'),modelEntry:selected.entry,profilePath:null,view:options.view??'keyboard',widthDip:555,globalAdapter:{}},store.revision)
    const index={version:1,revision:7,items:records};await fs.writeFile(join(directory,'library.json'),JSON.stringify(index))
    const manager=new OverlayManagement(overlay,{io,utility(){throw Error('Regression tests must not invoke the native utility')}})
    library=new ModelLibrary(manager);manager.library=library;await library.ready;await library.refresh()
    overlay.realState.session='test-only';overlay.realState.sequence=17;overlay.realState.status='unknown';overlay.realState.keys.add('A');overlay.realState.buttons.add('left');overlay.state=overlay.realState
    const input=overlay.realState,keys=[...input.keys],buttons=[...input.buttons]
    overlay.runtime={...overlay.runtime,modelLoaded:options.running!==false,modelSourcePath:selected?library.source(selected):null,modelPath:'old/model.json',modelToken:'old-token',modelKey:selected?.modelKey??null,modelEntry:selected?.entry??null,sourceProof:[{path:'old'}],adapterCatalog:{old:true},motionCatalog:[{old:true}],motionSignature:'old',userHidden:options.hidden===true,view:options.view??'keyboard'}
    overlay.ready=options.running!==false;overlay.dead=options.running===false;overlay.child=options.running===false?undefined:{fixture:true};overlay.activated=options.activated!==false
    overlay.changed=()=>events.push(['state'])
    overlay.stopDisplay=async reason=>{events.push(['stop',reason]);overlay.child=undefined;overlay.dead=true;await OverlayController.prototype.stopDisplay.call(overlay,reason)}
    overlay.start=async settings=>{
      events.push(['start',settings]);assert.equal(store.value.modelPath,null);assert.equal(store.value.modelEntry,null);assert.equal(store.value.view,'keyboard');assert.equal(settings.deferModel,true)
      await assert.rejects(fs.access(library.path+'.lock'),{code:'ENOENT'})
      if(control.failRestart)throw Error('Synthetic display restart failure')
      overlay.ready=true;overlay.dead=false;overlay.child={fixture:true};overlay.runtime={...overlay.runtime,renderer:'keyboard',view:'keyboard',modelLoaded:false};return
    }
    overlay.command=async()=>{throw Error('Deleting a model must not load a replacement or send input')}
    const remove=(record,extra={},signal)=>library.remove({modelId:record.id,libraryRevision:library.index.revision,revision:store.revision,...extra},signal)
    const checkInput=()=>{assert.equal(overlay.realState,input);assert.equal(overlay.state,input);assert.equal(input.status,'unknown');assert.equal(input.sequence,17);assert.deepEqual([...input.keys],keys);assert.deepEqual([...input.buttons],buttons)}
    await run({directory,control,events,warnings,records,manager,library,overlay,store,external,remove,checkInput})
    assert.equal(await fs.readFile(external,'utf8'),'original author resources')
    checkInput();scenarios++
  }finally{
    if(!resolve(directory).startsWith(resolve(base)+sep))throw Error('Unsafe fixture cleanup boundary')
    await fs.rm(directory,{recursive:true,force:true})
  }
}

await fixture({},async h=>{
  const [item]=h.records,path=dirname(h.library.source(item));await h.remove(item)
  assert.equal(h.library.index.items.length,0);assert.equal(h.library.active(),null);assert.equal(h.store.value.modelPath,null);assert.equal(h.store.value.modelEntry,null);assert.equal(h.store.value.profilePath,null);assert.equal(h.store.value.view,'keyboard');assert.equal(h.store.value.widthDip,555)
  assert.equal(h.overlay.runtime.modelSourcePath,null);assert.equal(h.overlay.runtime.modelToken,null);assert.equal(h.overlay.runtime.adapterCatalog,null);assert.equal(h.overlay.runtime.modelLoaded,false)
  assert.equal(h.manager.models.cache,null);assert.equal(h.manager.motions.cache,null)
  await assert.rejects(fs.access(path),{code:'ENOENT'})
  assert.deepEqual(h.events.filter(event=>['stop','remove','start'].includes(event[0])).map(event=>event[0]),['stop','remove','start'])
})
await fixture({items:['first','second']},async h=>{await h.remove(h.records[0]);assert.equal(h.library.index.items.length,1);assert.equal(h.store.value.modelPath,null);assert.equal(await fs.readFile(h.library.source(h.records[1]),'utf8'),'synthetic fixture bytes')})
await fixture({items:['first','second']},async h=>{const before=h.store.snapshot();await h.remove(h.records[1]);assert.deepEqual(h.store.snapshot(),before);assert.equal(h.events.some(event=>event[0]==='stop'||event[0]==='start'),false);assert.equal(await fs.readFile(h.library.source(h.records[0]),'utf8'),'synthetic fixture bytes')})
await fixture({items:['first','second'],shared:true},async h=>{const packagePath=dirname(h.library.source(h.records[0]));await h.remove(h.records[1]);await fs.access(packagePath);assert.equal(h.events.some(event=>event[0]==='remove'),false);await h.remove(h.records[0]);await assert.rejects(fs.access(packagePath),{code:'ENOENT'})})
await fixture({enabled:false,running:false},async h=>{await h.remove(h.records[0]);assert.equal(h.library.index.items.length,0);assert.equal(h.store.value.modelPath,null);assert.equal(h.events.some(event=>event[0]==='start'),false)})
await fixture({running:false},async h=>{await h.remove(h.records[0]);assert.equal(h.events.some(event=>event[0]==='start'),false);assert.equal(h.overlay.runtime.modelSourcePath,null)})
await fixture({hidden:true},async h=>{await h.remove(h.records[0]);const start=h.events.find(event=>event[0]==='start');assert.equal(start[1].hidden,true);assert.equal(h.overlay.runtime.userHidden,true)})
await fixture({activated:false},async h=>{await h.remove(h.records[0]);assert.equal(h.events.find(event=>event[0]==='start')[1].hidden,true);assert.equal(h.overlay.activated,false)})
await fixture({activated:false,hidden:true,newActivity:true},async h=>{await h.remove(h.records[0]);assert.equal(h.events.find(event=>event[0]==='start')[1].hidden,false);assert.equal(h.overlay.activated,true);assert.equal(h.overlay.runtime.userHidden,false)})
await fixture({},async h=>{const [item]=h.records;await assert.rejects(h.remove(item,{libraryRevision:0}),{code:'library_conflict'});assert.equal(h.library.index.items.length,1);assert.equal(h.events.length,0);await fs.access(h.library.source(item))})
await fixture({},async h=>{const [item]=h.records;await assert.rejects(h.remove(item,{revision:0}),{code:'preference_conflict'});assert.equal(h.library.index.items.length,1);assert.equal(h.events.length,0);await fs.access(h.library.source(item))})
await fixture({},async h=>{const signal=new AbortController();signal.abort();await assert.rejects(h.remove(h.records[0],{},signal.signal));assert.equal(h.library.index.items.length,1);assert.equal(h.events.length,0);await fs.access(h.library.source(h.records[0]))})
await fixture({},async h=>{h.manager.busy='loading';await assert.rejects(h.remove(h.records[0]),{code:'busy'});h.manager.busy=null;assert.equal(h.library.index.items.length,1);assert.equal(h.events.length,0)})
await fixture({},async h=>{h.manager.motions.active={fixture:true};await assert.rejects(h.remove(h.records[0]),{code:'busy'});h.manager.motions.active=null;assert.equal(h.events.length,0)})
await fixture({},async h=>{h.control.failPreferences=true;const before=h.store.snapshot();await assert.rejects(h.remove(h.records[0]),/Synthetic preference/);assert.deepEqual(h.store.snapshot(),before);assert.equal(h.library.index.items.length,1);assert.equal(h.events.length,0);await fs.access(h.library.source(h.records[0]))})
await fixture({},async h=>{h.control.failIndex=true;await assert.rejects(h.remove(h.records[0]),/Synthetic index/);assert.equal(h.library.index.items.length,1);await fs.access(h.library.source(h.records[0]));assert.equal(h.store.value.modelPath,null);h.control.failIndex=false;await h.remove(h.records[0]);assert.equal(h.library.index.items.length,0)})
await fixture({},async h=>{h.control.failRestart=true;await h.remove(h.records[0]);assert.equal(h.library.index.items.length,0);assert.match(h.manager.lastError,/keyboard display unavailable/);await assert.rejects(fs.access(h.library.source(h.records[0])),{code:'ENOENT'})})
await fixture({active:false,running:false},async h=>{h.overlay.runtime.modelSourcePath=h.library.source(h.records[0]);h.overlay.runtime.modelLoaded=false;await h.remove(h.records[0]);await assert.rejects(fs.access(h.library.source(h.records[0])),{code:'ENOENT'})})
await fixture({active:false},async h=>{h.overlay.runtime.modelSourcePath=h.library.source(h.records[0]);h.overlay.runtime.modelLoaded=true;await h.remove(h.records[0]);await fs.access(h.library.source(h.records[0]));assert.equal(h.library.index.items.length,0)})
await fixture({},async h=>{await assert.rejects(h.remove(h.records[0],{modelId:'builtin-default'}),{code:'invalid_model_selection'});assert.equal(h.events.length,0);await assert.rejects(h.library.checkedTree(join(h.directory,'external')), {code:'unsafe_library_path'});await fs.access(h.library.source(h.records[0]))})

// Render the isolated library component only: no browser or Host is launched.
const source=readFileSync(join(root,'client.js'),'utf8'),begin=source.indexOf('    function ModelLibraryControls('),end=source.indexOf('    function OverlayControls(',begin)
assert(begin>=0&&end>begin)
const h=(type,props,children)=>({type,props:props??{},children})
const context=vm.createContext({h,LibraryCandidateControls(){},confirm(){return true}})
vm.runInContext(source.slice(begin,end)+';globalThis.LibraryControls=ModelLibraryControls',context)
const commands=[],item={id:'model-fixture',name:'fixture',available:true,builtin:false},tree=context.LibraryControls({manager:{command(value){commands.push(value)}},state:{status:'ready',pending:null},value:{modelLibrary:{revision:7,items:[item]},activeModelId:item.id,enabled:false,loading:false,capabilities:{library:true},revision:8,view:'keyboard'},t:value=>value})
function walk(node,out=[]){if(Array.isArray(node))for(const child of node)walk(child,out);else if(node&&typeof node==='object'){out.push(node);walk(node.children,out)}return out}
const button=walk(tree).find(node=>node.props.key==='library-remove-'+item.id)
assert(button);assert.equal(button.props.disabled,false);button.props.onClick();assert.equal(commands.length,1);assert.equal(commands[0].type,'removeLibraryModel')
console.log('Library removal regression passed: '+scenarios+' isolated filesystem scenarios plus UI confirmation/button behavior; active/final/disabled deletion, shared packages, cancellation, conflicts, failures and original resource/input-state protection verified.')
