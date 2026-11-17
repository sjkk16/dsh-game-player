// Actual Core/WebView private canvases only. No desktop capture or real input.
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {idleHarness,neutral} from './idle-render-harness.mjs'
const out=resolve(process.env.DSH_HAND_QA_DIR??'.qa/import-hand-y-0.3.7/hands');await mkdir(out,{recursive:true})
const h=await idleHarness(out),checks=[],reports=[],directionProof=[];let sequence=0
const check=(ok,name)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name)}
const cursor=(token,x,y,valid=true)=>h.call({kind:'qa-cursor',token,sequence:++sequence,valid,...(valid?{x,y}:{})})
const opposite={...neutral,mode:'real',position:{x:0,y:1}}
// Stage every scene from the same non-expiring neutral input; never inherit an
// expired real-state probe or the previous model's physics startup transition.
const loaded=new WeakSet()
const load=async(renderer,c)=>{if(loaded.has(renderer))await renderer.step('neutral-before-load',0,neutral);const catalog=await renderer.load(c);loaded.add(renderer);return catalog}
const audit=sample=>{const d=sample.diagnostics;check(d.nonfiniteVertices===0&&d.glError===0&&d.parameterViewAligned&&d.viewMismatches.length===0,'Finite aligned Core vertices and parameters: '+sample.name);for(const [id,value]of Object.entries(d.cursorHandFollow.values))check(Math.abs(sample.values[id]-value)<1e-4,'Displayed hand owns '+id+': '+sample.name)}
const slim=s=>({name:s.name,values:s.values,pose:s.pose,diagnostics:s.diagnostics,gaze:s.gaze,bounds:s.bounds})
const watchdog=setTimeout(()=>h.child.kill(),300000)
try{
 const cats=h.discover('../cat'),candidates=[...cats,{name:'default',sourcePath:resolve('../Deepseek桌宠')}]
 for(let i=0;i<candidates.length;i++){
  const c=candidates[i],catalog=await load(h,c),token=catalog.modelToken,axes=catalog.adapter.cursorHandFollow.axes
  check(!Object.hasOwn(catalog.adapter.cursorHandFollow,'values'),'Public adapter metadata contains no live cursor-derived positions: '+c.name)
  check(axes.every(a=>a.enabled)&&axes.length===2,'Two real hand axes available: '+c.name)
  check(catalog.adapter.cursorHandFollow.yCorrection===-1,'Built-in correction is preserved and non-default Y base is reversed: '+c.name)
  const first=await h.step('hand-'+i+'-initial',1,opposite);audit(first)
  for(const a of axes)check(Math.abs(first.values[a.id]-catalog.adapter.parameters.find(p=>p.id===a.id).default)<1e-5,'No AI hand movement before system sample: '+c.name+' '+a.role)
  const samples=[]
  for(const [label,x,y]of [['center',0,0],['left',-1,0],['right',1,0],['up',0,1],['down',0,-1],['ul',-1,1],['ur',1,1],['dl',-1,-1],['dr',1,-1]]){
   await cursor(token,x,y);const sample=await h.step('hand-'+i+'-'+label,90,opposite);audit(sample);samples.push(slim(sample))
   for(const a of axes){const p=catalog.adapter.parameters.find(p=>p.id===a.id);let unit=(a.role==='mouseX'?x:y)*a.direction*(a.reverse?-1:1),wanted=p.default+unit*(unit>=0?p.max-p.default:p.default-p.min);check(Math.abs(sample.values[a.id]-wanted)<1e-4,'Authored range and direction: '+c.name+' '+label+' '+a.role)}
   check(JSON.stringify(sample.bounds)===JSON.stringify(first.bounds),'Projection stays fixed: '+c.name+' '+label)
  }
  const projected=await h.step('hand-'+i+'-projection',0,opposite,{projection:{flip:!first.projection.flip,scale:first.projection.scale*.75,offset:[first.projection.offset[0]+8,first.projection.offset[1]-6]}});audit(projected)
  check(projected.diagnostics.projection[0]*first.diagnostics.projection[0]<0&&Math.abs(Math.abs(projected.diagnostics.projection[0]/first.diagnostics.projection[0])-.75)<1e-5,'Scaling and horizontal flip use the existing model projection: '+c.name)
  const restored=await h.step('hand-'+i+'-projection-restored',0,opposite);check(JSON.stringify(restored.projection)===JSON.stringify(first.projection),'Private projection test restores all layout settings: '+c.name)
  const traces=[]
  for(const [phase,x,y]of [['raise',1,1],['lower',1,-1],['reverse',-1,-1],['repeat',1,1]]){
   await cursor(token,x,y);for(let frame=0;frame<8;frame++){const s=await h.step('hand-'+i+'-'+phase+'-'+frame,3,opposite);audit(s);traces.push(slim(s))}
  }
  const hold=await h.step('hand-'+i+'-held',60,opposite);audit(hold)
  const aiChanged=await h.step('hand-'+i+'-ai-override',0,{...opposite,position:{x:1,y:0},buttons:['left'],keys:['a']});audit(aiChanged)
  for(const a of axes)check(aiChanged.values[a.id]===hold.values[a.id],'AI movement cannot pull hand back: '+c.name+' '+a.role)
  check(aiChanged.pose.values[axes[0].id]!==aiChanged.values[axes[0].id]||aiChanged.pose.values[axes[1].id]!==aiChanged.values[axes[1].id],'Raw confirmed AI pose remains distinct from display: '+c.name)
  const frozen=await h.step('hand-'+i+'-unknown',30,{...opposite,status:'unknown'});assert.deepEqual(frozen.values,aiChanged.values);check(frozen.pose.frozen,'Unknown state freezes the actual displayed hand: '+c.name)
  await cursor(token,-1,-1);const locked=await h.step('hand-'+i+'-locked',30,{...opposite,status:'locked'});assert.deepEqual(locked.values,frozen.values);check(locked.pose.frozen,'Locked state rejects cursor motion: '+c.name)
  await cursor(token,1,1);const resumed=await h.step('hand-'+i+'-resumed',90,opposite);audit(resumed)
  await cursor(token,0,0,false);const invalid=await h.step('hand-'+i+'-invalid-read',90,opposite);audit(invalid)
  for(const a of axes)check(Math.abs(invalid.values[a.id]-catalog.adapter.parameters.find(p=>p.id===a.id).default)<1e-4,'Invalid read returns to neutral: '+c.name+' '+a.role)
  reports.push({name:c.name,catalog,first:slim(first),samples,traces,hold:slim(hold),aiChanged:slim(aiChanged),frozen:slim(frozen),locked:slim(locked),resumed:slim(resumed),invalid:slim(invalid)})
 }
 const c=cats.find(c=>c.name.includes('清宵'))
 const automatic=await load(h,c);await cursor(automatic.modelToken,0,1);const autoFrame=await h.step('manual-auto',90,opposite)
 const manual=await load(h,{...c,adapter:{bindings:{mouseY:{id:'ParamMouseY',reverse:false}}}});await cursor(manual.modelToken,0,1);const manualFrame=await h.step('manual-normal',90,opposite)
 check(Math.abs(autoFrame.values.ParamMouseY-manualFrame.values.ParamMouseY)<1e-4,'Selecting the same manual axis retains automatic direction')
 const reverse=await load(h,{...c,adapter:{bindings:{mouseY:{id:'ParamMouseY',reverse:true}}}});await cursor(reverse.modelToken,0,1);const reverseFrame=await h.step('manual-reverse',90,opposite)
 check(manualFrame.values.ParamMouseY< -29.99&&reverseFrame.values.ParamMouseY>29.99,'Manual reversal remains authoritative after non-default base correction')
 reports.push({name:'manual-binding-reversal',automatic:slim(autoFrame),manual:slim(manualFrame),reverse:slim(reverseFrame)})

 // Resolve the approved global reverse=true preference to each model's real Y ID.
 // The measured Core vertex displacement and actual MVP matrix prove screen direction,
 // rather than assuming that a positive parameter means an upward rendered hand.
 for(let i=0;i<candidates.length;i++){
  const c=candidates[i],original=reports[i].catalog,yInput=original.adapter.inputs.find(a=>a.role==='mouseY'&&a.enabled)
  const adapter={bindings:{mouseY:{id:yInput.id,reverse:true}}},before=structuredClone(adapter)
  const catalog=await load(h,{...c,adapter}),token=catalog.modelToken,calibration=catalog.adapter.cursorHandFollow.calibration.mouseY
  check(calibration.calibrated&&calibration.source==='visible-core-vertices','Real visible Core geometry provides Y direction: '+c.name)
  check(catalog.adapter.inputs.find(a=>a.role==='mouseY').reverse===true,'Global reverse preference is retained: '+c.name)
  const points={}
  for(const [label,y]of [['up',1],['center',0],['down',-1]]){
   await cursor(token,0,y);points[label]=await h.step('global-reverse-'+i+'-'+label,90,opposite);audit(points[label])
  }
  const p=catalog.adapter.parameters.find(p=>p.id===yInput.id),mvp=points.up.diagnostics.projection
  const normalizedCoreDisplacement=calibration.displacement/(p.max-p.min)
  const screenDy=(a,b)=>-(points[a].values[yInput.id]-points[b].values[yInput.id])*normalizedCoreDisplacement*mvp[5]
  check(screenDy('up','center')< -1e-6&&screenDy('down','center')>1e-6,'Rendered mouse hand follows physical up/down with saved reverse=true: '+c.name)
  check(JSON.stringify(points.up.diagnostics.projection)===JSON.stringify(points.down.diagnostics.projection),'Up/down proof uses one fixed actual screen projection: '+c.name)
  assert.deepEqual(adapter,before)
  directionProof.push({name:c.name,id:yInput.id,globalReverse:true,calibration,projection:mvp,screenUpDelta:screenDy('up','center'),screenDownDelta:screenDy('down','center'),points:Object.fromEntries(Object.entries(points).map(([k,v])=>[k,slim(v)]))})
 }

 // Run the same poses against an untouched, copied 0.3.6 runtime, never the user's Host.
 // The DLL override is constrained by idleHarness to this project's private QA directory.
 const baselineDir=resolve('.qa/import-hand-y-0.3.7/baseline-desktop')
 await cp(resolve('runtime/desktop-0.3.6'),baselineDir,{recursive:true})
 const baseline=await idleHarness(join(out,'baseline'),join(baselineDir,'GamePlayer.Desktop.dll'))
 const normalize=(value,p)=>value===p.default?0:(value-p.default)/(value>p.default?p.max-p.default:p.default-p.min)
 try{
  for(let i=0;i<candidates.length;i++){
   const c=candidates[i],catalog=await load(baseline,c),token=catalog.modelToken,current=reports[i],yInput=catalog.adapter.inputs.find(a=>a.role==='mouseY'&&a.enabled),p=catalog.adapter.parameters.find(p=>p.id===yInput.id)
   check(catalog.adapter.cursorHandFollow.yCorrection===(c.name==='default'?-1:1),'Baseline is the original 0.3.6 runtime: '+c.name)
   await baseline.step('baseline-'+i+'-initial',1,opposite)
   const graph=current.first.diagnostics.physicsDependencies,dependent=new Set([yInput.id])
   for(let pass=0;pass<graph.length;pass++)for(const edge of graph)if(edge.inputs.some(id=>dependent.has(id)))for(const id of edge.outputs)dependent.add(id)
   dependent.delete(yInput.id)
   directionProof[i].authoredYDependentPhysics=[...dependent]
   const comparisons=[]
   for(const [label,x,y]of [['center',0,0],['left',-1,0],['right',1,0],['up',0,1],['down',0,-1],['ul',-1,1],['ur',1,1],['dl',-1,-1],['dr',1,-1]]){
    await baseline.call({kind:'qa-cursor',token,sequence:++sequence,valid:true,x,y})
    const old=await baseline.step('baseline-'+i+'-'+label,90,opposite),now=current.samples.find(sample=>sample.name==='hand-'+i+'-'+label)
    audit(old)
    for(const [id,value]of Object.entries(old.values)){
     if(id===yInput.id&&c.name!=='default')check(Math.abs(normalize(value,p)+normalize(now.values[id],p))<1e-4,'Only non-default Y range is reversed relative to 0.3.6: '+c.name+' '+label)
     else if(c.name!=='default'&&dependent.has(id)){
      const parameter=catalog.adapter.parameters.find(p=>p.id===id)
      const bounded=Number.isFinite(value)&&Number.isFinite(now.values[id])&&value>=parameter.min&&value<=parameter.max&&now.values[id]>=parameter.min&&now.values[id]<=parameter.max
      const sameOrMirrored=Math.abs(value-now.values[id])<1e-4||Math.abs(normalize(value,parameter)+normalize(now.values[id],parameter))<1e-4
      check(old.diagnostics.physicsOutputs[id]&&now.diagnostics.physicsOutputs[id]&&bounded&&sameOrMirrored,'Authored Y-dependent physics stays identical or reflects within its original rig: '+c.name+' '+label+' '+id)
     }else check(Math.abs(now.values[id]-value)<1e-4,'Default/all unrelated parameters match 0.3.6: '+c.name+' '+label+' '+id)
    }
    assert.deepEqual(old.pose,now.pose);assert.deepEqual(old.diagnostics.projection,now.diagnostics.projection)
    comparisons.push({label,old:old.values[yInput.id],current:now.values[yInput.id]})
   }
   directionProof[i].baselineComparisons=comparisons
  }
  const defaultModel=candidates.find(c=>c.name==='default')
  for(const reverse of [false,true]){
   const custom={...defaultModel,adapter:{bindings:{mouseX:null,mouseY:{id:'ParamMouseX',reverse}}}}
   const oldCatalog=await load(baseline,custom),newCatalog=await load(h,custom)
   check(oldCatalog.adapter.cursorHandFollow.yCorrection===1&&newCatalog.adapter.cursorHandFollow.yCorrection===1,'Default custom Y binding keeps its original correction branch: '+reverse)
   for(const y of [-1,1]){
    await baseline.call({kind:'qa-cursor',token:oldCatalog.modelToken,sequence:++sequence,valid:true,x:0,y})
    await cursor(newCatalog.modelToken,0,y)
    const old=await baseline.step('default-custom-old-'+reverse+'-'+y,90,opposite),now=await h.step('default-custom-new-'+reverse+'-'+y,90,opposite)
    check(Math.abs(old.values.ParamMouseX-now.values.ParamMouseX)<1e-4,'Default custom Y movement is unchanged: '+reverse+' '+y)
   }
  }
 }finally{await writeFile(join(out,'baseline-stderr.log'),await baseline.close())}
}finally{clearTimeout(watchdog);await writeFile(join(out,'stderr.log'),await h.close());await writeFile(join(out,'report.json'),JSON.stringify({checks,reports,directionProof,realCursorReads:0,desktopCaptured:false,realInputSent:false,privateCanvasNotFieldAcceptance:true},null,2))}
console.log('Hand Core/private-canvas checks: '+checks.length)
