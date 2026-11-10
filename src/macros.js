import { mkdir, open, readFile, rename, unlink, lstat } from 'node:fs/promises'
import { dirname, join, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { normalizeAction, validateBalanced } from './keys.js'
const LIMIT = 1024 * 1024
export function macroName(name) {
  if(typeof name!=='string'||!name.trim()||name.length>64||/[\x00-\x1f\x7f]/.test(name)) throw new Error('Template name must contain 1 to 64 non-control characters.')
  return name
}
export function canonicalTemplate(actions, referenceSize) {
  if(!Array.isArray(actions)||!actions.length||actions.length>12) throw new Error('Template needs 1 to 12 actions.')
  const normalized=actions.map(a=>normalizeAction(a,60000)); validateBalanced(normalized,60000)
  const positional=normalized.some(a=>a.x!==undefined)
  const body={actions:normalized}
  if(positional){
    if(!referenceSize||!Number.isSafeInteger(referenceSize.width)||!Number.isSafeInteger(referenceSize.height)||referenceSize.width<1||referenceSize.height<1) throw new Error('Positional template needs reference client size.')
    for(const a of normalized) for(const [x,y] of [['x','y'],['fromX','fromY']]) if(a[x]!==undefined&&(a[x]<0||a[y]<0||a[x]>=referenceSize.width||a[y]>=referenceSize.height)) throw new Error('Template coordinate outside reference client size.')
    body.referenceSize={width:referenceSize.width,height:referenceSize.height}
  }
  return {...body,revision:createHash('sha256').update(JSON.stringify(body)).digest('hex')}
}
export class MacroStore {
  constructor(path, { replace = rename } = {}){this.replace=replace;if(!isAbsolute(path))throw new Error('macroStoragePath must be absolute.');this.path=path;this.queue=Promise.resolve()}
  async #load(){
    let bytes
    try{const st=await lstat(this.path);if(!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)throw new Error('Invalid template store file.');bytes=await readFile(this.path)}catch(e){if(e.code==='ENOENT')return {version:1,macros:{}};throw e}
    if(bytes.length>LIMIT)throw new Error('Template store exceeds 1MiB.')
    let doc;try{doc=JSON.parse(bytes.toString('utf8'))}catch{throw new Error('Corrupt template store; preserved without replacement.')}
    if(!doc||doc.version!==1||!doc.macros||Array.isArray(doc.macros)||typeof doc.macros!=='object'||Object.keys(doc).some(k=>!['version','macros'].includes(k))||Object.keys(doc.macros).length>100)throw new Error('Invalid template store version/shape.')
    for(const [name,m] of Object.entries(doc.macros)){
      macroName(name)
      if(!m||Object.keys(m).some(k=>!['actions','referenceSize','revision'].includes(k)))throw new Error('Invalid saved template.')
      const canonical=canonicalTemplate(m.actions,m.referenceSize)
      if(canonical.revision!==m.revision||JSON.stringify(canonical)!==JSON.stringify(m))throw new Error('Saved template content/revision mismatch.')
    }
    return doc
  }
  #transaction(fn,write=false){
    const run=async()=>{
      await mkdir(dirname(this.path),{recursive:true})
      const lockPath=this.path+'.lock';let lock
      try{lock=await open(lockPath,'wx',0o600)}catch(e){if(e.code==='EEXIST')throw new Error('Template store busy; lock is never automatically broken.');throw e}
      let temp
      try{
        const doc=await this.#load(), result=await fn(doc)
        if(write){
          if(Object.keys(doc.macros).length>100)throw new Error('At most 100 templates may be saved.')
          const bytes=Buffer.from(JSON.stringify(doc,null,2)+'\n');if(bytes.length>LIMIT)throw new Error('Template store exceeds 1MiB.')
          temp=join(dirname(this.path),'.macros-'+randomUUID()+'.tmp')
          const file=await open(temp,'wx',0o600);try{await file.writeFile(bytes);await file.sync()}finally{await file.close()}
          await this.replace(temp,this.path);temp=undefined
        }
        return structuredClone(result)
      }finally{
        if(temp)await unlink(temp).catch(()=>{})
        await lock.close();await unlink(lockPath)
      }
    }
    const result=this.queue.then(run,run);this.queue=result.catch(()=>{});return result
  }
  list(){return this.#transaction(doc=>({templates:Object.entries(doc.macros).map(([name,m])=>({name,revision:m.revision,...(m.referenceSize?{referenceSize:m.referenceSize}:{})}))}))}
  async get(name){macroName(name);return this.#transaction(doc=>{if(!Object.hasOwn(doc.macros,name))throw new Error('Template not found.');return {name,...doc.macros[name]}})}
  async save(name,body,expectedRevision){
    macroName(name);const m=canonicalTemplate(body.actions,body.referenceSize)
    return this.#transaction(doc=>{
      const old=Object.hasOwn(doc.macros,name)?doc.macros[name]:undefined
      if(old?expectedRevision!==old.revision:expectedRevision!==undefined)throw new Error('Template revision conflict.')
      Object.defineProperty(doc.macros,name,{value:m,writable:true,enumerable:true,configurable:true})
      return {name,...m}
    },true)
  }
  async delete(name,expectedRevision){macroName(name);return this.#transaction(doc=>{if(!Object.hasOwn(doc.macros,name))throw new Error('Template not found.');if(expectedRevision!==doc.macros[name].revision)throw new Error('Template revision conflict.');delete doc.macros[name];return {name,deleted:true}},true)}
}
