import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {CursorProgress} from '../desktop/cursor-progress.js'
const start=(p,extra={})=>p.control({token:'a',enabled:true,floor:0,...extra},'a')
test('no progress is emitted before native opt-in',()=>{const p=new CursorProgress();assert.equal(p.update(0,'a',0,1,true),null)})
test('progress is paced by elapsed time, not incoming events',()=>{const p=new CursorProgress();start(p);assert.ok(p.update(0,'a',0,1,true));for(let n=1;n<250;n++)assert.equal(p.update(n,'a',0,n+1,true),null);assert.ok(p.update(250,'a',0,251,true))})
test('receipts contain identities and frame counts, never coordinates',()=>{const p=new CursorProgress();start(p);assert.deepEqual(p.update(0,'a',4,8,true),{kind:'cursor-gaze-progress',token:'a',sequence:4,frame:8})})
test('hidden and wrong-model draws cannot emit progress',()=>{const p=new CursorProgress();start(p);assert.equal(p.update(0,'a',1,1,false),null);assert.equal(p.update(0,'old',1,1,true),null)})
test('resume fence reports readiness even if the first target is lost',()=>{const p=new CursorProgress();start(p,{floor:20});assert.equal(p.update(0,'a',3,1,true).sequence,20)})
test('duplicate control does not restart cadence',()=>{const p=new CursorProgress();start(p);p.update(0,'a',0,1,true);assert.equal(start(p),false);assert.equal(p.update(1,'a',0,2,true),null)})
test('stop, reset and malformed controls cannot resurrect a previous scene',()=>{const p=new CursorProgress();start(p);p.control({token:'a',enabled:false,floor:2},'a');assert.equal(p.update(300,'a',2,2,true),null);assert.equal(start(p,{floor:NaN}),false);assert.equal(start(p,{token:'old'}),false);start(p);p.reset();assert.equal(p.update(1000,'a',3,3,true),null)})
test('progress uses no additional timers or input state and sampling is Normal priority',async()=>{const source=await readFile('desktop/cursor-progress.js','utf8');assert.doesNotMatch(source,/requestAnimationFrame|setInterval|setTimeout|stateAt|stopMotion/);const native=await readFile('desktop/DisplayCursorGaze.cs','utf8');assert.match(native,/DispatcherPriority.Normal/);assert.doesNotMatch(native,/DispatcherPriority.Background/);assert.match(native,/cursorCadence.Due/);const command=await readFile('desktop/DisplayCommands.cs','utf8');assert.ok(!command.includes('case "cursor-gaze-progress"'));assert.ok(command.includes('case "qa-cursor-channel"'))})
