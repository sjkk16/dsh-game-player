// Independent Windows Node supervisor. Legacy powershell.exe exits immediately
// under DETACHED_PROCESS, so detach this Node host and launch its PowerShell child
// normally. The child inherits only this channel; ParentPid remains the plugin PID.
import { spawn } from 'node:child_process'
const [powershell, ...args] = process.argv.slice(2)
const child = spawn(powershell, args, { windowsHide: true, stdio: [0, 1, 2] })
child.on('error', (error) => { console.error(`watchdog launcher: ${error.message}`); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
