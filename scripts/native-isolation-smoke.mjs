import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { desktopDotnet } from './desktop-dotnet.mjs'
import { DESKTOP_RUNTIME_DIRECTORY } from '../src/desktop-runtime.js'
const root=fileURLToPath(new URL('../',import.meta.url)),qa=join(root,'.qa','native-isolation'),project=join(qa,'project')
await fs.access(join(root,DESKTOP_RUNTIME_DIRECTORY,'GamePlayer.Desktop.dll'))
await fs.mkdir(project,{recursive:true});const data=await fs.mkdtemp(join(qa,'isolated-'))
const csproj='<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0-windows</TargetFramework><UseWPF>true</UseWPF><UseWindowsForms>true</UseWindowsForms><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup></Project>'
const program=String.raw`
using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
int checks=0;void Check(bool value){checks++;if(!value)throw new Exception("Native isolation check "+checks+" failed");}
string data=Path.GetFullPath(args[0]);Directory.CreateDirectory(data);
var assembly=Assembly.LoadFrom(Path.GetFullPath(args[1]));
var storage=assembly.GetType("GamePlayer.Desktop.DesktopStorage",true)!;
var cacheMethod=storage.GetMethod("PrepareCache",BindingFlags.Public|BindingFlags.Static)!;
var cache=((string Root,string Directory))cacheMethod.Invoke(null,new object[]{data,false})!;
Check(Path.GetFullPath(cache.Root)==Path.Combine(data,"webview-cache"));
Check(Path.GetFullPath(cache.Directory).StartsWith(cache.Root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase));
Check(Directory.Exists(cache.Directory));Check(!File.Exists(Path.Combine(cache.Directory,".write-probe")));
var settings=assembly.GetType("GamePlayer.Desktop.OverlaySettings",true)!;
Check(settings.GetProperty("ModelWatermarks")==null);
var model=assembly.GetType("GamePlayer.Desktop.ModelPackage",true)!;
Check(!model.GetMethod("Load")!.GetParameters().Any(p=>p.Name=="watermarks"));
var old=Path.Combine(data,"old-overlay.json");string raw="{\"version\":5,\"revision\":7,\"view\":\"keyboard\",\"controlMode\":\"adaptive\",\"modelInfoVisible\":false,\"modelWatermarks\":{\"old\":{\"mode\":\"hidden\"}}}";File.WriteAllText(old,raw);
var loaded=settings.GetMethod("Load")!.Invoke(null,new object[]{old})!;
Check(File.ReadAllText(old)==raw);Check((string)settings.GetProperty("ControlMode")!.GetValue(loaded)! =="adaptive");
Check((bool)settings.GetProperty("ModelInfoVisible")!.GetValue(loaded)! ==false);
var saved=Path.Combine(data,"saved-overlay.json");settings.GetMethod("Save")!.Invoke(loaded,new object[]{saved});
Check(!JsonNode.Parse(File.ReadAllText(saved))!.AsObject().ContainsKey("modelWatermarks"));
Check(File.ReadAllText(old)==raw);
var blocked=Path.Combine(data,"blocked");File.WriteAllText(blocked,"not a directory");bool rejected=false;
try{cacheMethod.Invoke(null,new object[]{blocked,false});}catch(TargetInvocationException e)when(e.InnerException is IOException){rejected=true;}
Check(rejected);Check(File.ReadAllText(blocked)=="not a directory");
Console.WriteLine(JsonSerializer.Serialize(new{ok=true,checks,nativeCacheVerified=true,legacyRecordsIgnored=true,hooksInstalled=false,inputInjected=false}));
`
await fs.writeFile(join(project,'NativeIsolation.csproj'),csproj);await fs.writeFile(join(project,'Program.cs'),program)
const dotnet=await desktopDotnet()
function run(args){const result=spawnSync(dotnet.executable,args,{cwd:root,env:dotnet.env,encoding:'utf8',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw Error(result.stdout+'\n'+result.stderr);return result.stdout}
try{
 run(['restore',join(project,'NativeIsolation.csproj'),'--configfile',dotnet.config,'--nologo'])
 run(['build',join(project,'NativeIsolation.csproj'),'-c','Release','--no-restore','--nologo','-v:q'])
 const stdout=run([join(project,'bin','Release','net10.0-windows','NativeIsolation.dll'),data,join(root,DESKTOP_RUNTIME_DIRECTORY,'GamePlayer.Desktop.dll')])
 const report=JSON.parse(stdout.trim());assert.equal(report.ok,true);await fs.writeFile(join(qa,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{assert.ok(resolve(data).startsWith(resolve(qa)+sep));await fs.rm(data,{recursive:true,force:true})}
