import {test} from 'node:test'
import assert from 'node:assert/strict'
import {FrameScheduler} from '../desktop/frame-scheduler.js'
function clock(hz=60){let now=0,id=0;const jobs=new Map(),canceled=[],period=1000/hz;return {now:()=>now,requestFrame:fn=>{const key=++id;jobs.set(key,{at:(Math.floor((now+.001)/period)+1)*period,fn});return key},cancelFrame:id=>{canceled.push(jobs.get(id)?.fn);jobs.delete(id)},advance(ms){const end=now+ms;for(;;){const next=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end+.001)break;now=Math.max(now,next[1].at);jobs.delete(next[0]);next[1].fn(now)}now=Math.max(now,end)},stall(ms){now+=ms},jobs,canceled}}
test('hidden scheduler performs zero draws and idle stays capped at 60 FPS after two seconds',()=>{
 const c=clock(),frames=[],s=new FrameScheduler((now,dt)=>frames.push([now,dt]),c)
 s.touch();c.advance(5000);assert.equal(frames.length,0)
 s.setVisible(true);s.touch();c.advance(1000);assert.ok(frames.length>=59&&frames.length<=61)
 c.advance(3000);const count=frames.length;c.advance(1000);assert.ok(frames.length-count>=59&&frames.length-count<=61)
 s.setVisible(false);const hidden=frames.length;c.advance(10000);assert.equal(frames.length,hidden);assert.equal(c.jobs.size,0)
 s.setVisible(true);c.advance(17);assert.equal(frames.at(-1)[1],0);s.dispose();assert.equal(c.jobs.size,0)
})
test('thousands of activity/animation events retain a single request without rescheduling storms',()=>{
 const c=clock();let frames=0;const s=new FrameScheduler(()=>frames++,c);s.setVisible(true)
 for(let i=0;i<1000;i++){s.touch();s.setAnimating(i%2===0);c.advance(1);assert.equal(c.jobs.size,1)}
 assert.ok(frames>=59&&frames<=61);s.dispose()
})
for(const hz of [60,120,144,240])test('display refresh '+hz+' Hz yields sixty model frames per second without drift',()=>{
 const c=clock(hz);let frames=0;const s=new FrameScheduler(()=>frames++,c);s.setVisible(true);c.advance(60000);assert.ok(frames>=3599&&frames<=3601,String(frames));s.dispose()
})
test('eight milliseconds spent drawing is not followed by another full-frame sleep',()=>{
 const c=clock();let frames=0;const s=new FrameScheduler(()=>{frames++;c.stall(8)},c);s.setVisible(true);c.advance(1000);assert.ok(frames>=59&&frames<=61,String(frames));s.dispose()
})
test('missed deadlines are skipped, long blocking is capped and no catch-up burst is queued',()=>{
 const c=clock(),frames=[],s=new FrameScheduler((now,dt)=>frames.push([now,dt]),c);s.setVisible(true);c.advance(17);c.stall(10000);c.advance(1);assert.equal(frames.length,2);assert.equal(frames[1][1],.1);assert.equal(c.jobs.size,1);c.advance(1000);assert.ok(frames.length<=63);s.dispose()
})
test('late canceled callbacks cannot draw or erase the replacement request',()=>{
 const c=clock(),frames=[],s=new FrameScheduler((_,dt)=>frames.push(dt),c);s.setVisible(true);s.setVisible(false);s.setVisible(true);c.canceled[0]();assert.equal(frames.length,0);assert.equal(c.jobs.size,1);c.advance(17);assert.deepEqual(frames,[0]);s.dispose();c.canceled.at(-1)();assert.equal(frames.length,1)
})
test('hidden animation cannot allocate a timer and resume does not advance hidden time',()=>{
 const c=clock(),dt=[],s=new FrameScheduler((_,v)=>dt.push(v),c);s.setAnimating(true);c.advance(60000);assert.equal(c.jobs.size,0);s.setVisible(true);c.advance(17);assert.equal(dt[0],0);s.dispose()
})
test('legacy injected timers keep the public interface and deadline-based cadence',()=>{
 let now=0,id=0;const jobs=new Map(),frames=[],clock={now:()=>now,setTimer:(fn,ms)=>{jobs.set(++id,{fn,at:now+ms});return id},clearTimer:id=>jobs.delete(id)},s=new FrameScheduler((_,dt)=>{frames.push(dt);now+=8},clock);s.setVisible(true)
 for(let i=0;i<60;i++){const [id,job]=jobs.entries().next().value;jobs.delete(id);now=job.at;job.fn()}
 assert.equal(frames[0],0);assert.ok(now<1000);assert.ok(frames.slice(1).every(dt=>Math.abs(dt-1/60)<1e-8));s.dispose()
})
test('drawing faults cancel the loop rather than repeating every frame',()=>{const c=clock(),s=new FrameScheduler(()=>{throw Error('lost')},c);s.setVisible(true);assert.throws(()=>c.advance(17),/lost/);assert.equal(c.jobs.size,0);assert.equal(s.visible,false)})
