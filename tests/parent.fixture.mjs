// Owned offline fixture: recording backend only; the parent test kills this process.
import { PwshBridge } from '../src/pwsh-bridge.js'
const bridge=new PwshBridge({recording:true,recordingLog:process.argv[2],timeoutMs:15000})
await bridge.request({op:'input',ownerId:1,maxHoldMs:60000,actions:[{kind:'keydown',keys:['shift']}]})
console.log(JSON.stringify({worker:bridge.child.pid,guard:bridge.guardChild.pid}))
process.stdin.on('data', () => process.exit(91)) // deliberate crash: no bridge.close()/finally
process.stdin.resume()
setInterval(()=>{},1000)
