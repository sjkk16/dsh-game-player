import { existsSync } from 'node:fs'
import { dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
// Version-isolated runtime: never replace binaries mapped by a running Host.
export const DESKTOP_RUNTIME_DIRECTORY='runtime/desktop-0.3.10'
export const desktopExecutable=()=>join(dirname(fileURLToPath(import.meta.url)),'..',DESKTOP_RUNTIME_DIRECTORY,'GamePlayer.Desktop.exe')

/**
 * Use the installed framework host for the bundled framework-dependent app.
 * Workspace EXEs can inherit a Low mandatory label and therefore launch at
 * Low integrity even from a normal user Host. Such a process cannot write the
 * user's Medium-integrity AppData. Hosting the same DLL with system dotnet
 * preserves the caller's normal security context; it does not elevate or
 * change filesystem ACLs. Never discover a host from PATH or our QA SDK.
 */
export function desktopLaunch(executable, args = [], { platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()
  if (platform === 'win32' && same(executable, desktopExecutable())) {
    const dll = join(dirname(executable), 'GamePlayer.Desktop.dll')
    const config = join(dirname(executable), 'GamePlayer.Desktop.runtimeconfig.json')
    if (exists(dll) && exists(config)) {
      for (const base of new Set([env.ProgramW6432, env.ProgramFiles])) {
        if (typeof base !== 'string' || !/^[a-z]:[\\/]/i.test(base) || !win32.isAbsolute(base)) continue
        const host = join(base, 'dotnet', 'dotnet.exe')
        if (exists(host)) return { command: host, args: [dll, ...args] }
      }
    }
  }
  // Custom executables and portable deployments keep the existing contract.
  return { command: executable, args: [...args] }
}
