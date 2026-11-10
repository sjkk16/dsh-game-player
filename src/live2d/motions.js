// Strict admission before the SDK can synthesize nonexistent parameter IDs.
export function validateMotion(json, parameters, parts = {}) {
  const j=typeof json==='string'?JSON.parse(json.replace(/^\uFEFF/,'')):json
  const bad=message=>{throw new Error(message)}
  const finite=x=>typeof x==='number'&&Number.isFinite(x)
  const provided=(map,id)=>Object.prototype.hasOwnProperty.call(map??{},id)
  if(!j||j.Version!==3||!j.Meta||!finite(j.Meta.Duration)||j.Meta.Duration<=0||j.Meta.Duration>3600)bad('Unsupported motion version or duration')
  if(!finite(j.Meta.Fps)||j.Meta.Fps<=0||j.Meta.Fps>240||!Array.isArray(j.Curves)||j.Curves.length===0||j.Curves.length>512)bad('Invalid motion metadata or curve budget')
  const ids=new Set();let segments=0,points=0
  for(const c of j.Curves){
    if(typeof c.Id!=='string'||c.Id.length>128||c.Id.includes('\0')||c.Target==='Parameter'&&!provided(parameters,c.Id)||c.Target==='PartOpacity'&&!provided(parts,c.Id)&&!provided(parameters,c.Id)||c.Target==='Model'&&!['EyeBlink','LipSync','Opacity'].includes(c.Id)||!['Parameter','PartOpacity','Model'].includes(c.Target))bad('Motion parameter or part not provided: '+String(c.Id))
    if(c.Id==='Paramshuiying')bad('Reserved author parameter is not a character motion')
    const curveId=c.Target+':'+c.Id;if(ids.has(curveId))bad('Duplicate motion parameter: '+c.Id);ids.add(curveId)
    const a=c.Segments;if(!Array.isArray(a)||a.length<5||a.length>16384||!a.every(finite))bad('Invalid motion curve: '+c.Id)
    let last=a[0],i=2;points++
    const durationTolerance=.005 // Older official exports round Meta duration to 2 decimals, curve times to 3.
    if(last<0||last>j.Meta.Duration+durationTolerance)bad('Invalid motion start time')
    while(i<a.length){const kind=a[i++],n=kind===1?6:[0,2,3].includes(kind)?2:0;if(!n||i+n>a.length)bad('Malformed motion segments')
      const end=a[i+n-2];if(end<last||end>j.Meta.Duration+durationTolerance)bad('Invalid motion time order')
      if(kind===1&&(a[i]<last||a[i]>a[i+2]||a[i+2]>end))bad('Invalid Bezier control times')
      last=end;i+=n;segments++;points+=kind===1?3:1
    }
    for(const k of ['FadeInTime','FadeOutTime'])if(c[k]!==undefined&&(!finite(c[k])||c[k]<0||c[k]>10))bad('Invalid curve fade time')
  }
  if(j.Meta.CurveCount!==j.Curves.length||j.Meta.TotalSegmentCount!==segments||j.Meta.TotalPointCount!==points)bad('Motion curve counts do not match metadata')
  for(const k of ['FadeInTime','FadeOutTime'])if(j[k]!==undefined&&(!finite(j[k])||j[k]<0||j[k]>10))bad('Invalid motion fade time')
  const partIds=j.Curves.filter(c=>c.Target==='PartOpacity'&&provided(parts,c.Id)).map(c=>c.Id)
  return { durationMs:Math.min(10000,Math.max(1,Math.round(j.Meta.Duration*1000))), originalDurationMs:Math.round(j.Meta.Duration*1000), ids:j.Curves.filter(c=>c.Target==='Parameter').map(c=>c.Id),...(partIds.length?{partIds}: {}) }
}
export function validateMotionAction(value) {
  const strings=['show','hide','beginAdjust','endAdjust','resetLayout','reloadModel','retryDisplay','preview','stopPreview','cancelLoad','importModelFile','importModelFolder','importProfile','clearProfile','importKeyboardImage','clearKeyboardImage','refreshMotions','stopMotion','refreshAdapter','addLibraryFile','addLibraryFolder']
  if(typeof value==='string'&&strings.includes(value))return value
  if(value&&typeof value==='object'&&!Array.isArray(value)&&['addLibraryModels','selectLibraryModel','removeLibraryModel','setDisplayView'].includes(value.type)){
    const fail=()=>{throw Object.assign(Error('Invalid model library action.'),{code:'invalid_action'})}
    const revision=v=>Number.isSafeInteger(v)&&v>=0,uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v),id=v=>v==='builtin-default'||typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
    const allowed=value.type==='addLibraryModels'?['type','catalogGeneration','modelIds','libraryRevision']:value.type==='setDisplayView'?['type','view','revision']:['type','modelId','libraryRevision','revision']
    if(Object.keys(value).some(k=>!allowed.includes(k)))fail()
    if(value.type==='addLibraryModels'){if(!uuid(value.catalogGeneration)||!revision(value.libraryRevision)||!Array.isArray(value.modelIds)||!value.modelIds.length||value.modelIds.length>31||new Set(value.modelIds).size!==value.modelIds.length||value.modelIds.some(v=>typeof v!=='string'||!/^model-[0-9]{1,2}$/.test(v)))fail();return {...value,modelIds:[...value.modelIds]}}
    if(value.type==='setDisplayView'){if(!revision(value.revision)||!['model','keyboard'].includes(value.view))fail();return {...value}}
    if(!id(value.modelId)||!revision(value.libraryRevision)||!revision(value.revision)||value.type==='removeLibraryModel'&&value.modelId==='builtin-default')fail()
    return {...value}
  }
  if(value&&typeof value==='object'&&!Array.isArray(value)&&value.type==='selectModel'){
    if(Object.keys(value).some(k=>!['type','catalogGeneration','modelId','revision'].includes(k))||typeof value.catalogGeneration!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.catalogGeneration)||typeof value.modelId!=='string'||!/^model-[0-9]{1,2}$/.test(value.modelId)||!Number.isSafeInteger(value.revision)||value.revision<0)throw Object.assign(new Error('Invalid model selection request.'),{code:'invalid_action'})
    return {type:'selectModel',catalogGeneration:value.catalogGeneration,modelId:value.modelId,revision:value.revision}
  }
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['type','catalogGeneration','motionId'].includes(k))||value.type!=='playMotion'||typeof value.catalogGeneration!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.catalogGeneration)||typeof value.motionId!=='string'||!/^motion-[0-9]{1,2}$/.test(value.motionId))throw Object.assign(new Error('Unknown or invalid desktop motion action.'),{code:'invalid_action'})
  return {type:'playMotion',catalogGeneration:value.catalogGeneration,motionId:value.motionId}
}
