import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { desktopDotnet } from './desktop-dotnet.mjs'
import { projectRoot } from './validation.mjs'
import { DESKTOP_RUNTIME_DIRECTORY } from '../src/desktop-runtime.js'
const dotnet=await desktopDotnet(),manifest=JSON.parse(await readFile(join(projectRoot,'package.json'),'utf8'))
const runtime=process.argv.includes('--staged')?join(projectRoot,'.qa/fullscreen-0.3.11/runtime'):join(projectRoot,DESKTOP_RUNTIME_DIRECTORY)
const result=spawnSync(dotnet.executable,[join(runtime,'GamePlayer.Desktop.dll'),'--qa-control-selftest','true'],{encoding:'utf8',timeout:30000,windowsHide:true,env:dotnet.env})
assert.ifError(result.error);assert.equal(result.status,0,result.stderr||result.stdout)
const output=JSON.parse(result.stdout.trim());assert.equal(output.ok,true);assert.ok(output.rawKeyboardChecks>=75)
assert.ok(output.version.startsWith(manifest.version+'.'),'Rebuild the current native runtime before testing')
assert.equal(output.hooksInstalled,false);assert.equal(output.inputInjected,false)
console.log(JSON.stringify(output,null,2))

if(process.argv.includes('--receiver-smoke')){
  const smoke=spawnSync(dotnet.executable,[join(runtime,'GamePlayer.Desktop.dll'),'--qa-keyboard-receiver','true'],{encoding:'utf8',timeout:30000,windowsHide:true,env:dotnet.env})
  assert.ifError(smoke.error);assert.equal(smoke.status,0,smoke.stderr||smoke.stdout)
  const value=JSON.parse(smoke.stdout.trim());assert.equal(value.ok,true);assert.equal(value.backgroundRegistered,true);assert.equal(value.registrationRemoved,true);assert.equal(value.messageWindowHidden,true)
  console.log(JSON.stringify(value,null,2))
}
