// End-to-end display-only management. Native picker choices are QA-supplied;
// model discovery, hidden rendering, preferences, styles and Core reports are real.
import {spawn} from 'node:child_process'
import * as fs from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {OverlayController} from '../src/overlay.js'
import {OverlayManagement,desktopUtility} from '../src/overlay-management.js'
import {desktopExecutable} from '../src/desktop-runtime.js'
const root=resolve(process.env.DSH_NATIVE_MODELS_QA_DIR??'.qa/model-adaptation/native-models');await fs.mkdir(root,{recursive:true})
const settings=join(root,'preferences-'+randomUUID()+'.json'),executable=process.env.DSH_DESKTOP_EXECUTABLE??desktopExecutable(),source=resolve('../cat'),checks=[],children=[]
const ownSpawn=(file,args,options)=>{assert.equal(file,executable,'Only the display/picker executable may be launched');const child=spawn(file,args,options);children.push(child.pid);return child}
const overlay=new OverlayController({desktop:executable,settingsPath:settings,defaultModel:resolve('../Deepseek桌宠'),useDesktop:true,spawn:ownSpawn,warn:m=>console.error(m)});overlay.captureCount=1
const utility=(args,signal)=>args[0]==='--pick'?Promise.resolve({path:source}):desktopUtility(executable,args,signal,ownSpawn);utility.supportsDiscovery=true
const manager=new OverlayManagement(overlay,{utility}),check=(v,n)=>{assert.ok(v,n);checks.push(n);console.log('PASS '+n)}
try{
 let state=await manager.getState();check(!overlay.child,'Opening parameter/model settings does not launch a display')
 await manager.command('importModelFolder');state=await manager.getState();check(state.modelCatalog.items.filter(x=>x.enabled).length===5&&!overlay.child,'Real ZIP discovery returns five choices before rendering starts')
 const first=state.modelCatalog.items.find(x=>x.enabled);await manager.command({type:'selectModel',catalogGeneration:state.modelCatalog.generation,modelId:first.id,revision:state.revision});state=await manager.getState()
 check(state.preferences.modelPath.endsWith('.zip')&&state.preferences.modelEntry.includes('/standard/'),'Only a matching ready model commits archive and entry preferences')
 check(!overlay.child&&!overlay.activated&&state.visible===false,'Import-only hidden renderer exits without creating display demand')
 await manager.command('refreshAdapter');state=await manager.getState();check(state.adapterCatalog.parameters.length>0&&!overlay.child,'A real Core parameter catalog is cached after temporary validation exits')
 let generation=state.adapterCatalog.generation;await manager.updatePreferences({modelAdapter:{catalogGeneration:generation,handStyle:'labels'}},state.revision);state=await manager.getState()
 check(state.adapterCatalog.handStyle==='labels'&&!overlay.child,'Native author-style validation saves without showing or retaining a temporary renderer')
 generation=state.adapterCatalog.generation;await manager.updatePreferences({modelAdapter:{catalogGeneration:generation,bindings:{keyboard:{id:'ParamAngleX',reverse:true}}}},state.revision);state=await manager.getState()
 check(state.adapterCatalog.inputs.find(x=>x.role==='keyboard').id==='ParamAngleX'&&state.adapterCatalog.inputs.find(x=>x.role==='keyboard').reverse,'Actual Core validates a manual reverse input binding')
 check(!state.adapterCatalog.effects.find(x=>x.role==='headX').enabled,'Automatic head decoration yields an input-owned parameter')
 const before=structuredClone(state.preferences);await assert.rejects(manager.updatePreferences({modelAdapter:{catalogGeneration:generation,handStyle:'no-labels'}},state.revision),{code:'stale_adapter_catalog'});check(JSON.stringify(manager.store.value)===JSON.stringify(before),'Late parameter generation cannot overwrite the newly saved mapping')
 const savedGlobal=structuredClone(state.preferences.globalAdapter);await manager.command('importModelFolder');state=await manager.getState();const second=state.modelCatalog.items.find(x=>x.enabled&&x.id!==first.id)
 await manager.command({type:'selectModel',catalogGeneration:state.modelCatalog.generation,modelId:second.id,revision:state.revision});state=await manager.getState()
 check(state.adapterCatalog.inputs.find(x=>x.role==='keyboard').id==='ParamAngleX'&&state.adapterCatalog.handStyle==='labels','Another compatible cat shares the global binding and artwork')
 check(JSON.stringify(state.preferences.globalAdapter)===JSON.stringify(savedGlobal),'Switching models preserves the global record instead of saving the effective fallback')
 await manager.command('refreshAdapter');state=await manager.getState();await manager.updatePreferences({modelAdapter:{catalogGeneration:state.adapterCatalog.generation,reset:true}},state.revision);check(!overlay.child,'Reset uses hidden validation and preserves the first-AI-operation display default')
}finally{
 await manager.close();await overlay.close()
 const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};for(let i=0;i<60&&children.some(alive);i++)await new Promise(r=>setTimeout(r,100));check(!children.some(alive),'Owned display and discovery utility processes all exit')
 check(!(await fs.readdir(join(root,'webview-cache')).catch(()=>[])).length,'Owned private browser caches have no residual directories')
 await fs.writeFile(join(root,'report.json'),JSON.stringify({checks,settings,children,realDesktopCaptured:false,realInputInjected:false,inputHelpersStarted:0},null,2))
}
console.log(checks.length+' end-to-end model management checks passed without OS input or desktop capture.')
