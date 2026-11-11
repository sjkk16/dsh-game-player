import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { projectRoot } from './validation.mjs'
import { PREFERENCE_DEFAULTS, OverlayPreferences, migratePreferences, validatePreferenceRequest } from '../src/overlay-preferences.js'
import { OverlayController } from '../src/overlay.js'
import { OverlayManagement } from '../src/overlay-management.js'
import { PROTECTED_PARAMETERS, validateAdapterAgainstCatalog } from '../src/live2d/model-adapter.js'
import { validateMotion } from '../src/live2d/motions.js'

const files=['client.js','src/overlay-models.js','src/overlay-management.js','src/overlay.js','src/overlay-preferences.js','desktop/OverlaySettings.cs','desktop/DisplaySettings.cs','desktop/DisplayCommands.cs','desktop/ModelPackage.cs','desktop/model-scene.js','desktop/renderer.js']
for(const file of files){const source=await fs.readFile(join(projectRoot,file),'utf8');assert.doesNotMatch(source,/ModelWatermark|modelWatermark|AUTHORIZED_WATERMARKS|applyWatermark|watermarkPreference|watermarkCapable|watermark-gate|watermarkProbe|watermarkReport/,'Retired control remains in '+file)}
await assert.rejects(fs.access(join(projectRoot,'src','live2d','watermark.js')),{code:'ENOENT'})
const generation='00000000-0000-4000-8000-000000000001',records={['a'.repeat(64)]:{mode:'hidden',mocHash:'b'.repeat(64)}}
for(const mode of ['hidden','default'])assert.throws(()=>validatePreferenceRequest({modelWatermark:{catalogGeneration:generation,mode}}),{code:'invalid_preferences'})
assert.throws(()=>validatePreferenceRequest({modelWatermarks:records}),{code:'invalid_preferences'})
assert.equal(Object.hasOwn(PREFERENCE_DEFAULTS,'modelWatermarks'),false)
assert.equal(Object.hasOwn(migratePreferences({version:5,modelWatermarks:records}),'modelWatermarks'),false)
assert.ok(PROTECTED_PARAMETERS.includes('Paramshuiying'))
assert.throws(()=>validateMotion({Version:3,Meta:{Duration:1,Fps:30},Curves:[{Target:'Parameter',Id:'Paramshuiying',Segments:[0,0,0,1,1]}]},{Paramshuiying:{min:0,max:1,default:0}}),/author switch/)
assert.throws(()=>validateAdapterAgainstCatalog({catalogGeneration:generation,bindings:{keyboard:{id:'Paramshuiying',reverse:false}}},{generation,parameters:[{id:'Paramshuiying',min:0,max:1,default:0}],handStyles:[]}),{code:'invalid_adapter'})
const privateRoot=join(projectRoot,'.qa','watermark-removal');await fs.mkdir(privateRoot,{recursive:true});const directory=await fs.mkdtemp(join(privateRoot,'isolated-'))
let overlay
try{
 const file=join(directory,'overlay.json'),raw=JSON.stringify({version:5,revision:7,view:'keyboard',globalAdapter:{},modelWatermarks:records})
 await fs.writeFile(file,raw);const store=new OverlayPreferences(file);await store.ready
 assert.equal(store.revision,7);assert.equal(store.value.view,'keyboard');assert.equal(Object.hasOwn(store.value,'modelWatermarks'),false);assert.equal(await fs.readFile(file,'utf8'),raw,'Loading must not rewrite old records')
 overlay=new OverlayController({settingsPath:join(directory,'test','overlay.json'),enabled:false,spawn(){throw Error('No process may start in removal fixtures')}});await overlay.preferences.ready
 const manager=new OverlayManagement(overlay,{utility(){throw Error('No native utility may run')}})
 await assert.rejects(manager.updatePreferences({modelWatermark:{catalogGeneration:generation,mode:'hidden'}},0),{code:'invalid_preferences'})
 const state=await manager.getState();assert.equal(Object.hasOwn(state.capabilities,'watermark'),false);assert.equal(Object.hasOwn(state,'watermarkBlocked'),false)
 await manager.close();await overlay.close()
}finally{if(overlay)clearInterval(overlay.adaptiveTimer);assert.ok(resolve(directory).startsWith(resolve(privateRoot)+sep));await fs.rm(directory,{recursive:true,force:true})}
console.log('Watermark removal regression passed: UI, RPC, records, native/renderer control absence and author parameter protections; no real models, desktop process or input were used.')
