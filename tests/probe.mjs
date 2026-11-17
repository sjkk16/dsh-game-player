import { PwshBridge } from '../src/pwsh-bridge.js'
const bridge = new PwshBridge()
try {
  const probe = await bridge.request({ op: 'probe' })
  console.log(JSON.stringify({ ok: probe.ok, primary: probe.primary, virtual: probe.virtual, heldKeys: probe.heldKeys, heldButtons: probe.heldButtons, nativeSize: probe.nativeSize }, null, 2))
  try { await bridge.request({ op: '中文协议探测😀' }) }
  catch (error) {
    if (!error.message.includes('中文协议探测😀')) throw new Error('UTF-8 echo failed: ' + error.message)
    console.log('UTF-8 round trip: OK (unsupported operation; no input or capture)')
  }
  const child = bridge.child
  const exit = new Promise((resolve) => child.once('exit', resolve))
  child.stdin.end()
  await exit
  if (bridge.running) throw new Error('Bridge still running after EOF')
  console.log('EOF lifecycle: OK')
} finally { await bridge.close() }
