import {test} from 'node:test'
import assert from 'node:assert/strict'
import {dirname,join} from 'node:path'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {desktopExecutable,desktopLaunch} from '../src/desktop-runtime.js'
import {desktopUtility} from '../src/overlay-management.js'
const exe=desktopExecutable(),dll=join(dirname(exe),'GamePlayer.Desktop.dll'),config=join(dirname(exe),'GamePlayer.Desktop.runtimeconfig.json')
const base='C:\\Program Files',host=join(base,'dotnet','dotnet.exe')
function options(files=[dll,config,host],env={ProgramFiles:base}) {return {platform:'win32',env,exists:path=>files.includes(path)}}
test('bundled app uses the installed framework host with separate DLL and Unicode path arguments',()=>{
 const args=['--parent','123','--settings','C:\\用户目录\\桌宠 配置.json'],copy=[...args]
 assert.deepEqual(desktopLaunch(exe,args,options()),{command:host,args:[dll,...args]});assert.deepEqual(args,copy)
})
test('framework hosting preserves a differently cased bundled executable path',()=>{
 const other=exe.toUpperCase(),managed=join(dirname(other),'GamePlayer.Desktop.dll'),runtime=join(dirname(other),'GamePlayer.Desktop.runtimeconfig.json')
 assert.equal(desktopLaunch(other,[],options([managed,runtime,host])).command,host)
})
test('launcher never uses PATH or a QA DOTNET_ROOT',()=>{
 const result=desktopLaunch(exe,[],options([dll,config,host],{PATH:base,DOTNET_ROOT:'C:\\workspace\\.qa\\dotnet'}))
 assert.deepEqual(result,{command:exe,args:[]})
})
test('custom native executable keeps its previous command contract',()=>{
 const other=join(dirname(exe),'custom.exe'),args=['--pick','model-folder']
 assert.deepEqual(desktopLaunch(other,args,options()),{command:other,args})
})
test('non-Windows launch does not select a Windows framework host',()=>{
 assert.deepEqual(desktopLaunch(exe,['x'],{...options(),platform:'linux'}),{command:exe,args:['x']})
})
for(const [name,files] of [['managed DLL',[config,host]],['runtime configuration',[dll,host]],['installed dotnet',[dll,config]]])test('missing '+name+' retains the portable executable fallback',()=>{
 assert.deepEqual(desktopLaunch(exe,['x'],options(files)),{command:exe,args:['x']})
})
test('invalid relative or network program directories cannot become an installed host',()=>{
 for(const ProgramFiles of ['.qa','\\\\server\\share','C:relative',''])assert.equal(desktopLaunch(exe,[],options([dll,config,join(ProgramFiles,'dotnet','dotnet.exe')],{ProgramFiles})).command,exe)
})
test('native utilities use the same managed launch path without opening a shell',async()=>{
 const expected=desktopLaunch(exe,['--parent',String(process.pid),'--discover-model','C:\\模型 空格\\pet.zip'])
 const result=await desktopUtility(exe,['--discover-model','C:\\模型 空格\\pet.zip'],undefined,(file,args,options)=>{
  assert.equal(file,expected.command);assert.deepEqual(args,expected.args);assert.equal(options.windowsHide,true);assert.equal(options.shell,undefined)
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{}
  queueMicrotask(()=>{child.stdout.write('{"candidates":[]}');child.emit('close',0)})
  return child
 });assert.deepEqual(result,{candidates:[]})
})
