import { INPUT_ROLES, EFFECT_ROLES, PROTECTED_PARAMETERS, validParameter, validateAdapterChange, validateAdapterAgainstCatalog } from './model-adapter.js'
const generation='00000000-0000-0000-0000-000000000000'
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object??{},key)
const fail=message=>{throw Object.assign(new Error(message),{code:'invalid_adapter'})}

/** Persistent desired settings, independent of model identity and available artwork. */
export function validateGlobalAdapter(record){
 if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).some(k=>!['bindings','effects','handStyle'].includes(k)))fail('Invalid global adapter record.')
 const checked=validateAdapterChange({catalogGeneration:generation,...record});delete checked.catalogGeneration
 const used=new Set()
 for(const b of Object.values(checked.bindings??{}))if(b?.id){if(PROTECTED_PARAMETERS.includes(b.id)||used.has(b.id))fail('Protected or multiply-owned global input parameter.');used.add(b.id)}
 for(const b of Object.values(checked.effects??{}))for(const id of b?.ids??[])if(PROTECTED_PARAMETERS.includes(id)||used.has(id))fail('Global effect cannot own a protected or input parameter.')
 return checked
}
export function mergeGlobalAdapter(record,change){
 const next=structuredClone(record??{})
 if(change.reset){delete next.bindings;delete next.effects}
 for(const kind of ['bindings','effects'])if(change[kind])next[kind]={...(next[kind]??{}),...change[kind]}
 if(own(change,'handStyle'))next.handStyle=change.handStyle
 return validateGlobalAdapter(next)
}

/** Only actual Core/default catalogs may provide fallback mappings; never infer IDs from labels. */
export function resolveGlobalAdapter(record,catalog){
 const globalAdapter=validateGlobalAdapter(record),parameters=new Map((catalog.parameters??[]).map(p=>[p.id,p])),used=new Set(),bindings={},effects={},fallbacks=[]
 const usable=id=>typeof id==='string'&&validParameter(parameters.get(id))&&!PROTECTED_PARAMETERS.includes(id)
 const defaults=new Map((catalog.inputs??[]).map(i=>[i.role,i]))
 // Explicit input owners win over automatic roles, regardless of control/event order.
 for(const role of INPUT_ROLES){const b=globalAdapter.bindings?.[role];if(b?.id&&usable(b.id)&&!used.has(b.id)){bindings[role]={id:b.id,reverse:b.reverse};used.add(b.id)}}
 for(const role of INPUT_ROLES){
  if(own(bindings,role))continue
  const b=globalAdapter.bindings?.[role],automatic=defaults.get(role),disabled=own(globalAdapter.bindings,role)&&b===null
  const id=!disabled&&automatic?.enabled&&usable(automatic.id)&&!used.has(automatic.id)?automatic.id:null
  bindings[role]=id?{id,reverse:b?.reverse??automatic.reverse===true}:null;if(id)used.add(id)
  if(b?.id)fallbacks.push({kind:'bindings',role,requested:b.id,effective:id,reason:usable(b.id)?'owned':'missing'})
  else if(!disabled&&automatic?.enabled&&!id)fallbacks.push({kind:'bindings',role,requested:automatic.id,effective:null,reason:usable(automatic.id)?'owned':'missing'})
 }
 const defaultEffects=new Map((catalog.effects??[]).map(e=>[e.role,e]))
 for(const role of EFFECT_ROLES){
  const b=globalAdapter.effects?.[role],automatic=defaultEffects.get(role),disabled=own(globalAdapter.effects,role)&&b===null
  const good=ids=>Array.isArray(ids)&&ids.length>0&&ids.every(id=>usable(id)&&!used.has(id))
  let ids=disabled?[]:b?.ids&&good(b.ids)?b.ids:(automatic?.enabled?(automatic.ids??[]).filter(id=>usable(id)&&!used.has(id)):[])
  effects[role]=ids.length?{ids:[...ids],reverse:b?.reverse??automatic?.reverse===true}:null
  if(b?.ids&&!good(b.ids))fallbacks.push({kind:'effects',role,requested:[...b.ids],effective:[...ids],reason:b.ids.some(id=>used.has(id))?'owned':'missing'})
  else if(!disabled&&!b?.ids&&automatic?.enabled&&ids.length!==(automatic.ids??[]).length)fallbacks.push({kind:'effects',role,requested:[...automatic.ids],effective:[...ids],reason:'owned'})
 }
 const requested=globalAdapter.handStyle??'default',handStyle=catalog.handStyles?.some(s=>s.id===requested)?requested:'default'
 if(handStyle!==requested)fallbacks.push({kind:'handStyle',role:'handStyle',requested,effective:handStyle,reason:'missing'})
 const adapter={bindings,effects,handStyle}
 validateAdapterAgainstCatalog({catalogGeneration:generation,...adapter},{...catalog,generation})
 return {globalAdapter,adapter,fallbacks}
}
export function confirmsGlobalAdapter(catalog,adapter){
 for(const [kind,list] of [['bindings','inputs'],['effects','effects']])for(const [role,b] of Object.entries(adapter[kind])){
  const actual=catalog?.[list]?.find(i=>i.role===role),ids=kind==='bindings'?(actual?.id?[actual.id]:[]):(actual?.ids??[]),wanted=kind==='bindings'?(b?.id?[b.id]:[]):(b?.ids??[])
  if(JSON.stringify([...ids].sort())!==JSON.stringify([...wanted].sort())||wanted.length&&(actual?.enabled!==true||actual.reverse!==b.reverse))return false
 }
 return catalog?.handStyle===adapter.handStyle
}
export function profileGlobalBindings(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.version!==1||Object.keys(raw).some(k=>!['version','bindings','invertY'].includes(k))||own(raw,'invertY')&&typeof raw.invertY!=='boolean')fail('Expected a v1 adapter JSON.')
 const map=raw.bindings??{};if(!map||typeof map!=='object'||Array.isArray(map)||Object.keys(map).some(k=>!INPUT_ROLES.includes(k)))fail('Invalid adapter JSON roles.')
 const bindings={}
 for(const [role,id] of Object.entries(map))bindings[role]={id,reverse:role==='mouseY'&&raw.invertY===true}
 if(!own(bindings,'mouseY'))bindings.mouseY={reverse:raw.invertY===true}
 return validateGlobalAdapter({bindings}).bindings
}
