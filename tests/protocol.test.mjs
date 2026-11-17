import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeKeys, normalizeAction, normalizeText, validateBudget } from '../src/keys.js'
import { screenTool, inputTool } from '../src/tools.js'
import { createImageDemand } from '../src/watch.js'
const options = { maxWidth: 1280, jpegQuality: 60, monitor: 'primary', watchThreshold: 0.03, maxHoldMs: 3000, helperTimeoutMs: 15000 }
test('one flat chord, aliases, duplicates and supported names', () => {
  assert.deepEqual(normalizeKeys(['ctrl', 's']), ['ctrl','s'])
  assert.deepEqual(normalizeKeys(['Ctrl+Shift+S']), ['ctrl','shift','s'])
  assert.deepEqual(normalizeKeys(['Control','Return']), ['ctrl','enter'])
  for (const value of [['ctrl','control'], ['ctrl+s','enter','shift','alt'], [['ctrl']], ['banana'], ['ctrl+']]) assert.throws(() => normalizeKeys(value))
})
test('finite integers, buttons, text controls and Unicode scalars', () => {
  for (const x of [NaN,Infinity,1.5,null,'4']) assert.throws(() => normalizeAction({ kind: 'move', x, y: 2 }))
  for (const kind of ['down','up','click','drag']) assert.throws(() => normalizeAction({kind, button:'banana', x:0, y:0, fromX:0, fromY:0}))
  for (const amount of [NaN,Infinity,'2',0]) assert.throws(() => normalizeAction({kind:'scroll',amount}))
  for (const text of ['a\nb','a\tb','a\x7fb','\uD800','\uDC00']) assert.throws(() => normalizeText(text))
  assert.equal(normalizeText('中文😀'), '中文😀')
})
test('batch budget excludes cleanup margin and rejects long type or summed holds', () => {
  assert.throws(() => validateBudget([{ kind:'type', text:'x'.repeat(2000) }],15000), /budget/)
  assert.throws(() => validateBudget(Array.from({length:5}, () => ({kind:'hold',holdMs:3000})),15000), /budget/)
  assert.equal(validateBudget([{kind:'hold',holdMs:3000}],15000),3100)
})
test('negative-origin, rounded-height geometry and consistent rendered formula', async () => {
  const screen = screenTool({ options, capture: async () => ({width:1280,height:431,screenWidth:3840,screenHeight:1294,screenX:-1920,screenY:-67,scale:1/3,diff:1,cursor:{x:-960,y:100}}), attach: async () => ({attachmentId:'a',mediaType:'image/jpeg',bytes:2,width:1280,height:431}) })
  const value = await screen.execute({}, {agent:{id:'a'}})
  assert.equal(value.screenX,-1920); assert.equal(value.screenY,-67)
  const text = screen.output.render({},value).filter(b=>b.type==='text').map(b=>b.text).join('\n')
  assert.match(text,/1294 \/ 431/); assert.match(text,/origin \(-1920, -67\)/)
  assert.match(screen.description,/screenX \+ round/)
  await assert.rejects(screen.execute({monitor:'bad'}, {}),/monitor/)
})
test('wake forces image, attachment failure retains demand, and newer wake survives consumption', async () => {
  const demand = createImageDemand(); demand.mark('a')
  let fail = true, marked = false, captured
  const screen = screenTool({ options, imageDemand:demand, capture: async (request) => {captured=request;return {width:10,height:10,screenWidth:20,screenHeight:20,screenX:0,screenY:0,scale:.5,diff:0}}, attach: async()=> {
    if(fail) throw new Error('store failed')
    if(!marked) {marked=true;demand.mark('a')}
    return {attachmentId:'a',mediaType:'image/jpeg',bytes:2,width:10,height:10}
  }})
  await assert.rejects(screen.execute({}, {agent:{id:'a'}}),/store failed/)
  assert.ok(demand.current('a')); fail=false
  assert.equal((await screen.execute({}, {agent:{id:'a'}})).attached,true)
  assert.ok(demand.current('a'))
  assert.equal((await screen.execute({}, {agent:{id:'a'}})).attached,true)
  assert.equal(demand.current('a'),undefined)
  assert.equal(captured.consumerId,'screen:a')
  assert.equal((await screen.execute({}, {agent:{id:'a'}})).attached,false)
})
test('validated input uses the provided transport; invalid or canceled batches never send', async () => {
  const sent=[]
  const tool=inputTool({options,normalize:normalizeAction,send:async request=>{sent.push(request);return {cursor:{x:4,y:5},heldKeys:[],heldButtons:[]}}})
  const value=await tool.execute({kind:'key',keys:['ctrl','s']},{})
  assert.equal(value.ok,true); assert.match(value.actions[0],/ctrl\+s/); assert.equal(sent.length,1)
  assert.deepEqual(sent[0].actions,[normalizeAction({kind:'key',keys:['ctrl','s']},options.maxHoldMs)])
  assert.deepEqual([value.cursorX,value.cursorY],[4,5]);assert.equal(Object.hasOwn(value,'dryRun'),false)
  assert.equal(Object.hasOwn(tool.output.schema.properties,'dryRun'),true)
  await assert.rejects(tool.execute({actions:[{kind:'keydown',keys:['w']},{kind:'type',text:'\n'}]},{}),/control/)
  const canceled=new AbortController();canceled.abort()
  await assert.rejects(tool.execute({kind:'key',keys:['w']},{signal:canceled.signal}),/canceled/)
  assert.equal(sent.length,1)
})

test('missing origin or canceled attachment is rejected without consuming image demand',async()=>{
  const demand=createImageDemand();demand.mark('a');const controller=new AbortController()
  const frame={width:10,height:10,screenWidth:20,screenHeight:20,screenX:0,screenY:0,scale:.5,diff:0}
  const missing=screenTool({options,imageDemand:demand,capture:async()=>({...frame,screenX:undefined}),attach:async()=>{throw new Error('must not attach')}})
  await assert.rejects(missing.execute({}, {agent:{id:'a'}}),/geometry/)
  const canceled=screenTool({options,imageDemand:demand,capture:async()=>frame,attach:async()=>{controller.abort();return {attachmentId:'a'}}})
  await assert.rejects(canceled.execute({}, {agent:{id:'a'},signal:controller.signal}),e=>e.code==='ABORTED')
  assert.ok(demand.current('a'))
})

test('historical simulation receipts remain marked and legacy options cannot restore simulation',async()=>{
  let sends=0
  const tool=inputTool({options:{...options,dryRun:true},normalize:normalizeAction,send:async()=>{sends++;return{}}})
  const legacy={ok:true,actions:['w (dry run)'],cursorX:0,cursorY:0,heldKeys:[],heldButtons:[],dryRun:true}
  const rendered=tool.output.render({},legacy).map(block=>block.text).join('\n')
  assert.match(rendered,/Dry run: nothing was injected/)
  const current=tool.output.render({},{...legacy,actions:['w'],dryRun:undefined}).map(block=>block.text).join('\n')
  assert.doesNotMatch(current,/Dry run/);assert.equal(sends,0)
  const value=await tool.execute({kind:'key',keys:['w']},{})
  assert.equal(sends,1);assert.equal(value.ok,true);assert.equal(Object.hasOwn(value,'dryRun'),false)
})
