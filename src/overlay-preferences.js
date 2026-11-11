import * as fs from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateGlobalAdapter } from './live2d/global-adapter.js'
import { validateAdapterChange } from './live2d/model-adapter.js'

export const PREFERENCE_DEFAULTS = Object.freeze({
  version: 5, globalAdapter: Object.freeze({}), view: 'model', modelPath: null, profilePath: null, modelEntry: null, modelOverrides: Object.freeze({}), keyboardImage: null,
  widthDip: 420, keyboardWidthDip: 900, opacity: 1, x: null, y: null, controlMode: 'ai-only', modelInfoVisible: true,
})
const ranges = { widthDip: [220, 1000], keyboardWidthDip: [450, 1350], opacity: [.45, 1] }
const paths = new Set(['modelPath', 'profilePath', 'keyboardImage'])
export function preferenceError(code, message) { return Object.assign(new Error(message), { code }) }
export function validatePreferencePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length > 15) {
    throw preferenceError('invalid_preferences', 'Expected a bounded preference patch.')
  }
  const result = {}
  for (const [key, value] of Object.entries(patch)) {
    if (key in ranges) {
      const [min, max] = ranges[key]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        throw preferenceError('invalid_preferences', `${key} must be between ${min} and ${max}.`)
      }
    } else if (paths.has(key)) {
      if (value !== null && (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || !isAbsolute(value))) {
        throw preferenceError('invalid_preferences', `${key} must be a local absolute path or null.`)
      }
      if (typeof value === 'string' && (/^\\\\/.test(value) || /^[a-z]+:\/\//i.test(value))) {
        throw preferenceError('invalid_preferences', 'Network model and image paths are not supported.')
      }
     } else if (key === 'modelEntry') {
      if(value!==null&&(typeof value!=='string'||value.length>4096||!value.toLowerCase().endsWith('.model3.json')||/^[\\/]|[:%?#\0]/.test(value)||value.replaceAll('\\','/').split('/').some(p=>p==='..')))throw preferenceError('invalid_preferences','Invalid model entry.')
    } else if(key==='globalAdapter'){result[key]=value===null?null:validateGlobalAdapter(value);continue
    } else if (key === 'modelOverrides') {
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>32)throw preferenceError('invalid_preferences','Too many or invalid model adapters.')
      const records={}
      for(const [id,record]of Object.entries(value)){
        if(!/^[a-f0-9]{64}$/.test(id)||!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).some(k=>!['bindings','effects','handStyle','profilePath'].includes(k)))throw preferenceError('invalid_preferences','Invalid model adapter record.')
        const {profilePath,...mapping}=record,checked=validateAdapterChange({catalogGeneration:'00000000-0000-0000-0000-000000000000',...mapping});delete checked.catalogGeneration
        if(Object.prototype.hasOwnProperty.call(record,'profilePath'))checked.profilePath=validatePreferencePatch({profilePath}).profilePath
        records[id]=checked
      }
      result[key]=records;continue
    } else if (key === 'controlMode') {
      if (!['ai-only','adaptive'].includes(value)) throw preferenceError('invalid_preferences', 'Invalid control mode.')
    } else if (key === 'modelInfoVisible') {
      if (typeof value !== 'boolean') throw preferenceError('invalid_preferences', 'modelInfoVisible must be boolean.')
    } else if (key === 'view') {
      if (!['model', 'keyboard'].includes(value)) throw preferenceError('invalid_preferences', 'Invalid saved view.')
    } else if (key === 'x' || key === 'y') {
      if (value !== null && (!Number.isSafeInteger(value) || Math.abs(value) > 1000000)) {
        throw preferenceError('invalid_preferences', 'Invalid desktop position.')
      }
    } else throw preferenceError('invalid_preferences', `Unknown preference: ${key}`)
    result[key] = value
  }
  return result
}

/** Wire-only adapter edits are converted by management; records and paths are never caller-selected. */
export function validatePreferenceRequest(patch){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))throw preferenceError('invalid_preferences','Expected a preference patch.')
 const {modelAdapter,...base}=patch
 if('globalAdapter'in base||'modelOverrides'in base||'modelEntry'in base)throw preferenceError('invalid_preferences','Use the model selection commands.')
 const result=validatePreferencePatch(base)
 if(Object.prototype.hasOwnProperty.call(patch,'modelAdapter'))result.modelAdapter=validateAdapterChange(modelAdapter)
 return result
}

/** Read old CamelCase/PascalCase files without writing them just by opening settings. */
export function migratePreferences(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw preferenceError('invalid_preferences', 'Invalid settings object.')
  const fields = Object.fromEntries(Object.keys(PREFERENCE_DEFAULTS).map(key => [key.toLowerCase(), key]))
  const values = {}
  for (const [name, value] of Object.entries(raw)) {
    const key = fields[name.toLowerCase()]
    if (key) values[key] = value
  }
  const old = values.view === 'bongo' || (Number.isInteger(values.version) && values.version < 3)
  if (old) { values.keyboardWidthDip = values.widthDip; values.widthDip = 420 }
  const result = structuredClone(PREFERENCE_DEFAULTS)
  if(!Object.prototype.hasOwnProperty.call(values,'globalAdapter'))result.globalAdapter=null
  for (const [key, value] of Object.entries(values)) {
    if (key === 'version') continue
    if (key in ranges && typeof value === 'number' && Number.isFinite(value)) {
      result[key] = Math.max(ranges[key][0], Math.min(ranges[key][1], value))
    } else {
      try { Object.assign(result, validatePreferencePatch({ [key]: value })) } catch(error) {if(key==='modelOverrides'||key==='globalAdapter')throw error}
    }
  }
  return result
}

