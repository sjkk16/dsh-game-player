import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { desktopDotnet } from './desktop-dotnet.mjs'
import { projectRoot } from './validation.mjs'
import { DESKTOP_RUNTIME_DIRECTORY } from '../src/desktop-runtime.js'
const options=process.argv.slice(2)
assert.ok(options.every(arg=>['--staged','--smoke'].includes(arg)),'Usage: node scripts/renderer-native-regression.mjs [--staged] [--smoke]')
const dotnet=await desktopDotnet(),qa=join(projectRoot,'.qa/webview-0.3.13')
await mkdir(qa,{recursive:true})
const runtime=options.includes('--staged')?join(qa,'runtime'):join(projectRoot,DESKTOP_RUNTIME_DIRECTORY)
const installed=join(process.env.ProgramFiles??'', 'dotnet/dotnet.exe')
const command=existsSync(installed)?installed:dotnet.executable
const project=await readFile(join(projectRoot,'desktop/GamePlayer.Desktop.csproj'),'utf8')
const expected=project.match(/<Version>([^<]+)<\/Version>/)[1]+'.0'
async function run(flag,value,log,smoke=false){
 const result=spawnSync(command,[join(runtime,'GamePlayer.Desktop.dll'),flag,value],{encoding:'utf8',timeout:smoke?60000:30000,windowsHide:true,env:dotnet.env,maxBuffer:4*1024*1024})
 await writeFile(join(qa,log),(result.stdout??'')+'\n--- stderr ---\n'+(result.stderr??''))
 assert.ifError(result.error);assert.equal(result.status,0,(result.stderr||result.stdout).slice(-3500))
 const records=result.stdout.split(/\r?\n/).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}})
 const report=records.find(v=>v.ok===true&&(smoke?v.smoke===true:typeof v.checks==='number'))
 assert.ok(report,'Native check did not return a success report');assert.equal(report.version,expected)
 assert.equal(report.hooksInstalled,false);assert.equal(report.inputInjected,false);assert.equal(report.userSettingsModified,false)
 if(smoke){assert.equal(report.userModelsLoaded,false);assert.equal(report.screenshotsTaken,false)}
 console.log(JSON.stringify(report,null,2));return report
}
const self=await run('--qa-renderer-selftest','true','native-selftest.log')
const smoke=options.includes('--smoke')?await run('--qa-renderer-smoke',await mkdtemp(join(qa,'smoke-')),'native-smoke.log',true):null
await writeFile(join(qa,'renderer-verification.json'),JSON.stringify({self,smoke},null,2))
