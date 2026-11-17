// Display-only native acceptance. Uses a private settings file and original
// model resources; NEVER imports PwshBridge, screenshots the desktop or injects input.
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { OverlayController } from '../src/overlay.js'
import { OverlayManagement } from '../src/overlay-management.js'
import { styleFor } from '../src/keyboard-style.js'
const visible=process.argv.includes('--visible'),root=resolve(process.env.DSH_NATIVE_UI_QA_DIR??'.qa/native-ui-smoke');await fs.mkdir(root,{recursive:true})
const settings=join(root,'overlay-'+Date.now()+'.json'),reports=[]
const check=(value,name)=>{assert.ok(value,name);reports.push(name);console.log('PASS '+name)}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let view='model'
const overlay=new OverlayController({desktop:process.env.DSH_DESKTOP_EXECUTABLE,settingsPath:settings,view:()=>view,style:()=>styleFor({theme:'dark',accent:'teal',layout:'full',skin:'builtin'}),warn:message=>console.error(message)})
if(!visible)overlay.captureCount=1 // acknowledged hiding is re-applied before every fresh display starts
const manager=new OverlayManagement(overlay)
// Confirmed display must reject an active hide/capture gate, not report false success.
const show=async()=>{if(visible)return manager.command('show');await assert.rejects(manager.command('show'),/Display confirmation canceled|Display confirmation canceled\.|display.*confirm|capture/i)}
try {
 const initial=await manager.getState();check(!overlay.child&&initial.phase==='not-started','Opening management does not spawn a display/helper')
 await manager.updatePreferences({widthDip:530,opacity:.75},initial.revision)
 check(!overlay.child,'Offline size/opacity save does not spawn a display/helper')
 await overlay.start({hidden:true});check(overlay.protocolVersion===3&&overlay.capabilities.management,'Native v3 handshake declares management capabilities')
 check(!(await manager.getState()).visible,'Cold model load starts hidden')
 await show();await sleep(350)
 check((await manager.getState()).visible===visible,'Explicit show obeys user intent and capture gate')
 const active=await overlay.command({kind:'metrics'});check(active.activeModels===1&&active.stagedModels===0,'Exactly one active model, no staged model after startup')
 await manager.command('hide');await sleep(100)
 const hidden1=await overlay.command({kind:'metrics'});await sleep(450);const hidden2=await overlay.command({kind:'metrics'})
 check(hidden1.rendered===hidden2.rendered,'Hidden model performs zero continuous draws')
 await show()
 if(visible){
   await sleep(2400);const idle1=await overlay.command({kind:'metrics'});await sleep(1000);const idle2=await overlay.command({kind:'metrics'})
   const count=idle2.rendered-idle1.rendered;check(count>=45&&count<=65,'Visible idle model targets 60 FPS ('+count+' frames/sec)')
 }
 for(let n=0;n<3;n++){
   await manager.command('reloadModel');const metrics=await overlay.command({kind:'metrics'})
   check(metrics.activeModels===1&&metrics.stagedModels===0,'Model reload '+(n+1)+' releases previous/staged model')
 }
 const before=(await manager.getState()).preferences.modelPath
 await assert.rejects(overlay.command({kind:'load-model',modelPath:join(root,'missing.model3.json'),profilePath:null}))
 check((await manager.getState()).modelLoaded,'Invalid new model leaves the old model usable')
 check((await manager.getState()).preferences.modelPath===before,'Invalid new model does not overwrite the saved selection')
 const revision=(await manager.getState()).revision
 await manager.updatePreferences({widthDip:610,opacity:.85,x:-1700,y:40},revision)
 check((await manager.getState()).preferences.opacity===.85,'Live size/opacity/negative-origin position round-trip')
 await manager.command('beginAdjust');check((await manager.getState()).adjusting,'Adjustment mode is reported')
 await manager.command('endAdjust');await sleep(100);await manager.store.queue
 check(!(await manager.getState()).adjusting,'End adjustment saves through Node, not a second native writer')
 view='keyboard';await manager.command({type:'setDisplayView',view,revision:(await manager.getState()).revision});await sleep(100);check((await manager.getState()).renderer==='keyboard','Existing Host view setting switches to the keyboard')
 view='model';await manager.command({type:'setDisplayView',view,revision:(await manager.getState()).revision});await sleep(100);check((await manager.getState()).renderer==='live2d','Switching back uses the loaded model')
 await manager.command('preview');check(!manager.manualPreview&&overlay.state===overlay.previewState,'Manual preview completes and restores pre-preview channel')
 await overlay.stopDisplay();check(!overlay.child,'Stopping display closes its owned process')
 await manager.command('preview');check(!overlay.child&&overlay.dead,'A preview-only startup retires its owned display')
 await show();check(visible?overlay.ready:!overlay.child,'Explicit show restarts only the display; blocked confirmed shows retire temporary startup')
} finally {
 await manager.close();await overlay.close()
 await fs.writeFile(join(root,visible?'report-visible.json':'report-hidden.json'),JSON.stringify({visible,checks:reports,settings,realDesktopCaptured:false,realInputInjected:false},null,2))
}
console.log('Native UI checks passed. No desktop capture or input helper was used.')
