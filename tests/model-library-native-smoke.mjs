// Native discovery/copy only. This never launches WebView2 or an input helper.
import {spawn} from 'node:child_process'
import * as fs from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {OverlayController} from '../src/overlay.js'
import {OverlayManagement,desktopUtility} from '../src/overlay-management.js'
import {desktopExecutable} from '../src/desktop-runtime.js'
const dir=resolve(process.env.DSH_LIBRARY_QA_DIR??'.qa/model-library-0.3.0/native-library'),original=resolve('../cat');await fs.mkdir(dir,{recursive:true})
const hash=async path=>createHash('sha256').update(await fs.readFile(path)).digest('hex'),calls=[]
const utility=async(args,signal)=>{if(args[0]==='--pick')return {path:original};assert.ok(['--describe-model-source','--discover-model'].includes(args[0]));calls.push(args[0]);return desktopUtility(desktopExecutable(),args,signal)};utility.supportsLibrary=true;utility.supportsDiscovery=true
const overlay=new OverlayController({enabled:false,settingsPath:join(dir,'overlay.json'),spawn:(...args)=>{throw Error('A library-only run must never launch a display or input helper.')},defaultModel:resolve('../Deepseek桌宠')})
const manager=new OverlayManagement(overlay,{utility}),before={};for(const file of await fs.readdir(original))if(file.endsWith('.zip'))before[file]=await hash(join(original,file))
try {
 await manager.command('addLibraryFolder');const catalog=manager.library.catalog;assert.equal(catalog.items.filter(x=>!x.error).length,5)
 await manager.command({type:'addLibraryModels',catalogGeneration:catalog.generation,modelIds:catalog.items.filter(x=>!x.error).map(x=>x.id),libraryRevision:manager.library.index.revision})
 const result=[];for(const item of manager.library.index.items){const file=catalog.items.find(c=>c.name===item.name).sourcePath;const originalHash=await hash(file),managedHash=await hash(manager.library.source(item));assert.equal(originalHash,managedHash);const discovery=await utility(['--discover-model',manager.library.source(item)],manager.signal());assert.ok(discovery.candidates.some(c=>!c.error&&c.entry===item.entry));result.push({name:item.name,id:item.id,entry:item.entry,originalHash,managedHash})}
 const state=await manager.getState();assert.equal(state.modelLibrary.items.length,6);assert.equal(state.activeModelId,'builtin-default');assert.equal(state.visible,false);assert.equal(manager.store.value.modelPath,null)
 for(const [name,value] of Object.entries(before))assert.equal(await hash(join(original,name)),value)
 await fs.writeFile(join(dir,'native-copy-report.json'),JSON.stringify({models:result,utilityCalls:calls.length,userInputHelper:false,displayStarted:false},null,2))
 console.log('PASS five real ZIP models copied, re-discovered and SHA-256 verified; six persistent library entries; no display/input helper started.')
}finally{await manager.close();await overlay.close()}