/** One authoritative writer, revision checks and a short cross-Host atomic-write lock. */
export class OverlayPreferences {
  constructor(path, { io = fs } = {}) {
    this.path=path;this.io=io;this.revision=0;this.value=structuredClone(PREFERENCE_DEFAULTS);this.error=null
    this.queue=Promise.resolve();this.fingerprint=null;this.change=0;this.writing=false;this.ready=this.load()
  }
  async read() {
    let value, revision
    try {
      if((await this.io.stat(this.path)).size>65536)throw preferenceError('invalid_preferences','Settings exceed 64 KiB.')
      const raw=JSON.parse((await this.io.readFile(this.path,'utf8')).replace(/^\uFEFF/,''))
      value=migratePreferences(raw);revision=Number.isSafeInteger(raw.revision)&&raw.revision>=0?raw.revision:0
    }catch(error){if(error.code!=='ENOENT')throw error;value=structuredClone(PREFERENCE_DEFAULTS);revision=0}
    return {value,revision,fingerprint:JSON.stringify([value,revision])}
  }
  adopt(data, initial=false) {
    if(data.fingerprint===this.fingerprint)return
    this.value=data.value;this.revision=initial?data.revision:Math.max(this.revision+1,data.revision)
    this.fingerprint=data.fingerprint;this.error=null
  }
  async load(){try{this.adopt(await this.read(),true)}catch(error){this.error=error.message}}
  snapshot(){return {revision:this.revision,preferences:structuredClone(this.value),preferenceError:this.error}}
  async refresh(){
    await this.ready;if(this.writing)return this.snapshot()
    const marker=this.change,data=await this.read()
    if(marker===this.change&&!this.writing)this.adopt(data)
    return this.snapshot()
  }
  async lock() {
    const path=this.path+'.lock', token=randomUUID(),end=Date.now()+3000
    for(;;){
      try {
        const handle=await this.io.open(path,'wx')
        try{await handle.writeFile(JSON.stringify({pid:process.pid,token}))}catch(error){await handle.close();await this.io.unlink(path).catch(()=>{});throw error}
        return async()=>{await handle.close();try{const data=JSON.parse(await this.io.readFile(path,'utf8'));if(data.token===token)await this.io.unlink(path)}catch{}}
      }catch(error){
        if(error.code!=='EEXIST')throw error
        try{
          const text=await this.io.readFile(path,'utf8');if(text.length>1024)throw Error('Invalid writer lock')
          const data=JSON.parse(text);let dead=false
          if(Number.isSafeInteger(data.pid)&&data.pid>0){try{process.kill(data.pid,0)}catch(e){dead=e.code==='ESRCH'}}
          if(dead&&(await this.io.readFile(path,'utf8'))===text){await this.io.unlink(path);continue}
        }catch{}
        if(Date.now()>=end)throw preferenceError('preference_busy','Another Host is saving preferences; retry shortly.')
        await new Promise(resolve=>setTimeout(resolve,50))
      }
    }
  }
  async persist(value, revision) {
    const text=JSON.stringify({...value,revision});if(Buffer.byteLength(text,'utf8')>65536)throw preferenceError('invalid_preferences','Settings exceed 64 KiB.')
    const temporary=this.path+'.'+randomUUID()+'.tmp'
    try {
      await this.io.writeFile(temporary,text,{encoding:'utf8',flag:'wx'})
      await this.io.rename(temporary,this.path)
    }catch(error){await this.io.unlink(temporary).catch(()=>{});throw error}
    this.value=value;this.revision=revision;this.fingerprint=JSON.stringify([value,revision]);this.error=null
  }
  update(patch, revision, prepare=async()=>({}), { forcePrepare=false }={}) {
    const validated=validatePreferencePatch(patch)
    if(!Number.isSafeInteger(revision)||revision<0)return Promise.reject(preferenceError('invalid_revision','Invalid preference revision.'))
    const run=async()=>{
      await this.ready;this.change++
      try{this.adopt(await this.read())}catch(error){if(!this.error)throw error}
      if(revision!==this.revision)throw preferenceError('preference_conflict','Preferences changed in another entry; refresh and retry.')
      const previous={...this.value},next={...previous,...validated},before=this.fingerprint
      if(!forcePrepare&&JSON.stringify(previous)===JSON.stringify(next))return this.snapshot()
      let transaction,unlock
      try {
        transaction=await prepare(next,previous)
        this.writing=true;this.change++
        await this.io.mkdir(dirname(this.path),{recursive:true});unlock=await this.lock()
        let disk
        try{disk=await this.read()}catch(error){if(!this.error)throw error}
        if(disk&&disk.fingerprint!==before){this.adopt(disk);throw preferenceError('preference_conflict','Another Host saved preferences during this operation; refresh and retry.')}
        await this.persist(next,this.revision+1)
        try {await transaction?.commit?.(this.snapshot())}
        catch(error){await this.persist(previous,this.revision+1);throw error}
        return this.snapshot()
      }catch(error){await Promise.resolve(transaction?.rollback?.()).catch(()=>{});throw error}
      finally{await unlock?.();this.writing=false;this.change++}
    }
    const result=this.queue.then(run,run);this.queue=result.catch(()=>{});return result
  }
}
