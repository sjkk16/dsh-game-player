// No default live side effects. Two distinct flags are required for input.
import { PwshBridge } from '../src/pwsh-bridge.js'
const screenshot = process.argv.includes('--allow-screenshot')
const input = process.argv.includes('--allow-input')
if (!screenshot && !input) {
  console.log('SKIP real screenshot: pass --allow-screenshot only after human authorization.')
  console.log('SKIP real keyboard/mouse: pass --allow-input --confirm-input only after human authorization.')
} else {
  if (input && !process.argv.includes('--confirm-input')) throw new Error('Input requires separate --confirm-input authorization.')
  const idIndex=process.argv.indexOf('--window-id')
  const windowId=idIndex>=0?process.argv[idIndex+1]:undefined
  if(input&&!windowId)throw new Error('Live input additionally requires --window-id from an explicit window selection.')
  const bridge = new PwshBridge()
  try {
    if (screenshot) {
      const frame = await bridge.request({ op: 'frame', maxWidth: 640, monitor: 'virtual' })
      console.log('Live capture metadata:', JSON.stringify({ width: frame.width, height: frame.height, screenX: frame.screenX, screenY: frame.screenY, scale: frame.scale }))
    }
    if (input) {
      const window=(await bridge.request({op:'window',windowId})).window
      await bridge.request({ op: 'input', window, ownerId: 1, actions: [{ kind: 'hold', keys: ['shift'], holdMs: 50 }] })
      if (!(await bridge.releaseAll())) throw new Error('Live cleanup unconfirmed; manual recovery required.')
      console.log('Live Shift hold/release complete; game acceptance and host approval remain unverified.')
    }
  } finally { await bridge.close() }
}
