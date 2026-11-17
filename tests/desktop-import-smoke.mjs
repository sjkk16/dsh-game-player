import {desktopExecutable,desktopLaunch} from '../src/desktop-runtime.js'
// Native display-only regressions. Picker results are supplied by QA; no OS
// input injection, desktop capture, input helper, or edits to original models.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {resolve,join,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {OverlayController} from '../src/overlay.js'
import {OverlayManagement,desktopUtility} from '../src/overlay-management.js'
const base=resolve(process.env.DSH_NATIVE_IMPORT_QA_DIR??'.qa/native-import-smoke'),root=join(base,randomUUID()),reports=[]
await fs.mkdir(root,{recursive:true})
const model=resolve('../Deepseek桌宠/img/standard/cat_model/deepseek.model3.json')
const executable=resolve(process.env.DSH_DESKTOP_EXECUTABLE??desktopExecutable())
const check=(value,name)=>{assert.ok(value,name);reports.push(name);console.log('PASS '+name)}
async function fixture(name,run){
 const directory=join(root,name);await fs.mkdir(directory,{recursive:true})
 const launches=[],children=[],overlay=new OverlayController({desktop:executable,settingsPath:join(directory,'overlay.json'),defaultModel:join(directory,'missing-default.model3.json'),useDesktop:true,
  spawn(file,args,options){check(file===desktopLaunch(executable,[]).command,'Only the owned display/framework host is started ('+name+')');launches.push({file,args});const child=spawn(file,args,options);children.push(child.pid);return child},warn:message=>console.error(message)})
 overlay.captureCount=1 // Re-applied to every new display; no real screen capture occurs.
 const utility=async(args,signal)=>args[0]==='--pick'?{path:model}:desktopUtility(executable,args,signal);utility.supportsDiscovery=true
 const manager=new OverlayManagement(overlay,{utility})
 try{await run({directory,overlay,manager,launches,children})}
 finally{await manager.close();await overlay.close();check(children.every(pid=>{try{process.kill(pid,0);return false}catch{return true}}),'Owned display processes exit ('+name+')')}
 const cache=join(directory,'webview-cache');check(!(await fs.readdir(cache).catch(()=>[])).length,'Private renderer caches are released ('+name+')')
}
try{
 await fixture('cold-file',async({overlay,manager,launches})=>{
  await manager.command('importModelFile')
  check(manager.store.value.modelPath===model,'A real .model3.json imports despite an invalid default model')
  check(launches.length===1&&launches[0].args.at(-1)==='true','Cold import uses one deferred, hidden renderer')
  check(!overlay.child&&overlay.dead&&!overlay.activated,'Import-only startup exits without showing the pet')
 })
 await fixture('recover-link',async({directory,overlay,manager,launches})=>{
  const link=join(directory,'link'),missing=join(directory,'missing-target');await fs.symlink(missing,link,'junction')
  overlay.settingsPath=join(link,'overlay.json');manager.store.path=overlay.settingsPath
  await overlay.start({hidden:true})
  const state=await manager.getState()
  check(state.errorCode==='storage_unavailable'&&state.capabilities.picker&&!state.capabilities.model,'Broken data junction reports storage failure without disabling the picker')
  check(!(await fs.stat(missing).catch(()=>null)),'Runtime does not invent a broken junction target')
  await fs.mkdir(missing)
  await manager.command('importModelFile')
  check(launches.length===2&&launches[1].args.at(-1)==='true','Import retries a failed renderer exactly once in hidden mode')
  check((await manager.getState()).modelLoaded&&(await manager.getState()).visible===false,'Recovered import commits the model and preserves hidden visibility')
  check(manager.store.value.modelPath===model,'Recovered import persists only the validated candidate')
  await overlay.stopDisplay()
  check(!(await fs.readdir(join(missing,'webview-cache')).catch(()=>[])).length,'Resolved junction cache is released without deleting the data target')
 })
 await fixture('failed-link',async({directory,overlay,manager,launches})=>{
  const link=join(directory,'link');await fs.symlink(join(directory,'missing-target'),link,'junction');overlay.settingsPath=join(link,'overlay.json');manager.store.path=overlay.settingsPath
  await overlay.start({hidden:true})
  await assert.rejects(manager.command('importModelFile'),{code:'storage_unavailable'})
  check(launches.length===2,'Persistent storage failure performs no unbounded retry loop')
  check(manager.store.value.modelPath===null,'Failed hidden recovery preserves the previous preference')
 })
 await fixture('cache-collision',async({directory,overlay,manager})=>{
  await fs.writeFile(join(directory,'webview-cache'),'blocked')
  await overlay.start({hidden:true})
  check((await manager.getState()).errorCode==='storage_unavailable','Cache creation failure is not mislabeled as model timeout')
  check(overlay.renderer==='keyboard'&&overlay.capabilities.management,'Storage failure retains honest v3 keyboard management')
 })
}finally{
 await fs.writeFile(join(base,'report.json'),JSON.stringify({checks:reports,realDesktopCaptured:false,realInputInjected:false,inputHelperCreated:false},null,2))
 if(!resolve(root).startsWith(resolve(base)+sep))throw Error('Unsafe native import fixture cleanup')
 await fs.rm(root,{recursive:true,force:true})
}
console.log(reports.length+' native import/storage checks passed. No real input/capture was used.')
