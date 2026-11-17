import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapPose,displayText } from '../src/live2d/adapter.js'
import { KEY_MAP } from '../src/keys.js'
import { InputDisplayState,InputPreview,normalizePosition,validPosition } from '../src/overlay-state.js'
const parameters={paw:{min:0,max:2,default:.2},x:{min:-30,max:30,default:1},y:{min:-10,max:10,default:2},l:{min:0,max:1,default:0}}
const profile={bindings:{keyboard:'paw',mouseX:'x',mouseY:'y',left:'l',right:'absent'},hands:[{codes:[65]},{codes:[17,83]}]}
const state=(extra={})=>({status:'ready',mode:'real',keys:[],buttons:[],position:null,...extra})
test('uses actual parameter bounds/defaults, reports unsupported controls',()=>{
 const p=mapPose(state(),parameters,profile);assert.deepEqual(p.values,{paw:.2,x:1,y:2,l:0});assert.deepEqual(p.missing,['right'])
 const q=mapPose(state({keys:['a'],buttons:['left'],position:{x:1,y:0}}),parameters,profile,null,KEY_MAP.keys)
 assert.equal(q.values.paw,2);assert.equal(q.values.x,30);assert.equal(q.values.y,-10);assert.equal(q.values.l,1);assert.equal(q.hand,0)
})
test('release stops hold immediately; afterglow never drives pressed parameters',()=>{
 const q=mapPose(state({pulses:[{id:'key:a',ms:180}]}),parameters,profile)
 assert.equal(q.values.paw,.2);assert.match(displayText(state({pulses:[{id:'key:a',ms:180}]})),/已释放/)
})
test('side-specific modifiers may use generic artwork but labels preserve identity',()=>{
 const q=mapPose(state({keys:['lctrl','s']}),parameters,profile,null,KEY_MAP.keys);assert.equal(q.hand,1)
 assert.match(displayText(state({keys:['lctrl','s']})),/lctrl/)
 assert.match(displayText(state({keys:['ctrl','s']})),/不区分左右/)
})
test('uncertain status freezes last pose and hand rather than releasing',()=>{
 const before=mapPose(state({keys:['a'],buttons:['left']}),parameters,profile,null,KEY_MAP.keys)
 const after=mapPose(state({status:'unknown'}),parameters,profile,before,KEY_MAP.keys)
 assert.deepEqual(after.values,before.values);assert.equal(after.hand,before.hand);assert.equal(after.frozen,true);assert.match(displayText(state({status:'unknown'})),/未|未知/)
})
test('text, middle, wheel and unknown keys remain truthful activity labels',()=>{
 const s=state({textMs:100,text:'PRIVATE',buttons:['middle'],wheelMs:100,wheelDirection:-1,keys:['vk_255']})
 const text=displayText(s);assert.match(text,/输入文本/);assert.match(text,/中键/);assert.match(text,/↓/);assert.match(text,/vk_255/);assert.ok(!text.includes('PRIVATE'))
 assert.equal(mapPose(s,parameters,profile).values.l,0)
})
test('normalized position includes negative-origin screens and clamps safely',()=>{
 assert.deepEqual(normalizePosition(-1920,-80,{x:-1920,y:-80,width:4480,height:1520}),{x:0,y:0})
 assert.deepEqual(normalizePosition(2559,1439,{x:-1920,y:-80,width:4480,height:1520}),{x:1,y:1})
 assert.equal(normalizePosition(1,2,null),null);assert.equal(validPosition({x:Infinity,y:0}),false)
})
test('latest snapshot replaces mouse targets; old/foreign events cannot move model',()=>{
 const s=new InputDisplayState();s.accept({kind:'observation-status',status:'connected',session:'x'})
 const e={kind:'input-observation',session:'x',sequence:1,source:'worker',timestamp:1,ownerId:1,event:'move',device:2,code:0,amount:0,state:0,uncertain:false,heldKeys:[],heldButtons:[],position:{x:.7,y:.2}}
 assert.equal(s.accept(e),true);assert.deepEqual(s.snapshot().position,e.position)
 assert.equal(s.accept({...e,position:{x:0,y:0}}),false);assert.equal(s.accept({...e,sequence:9,session:'old'}),false)
 assert.equal(s.accept({...e,sequence:2,position:{x:3,y:1}}),false)
 s.accept({...e,sequence:3,source:'guard',event:'state',position:null});assert.equal(s.snapshot().position,null)
})
test('display-only preview mouse timeline uses reported bounds and replacement clears target',async()=>{
 const s=new InputDisplayState();const p=new InputPreview(s,()=>{});p.bounds={x:0,y:0,width:101,height:101}
 p.start([{kind:'move',x:25,y:75}]);await p.done;assert.deepEqual(s.position,{x:.25,y:.75})
 p.start([{kind:'key',keys:['w']}]);assert.equal(s.position,null);p.stop();await p.done
})

test('unmapped keys retain the model hand and short releases retain key identity',()=>{
 const p=mapPose(state({keys:['f12']}),parameters,profile,null,KEY_MAP.keys);assert.equal(p.values.paw,.2);assert.equal(p.hand,-1)
 assert.match(displayText(state({pulses:[{id:'key:w',ms:160},{id:'button:right',ms:100}]})),/已释放 w \+ 鼠标右键/)
})
