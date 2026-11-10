import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
const root=dirname(dirname(fileURLToPath(import.meta.url)))
export async function desktopDotnet() {
  const qa=join(root,'.qa'),tmp=join(qa,'tmp'),home=join(qa,'dotnet-home'),packages=process.env.NUGET_PACKAGES??join(qa,'nuget')
  for(const path of [tmp,home,packages,join(qa,'nuget-http'),join(qa,'nuget-scratch')])await mkdir(path,{recursive:true})
  const escape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')
  const config=join(qa,'nuget.config'),cache=join(homedir(),'.nuget','packages')
  await writeFile(config,`<?xml version="1.0" encoding="utf-8"?><configuration><packageSources><clear/>${existsSync(cache)?`<add key="existing-local-cache" value="${escape(cache)}"/>`:''}<add key="nuget.org" value="https://api.nuget.org/v3/index.json"/></packageSources></configuration>`)
  const local=join(qa,'dotnet','dotnet.exe')
  return {executable:process.env.DSH_DOTNET??(existsSync(local)?local:'dotnet'),config,
    env:{...process.env,TEMP:tmp,TMP:tmp,DOTNET_CLI_HOME:home,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'true',
      DOTNET_GENERATE_ASPNET_CERTIFICATE:'false',DOTNET_ADD_GLOBAL_TOOLS_TO_PATH:'0',DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE:'true',MSBuildEnableWorkloadResolver:'false',
      NUGET_PACKAGES:packages,NUGET_HTTP_CACHE_PATH:join(qa,'nuget-http'),NUGET_SCRATCH:join(qa,'nuget-scratch')}}
}
