import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join, resolve, dirname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { Config, resolveConfig, apply } from '../index.js'
import { PLUGIN_DIRECTORY, DEFAULT_DATA_DIRECTORY, DEFAULT_MACRO_STORAGE, resolveDataDirectory, prepareDataDirectory } from '../src/data-directory.js'
import { OverlayPreferences } from '../src/overlay-preferences.js'
import { OverlayController } from '../src/overlay.js'
import { OverlayManagement } from '../src/overlay-management.js'
import { MacroStore } from '../src/macros.js'

let checks = 0
const check = (name, run) => { try { run(); checks++ } catch (cause) { throw Error(name, { cause }) } }
check('unspecified override preserves old locations without touching them', () => {
 const defaults=resolveConfig({},()=>{});assert.equal(defaults.dataDirectory,undefined)
 assert.equal(defaults.settingsPath,join(DEFAULT_DATA_DIRECTORY,'overlay.json'));assert.equal(defaults.macroStoragePath,DEFAULT_MACRO_STORAGE)
})
check('schema option requires reload',()=>assert.notEqual(Config.dict.dataDirectory.meta.volatile,true))
check('relative path uses plugin directory',()=>assert.equal(resolveDataDirectory('.qa/relative-data'),join(PLUGIN_DIRECTORY,'.qa','relative-data')))
for(const value of [null,'',' ',42,{},'C:relative','\\\\server\\share','//server/share','https://host/data','file:///data','bad\0path'])check('reject invalid override '+JSON.stringify(value),()=>assert.throws(()=>resolveConfig({dataDirectory:value},()=>{}),{code:'invalid_data_directory'}))
const privateRoot=join(PLUGIN_DIRECTORY,'.qa','data-directory-regression');await fs.mkdir(privateRoot,{recursive:true})
const directory=await fs.mkdtemp(join(privateRoot,'isolated-'));let overlay,manager
try {
 const base=join(directory,'data'),custom=join(directory,'custom-macros.json')
 const options=resolveConfig(Config({dataDirectory:base,overlayEnabled:false}),()=>{})
 check('schema-filled legacy macro default follows override',()=>{assert.equal(options.settingsPath,join(base,'overlay.json'));assert.equal(options.macroStoragePath,join(base,'macros.json'))})
 check('custom macro path remains compatible',()=>assert.equal(resolveConfig(Config({dataDirectory:base,macroStoragePath:custom}),()=>{}).macroStoragePath,custom))
 check('writable preflight leaves no probe',()=>prepareDataDirectory(base));assert.deepEqual(await fs.readdir(base),[])
 const blocked=join(directory,'blocked');await fs.writeFile(blocked,'not a directory')
 let factories=0
 check('unavailable isolation fails before any store or helper factory',()=>assert.throws(()=>apply({}, {dataDirectory:blocked},{overlayFactory(){factories++},bridgeFactory(){factories++},macroStoreFactory(){factories++}}),{code:'data_directory_unavailable'}))
 assert.equal(factories,0)
 check('permission-denied storage does not fall back',()=>assert.throws(()=>prepareDataDirectory(base,{mkdirSync(){throw Object.assign(Error('permission denied fixture'),{code:'EACCES'})}}),{code:'data_directory_unavailable'}))
 let capturedOverlay,capturedMacro,tools=[]
 apply({effect(){},on(){},inject(){},logger:{warn(){}},attachments:{},tools:{register(tool){tools.push(tool)}}},Config({dataDirectory:base,overlayEnabled:false}),{
  autoRestore:false,overlayFactory(value){capturedOverlay=value;return {observe(){},preferences:null}},bridgeFactory(){return {}},macroStoreFactory(value){capturedMacro=value;return {}}
 })
 check('Host routes settings, absent default model and macros into isolation',()=>{assert.equal(capturedOverlay.settingsPath,options.settingsPath);assert.equal(capturedOverlay.defaultModel,join(base,'unselected-default-model'));assert.equal(capturedMacro,options.macroStoragePath);assert.ok(tools.length>=5)})
 let accesses=[]
 const guarded=new Proxy(fs,{get(target,name){const value=target[name];if(typeof value!=='function')return value;return(...args)=>{
  for(const candidate of args.slice(0,['rename','copyFile'].includes(name)?2:1))if(typeof candidate==='string'){const absolute=resolve(candidate);assert.ok(absolute===resolve(base)||absolute.startsWith(resolve(base)+sep),'Unexpected data access: '+name);accesses.push([name,absolute])}
  return value(...args)
 }}})
 const store=new OverlayPreferences(options.settingsPath,{io:guarded});await store.ready
 overlay=new OverlayController({settingsPath:options.settingsPath,preferences:store,enabled:false,defaultModel:join(base,'unselected-default-model'),spawn(){throw Error('No native process or helper may start')}})
 manager=new OverlayManagement(overlay,{io:guarded,utility(){throw Error('No picker may start')}})
 const initial=await manager.getState();assert.deepEqual(initial.modelLibrary.items,[]);assert.equal(store.value.modelPath,null)
 await store.update({controlMode:'adaptive',modelInfoVisible:false},0)
 const restored=new OverlayPreferences(options.settingsPath,{io:guarded});await restored.ready
 check('isolated preferences survive restart',()=>{assert.equal(restored.value.controlMode,'adaptive');assert.equal(restored.value.modelInfoVisible,false)})
 await manager.library.ensureRoot();await manager.library.write([],0)
 check('library index and resources share isolated parent',()=>{assert.equal(manager.library.path,join(base,'library.json'));assert.equal(manager.library.root,join(base,'models'));assert.equal(manager.library.index.revision,1)})
 const macros=new MacroStore(options.macroStoragePath);assert.deepEqual((await macros.list()).templates,[])
 await macros.save('fixture',{actions:[{kind:'wait',durationMs:10}]});assert.equal((await new MacroStore(options.macroStoragePath).get('fixture')).name,'fixture')
 check('all observed preference and library I/O stays in isolation',()=>assert.ok(accesses.length>10))
 const source=await fs.readFile(join(PLUGIN_DIRECTORY,'desktop','Program.cs'),'utf8')
 check('native cache derives from supplied settings parent',()=>assert.match(source,/PrepareCache\(qa \? qaDir! : Path\.GetDirectoryName\(settingsPath\)!/))
 const code='const {resolveConfig}=await import('+JSON.stringify(pathToFileURL(join(PLUGIN_DIRECTORY,'index.js')).href)+');const c=resolveConfig({dataDirectory:".qa/cwd-fixture"},()=>{});console.log(JSON.stringify({settings:c.settingsPath,macro:c.macroStoragePath}));'
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:directory,env:{...process.env,LOCALAPPDATA:join(directory,'untouched-original-sentinel')},encoding:'utf8',windowsHide:true})
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout)
 check('different Host cwd and old user root cannot redirect isolation',()=>{assert.equal(result.settings,join(PLUGIN_DIRECTORY,'.qa','cwd-fixture','overlay.json'));assert.equal(result.macro,join(PLUGIN_DIRECTORY,'.qa','cwd-fixture','macros.json'))})
 await assert.rejects(fs.access(join(directory,'untouched-original-sentinel')),{code:'ENOENT'})
} finally {
 await manager?.close();if(overlay)await overlay.close()
 assert.ok(resolve(directory).startsWith(resolve(privateRoot)+sep));await fs.rm(directory,{recursive:true,force:true})
}
console.log('Data directory regression passed: '+checks+' checks; isolated settings/library/macros persistence, Host routing, reload schema, invalid/unwritable failure and no fallback. No real user data, desktop process, screenshot or input were used.')
