// Safe renderer/layout structure and event tests: no WebView process or OS input.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import vm from 'node:vm'
import {displayText} from '../src/live2d/adapter.js'
import {actorText} from '../src/live2d/control-labels.js'
import {InputDisplayDiagnostics} from '../src/input-display-diagnostics.js'
const root=new URL('../',import.meta.url),read=name=>readFile(new URL(name,root),'utf8')
const [css,html,source,native]=await Promise.all(['desktop/web/style.css','desktop/web/index.html','desktop/renderer.js','desktop/DisplayCommands.cs'].map(read))
assert.match(css,/grid-template-rows:28px minmax\(0,1fr\) 48px/)
assert.match(css,/#status-panel\{[^}]*overflow-x:hidden;overflow-y:auto/)
assert.doesNotMatch(css,/max-height:35%/)
assert.match(css,/body\.warning footer\{order:-1/)
assert.match(css,/body\.hide-model-info footer\{visibility:hidden\}/)
assert.match(css,/header\{[^}]*text-overflow:ellipsis/)
const panel=html.match(/<section id="status-panel"[^>]*>(.*?)<\/section>/s)?.[1]
assert.ok(panel&&panel.includes('id="control-notes"')&&panel.includes('<footer>'),'all status content shares the fixed slot')
assert.ok(!panel.includes('<canvas'),'status cannot contain the model')
assert.match(html,/<main><canvas id="model"><\/canvas><canvas id="hands"><\/canvas><\/main>/)
const nativeQa=native.slice(native.indexOf('async Task QaLayout('),native.indexOf('void Ack('))+native.slice(native.indexOf('case "qa-layout":'),native.indexOf('case "qa-run":'))
assert.match(nativeQa,/if\(!qa\|\|!qaInteractive\)/)
assert.match(nativeQa,/double\.IsFinite\(qaWidth\).*qaWidth<220\|\|qaWidth>1000/)
assert.match(nativeQa,/Emulation\.setDeviceMetricsOverride/)
assert.match(nativeQa,/double\.IsFinite\(qaHeight\).*qaHeight<120\|\|qaHeight>2000/)
assert.match(nativeQa,/height=\(int\)qaHeight/)
assert.doesNotMatch(nativeQa,/settings\.|\.Save\(|SendInput|SetCursorPos/)
let now=0,listener;const elements=new Map(),classes=new Set(),renders=[]
const element=id=>{
 if(!elements.has(id))elements.set(id,{textContent:'',title:'',attrs:{},scrollTop:0,scrollHeight:48,scrollWidth:231,clientWidth:231,clientHeight:id==='#status-panel'?48:231,width:0,height:0,
  style:{setProperty(){}},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},addEventListener(){},getContext(){return {clearRect(){}}},
  getBoundingClientRect(){return {x:4,y:id==='#status-panel'?263:32,width:this.clientWidth,height:this.clientHeight}}})
 return elements.get(id)
}
element('#identity').clientHeight=28;element('#model').clientHeight=231;element('#hands').clientHeight=231
const doc={querySelector:element,documentElement:{clientWidth:239,clientHeight:315,scrollWidth:239},body:{style:{setProperty(){}},classList:{toggle:(k,on)=>on?classes.add(k):classes.delete(k),contains:k=>classes.has(k)}}}
class Scheduler{constructor(){this.visible=false}touch(){}setVisible(v){this.visible=v}setAnimating(){}dispose(){}}
const context=vm.createContext({document:doc,window:{chrome:{webview:{postMessage(){},addEventListener:(type,cb)=>{listener=cb}}},addEventListener(){}},performance:{now:()=>now},devicePixelRatio:1.5,ResizeObserver:class{observe(){}disconnect(){}},InputDisplayDiagnostics,FrameScheduler:Scheduler,CursorProgress:class{update(){return null}},actorText,displayText,setTimeout:()=>0,clearTimeout(){},getComputedStyle:e=>({display:e===element('#control-notes')&&!e.textContent?'none':'block',visibility:(e===element('footer')&&classes.has('hide-model-info')&&!classes.has('warning')||e===element('#capabilities')&&classes.has('hide-model-info'))?'hidden':'visible'}),console})
vm.runInContext(source.replace(/^import .*$/gm,'')+'\nglobalThis.fixture={draw,privateDiagnostics,setActive:s=>{active=s}}',context,{filename:fileURLToPath(new URL('desktop/renderer.js',root))})
const scene={manifest:{token:'fixture',qa:true},pose:{missing:[]},cursorGaze:{sequence:0},update(){},stopMotion(){},takeCompletion(){return null},rememberState(){},render:(w,h)=>renders.push([w,h]),qaSnapshot:()=>({projection:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]})}
context.fixture.setActive(scene)
const state=extra=>({kind:'state',mode:'simulation',status:'ready',keys:[],buttons:[],pulses:[],activated:false,controlMode:'adaptive',lastActor:'human',...extra}),send=data=>listener({data})
for(const value of [state({keys:['ctrl','shift','a'],buttons:['left'],moveMs:100}),state(),state({externalInput:true,humanError:'很长的提示 '.repeat(100)}),state({status:'unknown'}),state({status:'locked'})]){send(value);context.fixture.draw(now,0)}
assert.ok(renders.every(pair=>pair[0]===347&&pair[1]===347),'status changes cannot resize the draw buffers')
assert.equal(element('#model').width,element('#hands').width)
element('#status-panel').scrollTop=90;send(state());send(state({status:'unknown'}));assert.equal(element('#status-panel').scrollTop,0,'new warning resets stale scroll')
element('#status-panel').scrollTop=12;send(state({status:'unknown'}));assert.equal(element('#status-panel').scrollTop,12,'unchanged warning does not fight scrolling')
send({kind:'display-preferences',modelInfoVisible:false});send(state({externalInput:true}));assert.equal(element('footer').attrs['aria-hidden'],'true');assert.match(element('#control-notes').textContent,/外部输入/)
send(state({status:'locked'}));assert.equal(element('footer').attrs['aria-hidden'],'false');assert.equal(element('#capabilities').attrs['aria-hidden'],'true')
send({kind:'display-preferences',modelInfoVisible:true});send(state({pulses:[{id:'key:a',ms:30}]}));assert.match(element('#activity').textContent,/已释放/);context.fixture.draw(now,0);now=100;context.fixture.draw(now,0);assert.doesNotMatch(element('#activity').textContent,/已释放/)
assert.ok(renders.every(pair=>pair[0]===347&&pair[1]===347),'afterglow expiry does not resize')
const snapshot=context.fixture.privateDiagnostics();assert.equal(snapshot.layout.statusPanel.height,48);assert.equal(snapshot.layout.canvas.pixelWidth,347);assert.equal(snapshot.layout.horizontalOverflow,false)
console.log('Model viewport regression passed: fixed slots, long text, warning priority/scroll, expiry, hidden info and private diagnostics; no native input or desktop capture.')
