// Core identities are authoritative. Labels never infer input, decoration or resource access.
export const INPUT_ROLES=Object.freeze(['keyboard','mouseX','mouseY','left','right','middle','wheel'])
export const EFFECT_ROLES=Object.freeze(['blink','breath','headX','headY','headZ','bodyX','bodyY','bodyZ'])
export const PROTECTED_PARAMETERS=Object.freeze(['Paramshuiying'])
const INPUT_IDS={keyboard:['CatParamLeftHandDown'],mouseX:['ParamMouseX','PARAM_MOUSE_X'],mouseY:['ParamMouseY','PARAM_MOUSE_Y'],left:['ParamMouseLeftDown'],right:['ParamMouseRightDown'],middle:['ParamMouseMiddleDown'],wheel:['ParamMouseWheel']}
const EFFECT_IDS={breath:['ParamBreath','PARAM_BREATH'],headX:['ParamAngleX','PARAM_ANGLE_X'],headY:['ParamAngleY','PARAM_ANGLE_Y'],headZ:['ParamAngleZ','PARAM_ANGLE_Z'],bodyX:['ParamBodyAngleX','PARAM_BODY_ANGLE_X'],bodyY:['ParamBodyAngleY','PARAM_BODY_ANGLE_Y'],bodyZ:['ParamBodyAngleZ','PARAM_BODY_ANGLE_Z']}
export const validParameter=p=>p&&[p.min,p.max,p.default].every(Number.isFinite)&&p.min<=p.default&&p.default<=p.max&&p.min<p.max
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o??{},k)
const cleanId=id=>typeof id==='string'&&id.length>0&&id.length<=128&&!id.includes('\0')
const fail=message=>{throw Object.assign(new Error(message),{code:'invalid_adapter'})}
export function validateAdapterChange(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['catalogGeneration','bindings','effects','handStyle','reset'].includes(k))||typeof value.catalogGeneration!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.catalogGeneration))fail('Expected a current, bounded adapter change.')
 const out={catalogGeneration:value.catalogGeneration}
 for(const [key,roles]of [['bindings',INPUT_ROLES],['effects',EFFECT_ROLES]]){
  if(!own(value,key))continue;const map=value[key];if(!map||typeof map!=='object'||Array.isArray(map)||Object.keys(map).length>roles.length)fail('Invalid adapter roles.');out[key]={}
  for(const [role,binding]of Object.entries(map)){
   if(!roles.includes(role))fail('Unknown adapter role.');if(binding===null){out[key][role]=null;continue}
   if(!binding||typeof binding!=='object'||Array.isArray(binding)||Object.keys(binding).some(k=>!['id','ids','reverse'].includes(k))||typeof binding.reverse!=='boolean')fail('Invalid adapter binding.')
   if(key==='bindings'){if((own(binding,'id')&&!cleanId(binding.id))||own(binding,'ids'))fail('Invalid input parameter.');out[key][role]={...(own(binding,'id')?{id:binding.id}:{}),reverse:binding.reverse}}
   else {if(own(binding,'id')||(own(binding,'ids')&&(!Array.isArray(binding.ids)||binding.ids.length<1||binding.ids.length>(role==='blink'?8:1)||binding.ids.some(id=>!cleanId(id))||new Set(binding.ids).size!==binding.ids.length)))fail('Invalid effect parameters.');out[key][role]={...(own(binding,'ids')?{ids:[...binding.ids]}:{}),reverse:binding.reverse}}
  }
 }
 if(own(value,'handStyle')){if(!['default','labels','no-labels'].includes(value.handStyle))fail('Invalid hand style.');out.handStyle=value.handStyle}
 if(own(value,'reset')){if(value.reset!==true)fail('Invalid reset request.');out.reset=true}
 return out
}
export function validateAdapterAgainstCatalog(change,catalog){
 const value=validateAdapterChange(change)
 if(!catalog||value.catalogGeneration!==catalog.generation)throw Object.assign(new Error('Model parameters changed; read them again.'),{code:'stale_adapter_catalog'})
 const ids=new Map((catalog.parameters??[]).map(p=>[p.id,p])),used=new Set()
 for(const [role,b]of Object.entries(value.bindings??{}))if(b){if(!validParameter(ids.get(b.id))||PROTECTED_PARAMETERS.includes(b.id))fail('Input parameter is not available: '+role);if(used.has(b.id))fail('Multiple input roles cannot own the same parameter.');used.add(b.id)}
 for(const [role,b]of Object.entries(value.effects??{}))if(b){if(!Array.isArray(b.ids))fail('Resolve automatic effects before validation.');for(const id of b.ids){if(!validParameter(ids.get(id))||PROTECTED_PARAMETERS.includes(id)||used.has(id))fail('Effect parameter is missing, protected or owned by input: '+role)}}
 if(value.handStyle&&!catalog.handStyles?.some(s=>s.id===value.handStyle))fail('Selected hand style is not available.')
 return value
}
export function resolveAdapter(parameters,manifest={}){
 const supplied=manifest.profile??{},local=manifest.adapterOverride??{},bindings={},reverse={},inputs=[]
 const usable=id=>validParameter(parameters[id])&&!PROTECTED_PARAMETERS.includes(id)
 const pick=list=>{const ids=list.filter(usable);return ids.length===1?ids[0]:null}
 for(const role of INPUT_ROLES){
  let id=pick(INPUT_IDS[role]??[]),source='auto',rev=role==='mouseY'&&supplied.invertY===true
  if(own(supplied.bindings,role)){id=supplied.bindings[role];source='json'}
  if(own(local.bindings,role)){id=local.bindings[role]?.id??null;rev=local.bindings[role]?.reverse===true;source='manual'}
  const enabled=!!id&&usable(id);if(id&&!PROTECTED_PARAMETERS.includes(id)){bindings[role]=id;reverse[role]=rev}
  inputs.push({role,id:id??null,reverse:rev,source,enabled,error:enabled?null:id?'Parameter missing or protected':'Model does not provide this input'})
 }
 const reserved=new Set(Object.values(bindings)),effectMap={},effectReverse={},effects=[]
 const groups=Array.isArray(manifest.groups)?manifest.groups:[]
 let blink=groups.find(g=>g?.Target==='Parameter'&&g.Name==='EyeBlink')?.Ids
 if(!Array.isArray(blink)||blink.length>8)blink=[]
 blink=[...new Set(blink.filter(id=>typeof id==='string'&&usable(id)))]
 if(!blink.length)blink=['ParamEyeLOpen','ParamEyeROpen','PARAM_EYE_L_OPEN','PARAM_EYE_R_OPEN'].filter(usable)
 for(const role of EFFECT_ROLES){
  let ids=role==='blink'?blink:(()=>{const id=pick(EFFECT_IDS[role]??[]);return id?[id]:[]})(),rev=false,source='auto'
  if(own(local.effects,role)){ids=local.effects[role]?.ids??[];rev=local.effects[role]?.reverse===true;source='manual'}
  const conflict=ids.some(id=>reserved.has(id)),missing=ids.some(id=>!usable(id)),enabled=ids.length>0&&!conflict&&!missing
  effectMap[role]=enabled?[...ids]:[];effectReverse[role]=rev
  effects.push({role,ids:[...ids],reverse:rev,source,enabled,error:enabled?null:conflict?'Parameter is owned by input':missing?'Parameter missing or protected':'Model does not provide this effect'})
 }
 return {profile:{bindings,reverse,invertY:false,missingInputs:inputs.filter(x=>!x.enabled).map(x=>x.role),effectMap,effectReverse},inputs,effects}
}
export function validatePose(json,parts){
 const j=typeof json==='string'?JSON.parse(json):json
 if(!j||j.Version!==undefined&&j.Version!==3||j.Version===undefined&&j.Type!=='Live2D Pose'||!Array.isArray(j.Groups)||j.Groups.length>64)throw Error('Unsupported pose metadata')
 if(j.FadeInTime!==undefined&&(!Number.isFinite(j.FadeInTime)||j.FadeInTime<0||j.FadeInTime>10))throw Error('Invalid pose fade')
 const ids=new Set()
 for(const group of j.Groups){if(!Array.isArray(group)||group.length<1||group.length>64)throw Error('Invalid pose group');for(const p of group){if(!p||typeof p.Id!=='string'||!own(parts,p.Id))throw Error('Pose part is not provided');ids.add(p.Id);if(p.Link!==undefined){if(!Array.isArray(p.Link)||p.Link.length>64||p.Link.some(id=>typeof id!=='string'||!own(parts,id)))throw Error('Pose link is not provided');for(const id of p.Link)ids.add(id)}}}
 if(ids.size>512)throw Error('Pose part budget exceeded');return [...ids]
}
