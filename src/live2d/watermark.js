// User-authorized models only. Names and display labels never grant permission.
export const WATERMARK_ID='Paramshuiying'
export const AUTHORIZED_WATERMARKS=Object.freeze({
 '3f1db3479803b569a4bb63c6c0795ef1bde04b2a464642d5cc1326881389e470':Object.freeze({name:'清宵',drawable:'ArtMesh88'}),
 'a574aac8785e9df82032eb9a9dbe62533376cceb27ab3b3490dc69c33bdaf1da':Object.freeze({name:'达妮娅',drawable:'ArtMesh6'}),
})
const fail=message=>{throw Object.assign(new Error(message),{code:'invalid_watermark'})}
export function validateWatermarkChange(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['catalogGeneration','mode'].includes(k))||typeof v.catalogGeneration!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.catalogGeneration)||!['default','hidden'].includes(v.mode))fail('Expected current watermark catalog and default/hidden mode.')
 return {catalogGeneration:v.catalogGeneration,mode:v.mode}
}
export function validateWatermarkRecords(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length>32)fail('Invalid bounded watermark records.')
 const out={};for(const [key,r]of Object.entries(v)){
  if(!/^[a-f0-9]{64}$/.test(key)||!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==2||r.mode!=='hidden'||typeof r.mocHash!=='string'||!Object.hasOwn(AUTHORIZED_WATERMARKS,r.mocHash))fail('Invalid authorized watermark record.')
  out[key]={mode:'hidden',mocHash:r.mocHash}
 }return out
}
export function watermarkCapability(hash,parameters){
 const p=parameters?.[WATERMARK_ID],author=typeof hash==='string'&&Object.hasOwn(AUTHORIZED_WATERMARKS,hash)?AUTHORIZED_WATERMARKS[hash]:null
 const supported=!!author&&p?.min===0&&p?.max===1&&p?.default===0
 return {supported,mocHash:hash,mode:'default',reason:supported?null:author?'parameter_mismatch':'not_authorized',drawable:author?.drawable}
}
// Validate the exact single authored overlay; never fall back to editing meshes.
export function verifyWatermarkCore(core,info,index){
 if(!info.supported)return info
 const saved=core.getParameterValueByIndex(index),rows=[],parts=[];let ok=true,changed=0
 try{
  core.setParameterValueByIndex(index,0);core.update()
  for(let i=0;i<core.getPartCount();i++)parts.push(core.getPartOpacityByIndex(i))
  for(let i=0;i<core.getDrawableCount();i++)rows.push({id:core.getDrawableId(i).getString(),opacity:core.getDrawableOpacity(i),vertices:Array.from(core.getDrawableVertices(i))})
  core.setParameterValueByIndex(index,1);core.update()
  for(let i=0;i<rows.length;i++){
   const row=rows[i],opacity=core.getDrawableOpacity(i),vertices=core.getDrawableVertices(i)
   if(row.opacity!==opacity){changed++;if(row.id!==info.drawable||row.opacity<=0||opacity!==0)ok=false}
   if(vertices.length!==row.vertices.length||vertices.some((v,j)=>v!==row.vertices[j]))ok=false
  }
  if(parts.some((v,i)=>v!==core.getPartOpacityByIndex(i)))ok=false
 }finally{core.setParameterValueByIndex(index,saved);core.update()}
 return {...info,supported:ok&&changed===1,reason:ok&&changed===1?null:'validation_failed'}
}

export function validateWatermarkCatalog(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.supported!=='boolean'||typeof v.mocHash!=='string'||!/^[a-f0-9]{64}$/.test(v.mocHash)||!['default','hidden'].includes(v.mode)||v.supported&&!Object.hasOwn(AUTHORIZED_WATERMARKS,v.mocHash)||v.supported&&v.reason!==null||!v.supported&&(!['not_authorized','parameter_mismatch','validation_failed'].includes(v.reason)||v.mode!=='default'))fail('Invalid native watermark catalog.')
 return {supported:v.supported,mocHash:v.mocHash,mode:v.mode,reason:v.reason}
}
