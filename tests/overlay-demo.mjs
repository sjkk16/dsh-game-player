// Display-only manual demo. No helper, capture, physical input or user key listener.
import { OverlayController } from '../src/overlay.js'
const overlay=new OverlayController({warn:console.warn})
process.once('SIGINT',()=>void overlay.close())
process.once('SIGTERM',()=>void overlay.close())
overlay.simulate([
    {kind:'hold',keys:['w','lshift'],holdMs:900},{kind:'wait',durationMs:250},
    {kind:'key',keys:['ctrl','s']},{kind:'click',button:'left',count:2},
    {kind:'drag',button:'right',fromX:0,fromY:0,x:100,y:100,steps:20},
    {kind:'scroll',amount:-120},{kind:'hold',keys:['space'],holdMs:600},
    {kind:'type',text:'演示文本不在面板展示'}
],1,3000)
await overlay.starting
if(!overlay.ready){console.error(overlay.lastError??'Overlay did not start.');process.exitCode=1;await overlay.close()}
else console.log('SIMULATION ONLY: adjust, hide or close the panel from the system tray. No real input is sent.')
