// Explicit native smoke against a fresh normal user-data directory, not a
// Low-integrity workspace fixture. No desktop capture, input helper, OS input,
// picker dialog, real preference update, or original model write is performed.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {join,resolve,dirname,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {OverlayController} from '../src/overlay.js'
import {OverlayManagement} from '../src/overlay-management.js'
import {desktopExecutable,desktopLaunch} from '../src/desktop-runtime.js'
if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('Windows and LOCALAPPDATA are required for the native user-data smoke.')
const data=resolve(process.env.LOCALAPPDATA,'dsh-game-player'),root=join(data,'storage-qa-'+randomUUID()),settings=join(root,'overlay.json')
const output=resolve(process.env.DSH_STORAGE_QA_DIR??'.qa/storage-permission-20261109'),reports=[],children=[],caches=[]
const exe=desktopExecutable(),expected=desktopLaunch(exe,[])
assert.notEqual(expected.command,exe,'This regression requires the installed system framework host.')
await fs.mkdir(root,{recursive:true});await fs.mkdir(output,{recursive:true})
const check=(value,name)=>{assert.ok(value,name);reports.push(name);console.log('PASS '+name)}
async function instance(index){
 const overlay=new OverlayController({settingsPath:settings,defaultModel:resolve('../Deepseek桌宠'),spawn(file,args,options){
  check(file===expected.command&&args[0]===expected.args[0],'Display '+index+' uses only the system framework host and bundled DLL')
  const child=spawn(file,args,options);children.push(child.pid);return child
 },warn:message=>console.error(message)})
 overlay.captureCount=1 // A hide gate only; no screen capture is invoked.
 const manager=new OverlayManagement(overlay)
 try{
  const offline=await manager.getState();check(!overlay.child,'Reading user-data settings does not spawn display '+index)
  if(index===1)await manager.updatePreferences({widthDip:440,opacity:.8},offline.revision)
  else check(offline.preferences.widthDip===440&&offline.preferences.opacity===.8,'User-data preferences survive recreation')
  await overlay.start({hidden:true})
  const state=await manager.getState()
  check(overlay.ready&&state.modelLoaded&&state.capabilities.model===true&&!state.error,'Core model loads with a writable normal user-data cache '+index)
  check(!state.visible,'No model is explicitly displayed during storage verification '+index)
  const cache=overlay.nativeCaches.get(overlay.child);assert.ok(cache);caches.push(cache.directory)
  check(dirname(cache.directory)===join(root,'webview-cache'),'Private cache stays within the isolated user-data fixture '+index)
 }finally{await manager.close();await overlay.close()}
 check(!(await fs.readdir(join(root,'webview-cache')).catch(()=>[])).length,'Owned browser cache is released after exit '+index)
}
try{
 await instance(1);await instance(2)
 check(caches[0]!==caches[1],'Restarts do not share a private renderer cache')
 check(children.every(pid=>{try{process.kill(pid,0);return false}catch{return true}}),'Owned display processes have all exited')
 await fs.writeFile(join(output,'medium-user-data-report.json'),JSON.stringify({checks:reports,launch:expected,fixture:root,cacheDirectories:caches,realDesktopCaptured:false,realInputInjected:false,inputHelperStarted:false,realUserPreferencesWritten:false},null,2))
}finally{
 const boundary=data+sep;if(!resolve(root).startsWith(boundary)||!/^storage-qa-[a-f0-9-]+$/.test(root.slice(boundary.length)))throw Error('Unsafe user-data fixture cleanup')
 const stat=await fs.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Linked user-data fixture cleanup rejected')
 await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})
}
console.log(reports.length+' native normal user-data checks passed. Real host visible/restart acceptance remains pending.')
