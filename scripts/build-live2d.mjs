import { desktopDotnet } from './desktop-dotnet.mjs'
import { DESKTOP_RUNTIME_DIRECTORY } from '../src/desktop-runtime.js'
// Offline build: never downloads SDKs or models. The official SDK archive is
// acquired separately, with its license, then verified here against our pin.
import { readFile,writeFile,mkdir,copyFile,readdir,cp,access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join,resolve,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const args=process.argv.slice(2),sdk=resolve(args.includes('--sdk')?args[args.indexOf('--sdk')+1]:join(root,'.qa/sdk/CubismSdkForWeb-5-r.5'))
const pin={version:'CubismSdkForWeb-5-r.5',archiveSha256:'67064a7fb1812cf502f5c4a03bfe12cc638c75a621bb4acf06bb28763df06ba0',coreSha256:'8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47'}
const hash=b=>createHash('sha256').update(b).digest('hex')
const archive=await readFile(sdk+'.zip').catch(()=>{throw Error('Place the official R5 ZIP next to its extracted SDK directory. See the Live2D build section in README.md.')})
if(hash(archive)!==pin.archiveSha256)throw Error('SDK archive does not match pinned official R5 release')
const core=await readFile(join(sdk,'Core/live2dcubismcore.min.js'))
if(hash(core)!==pin.coreSha256)throw Error('Core changed from pinned SDK')
const pinnedFiles=JSON.parse(await readFile(join(root,'scripts/sdk-files.json'),'utf8'));for(const [file,digest] of Object.entries(pinnedFiles))if(hash(await readFile(join(sdk,file)))!==digest)throw Error('Framework differs from pinned release: '+file)
const web=join(root,'desktop/web');await mkdir(join(web,'vendor'),{recursive:true});await mkdir(join(web,'shaders'),{recursive:true})
await writeFile(join(web,'vendor/live2dcubismcore.min.js'),core)
await build({entryPoints:[join(root,'desktop/renderer.js')],outfile:join(web,'renderer.js'),bundle:true,platform:'browser',format:'iife',target:'chrome120',alias:{'@cubism':join(sdk,'Framework/src')},legalComments:'eof',minify:false})
for(const name of await readdir(join(sdk,'Framework/Shaders/WebGL')))await copyFile(join(sdk,'Framework/Shaders/WebGL',name),join(web,'shaders',name))
const out=resolve(process.env.DSH_DESKTOP_OUTPUT??join(root,DESKTOP_RUNTIME_DIRECTORY))
if(out!==join(root,DESKTOP_RUNTIME_DIRECTORY)&&!out.startsWith(join(root,'.qa')+'\\'))throw Error('Staged desktop output must stay inside this project QA directory')
const dotnet=await desktopDotnet()
const restored=spawnSync(dotnet.executable,['restore',join(root,'desktop/GamePlayer.Desktop.csproj'),'--locked-mode','--configfile',dotnet.config,'--nologo'],{stdio:'inherit',windowsHide:true,env:dotnet.env})
if(restored.error)throw restored.error;if(restored.status!==0)throw Error('Locked restore failed')
const run=spawnSync(dotnet.executable,['publish',join(root,'desktop/GamePlayer.Desktop.csproj'),'-c','Release','--no-restore','-o',out,'--nologo','-v:q'],{stdio:'inherit',windowsHide:true,env:dotnet.env})
if(run.error)throw run.error;if(run.status!==0)throw Error('Desktop publish failed')
for(const name of ['key-map.json','overlay-layout.json'])await copyFile(join(root,'src',name),join(out,name))
await mkdir(join(out,'licenses'),{recursive:true})
for(const [input,name] of [['LICENSE.md','Live2D-SDK.md'],['NOTICE.md','Live2D-NOTICE.md'],['Core/LICENSE.md','Live2D-Core.md'],['Core/RedistributableFiles.txt','Core-RedistributableFiles.txt'],['Framework/LICENSE.md','Live2D-Framework.md']])await copyFile(join(sdk,input),join(out,'licenses',name))
const nuget=join(dotnet.env.NUGET_PACKAGES,'microsoft.web.webview2/1.0.3650.58');for(const name of ['LICENSE.txt','NOTICE.txt'])await copyFile(join(nuget,name),join(out,'licenses','WebView2-'+name))
await copyFile(join(dotnet.env.NUGET_PACKAGES,'microsoft.windows.sdk.net.ref/10.0.17763.57/microsoft.windows.sdk.net.ref.nuspec'),join(out,'licenses/Windows-SDK-NuGet-notice.xml'))
await writeFile(join(out,'live2d-build.json'),JSON.stringify({...pin,frameworkBundled:true,webview2:'1.0.3650.58',rendererSha256:hash(await readFile(join(web,'renderer.js')))},null,2))
console.log('Built local desktop runtime. A Core render test is still required; this is not visual acceptance.')
