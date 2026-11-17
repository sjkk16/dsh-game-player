// Read-only settings replay matching the production Host's global-adapter flow.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {resolveGlobalAdapter,confirmsGlobalAdapter} from '../src/live2d/global-adapter.js'
export async function readQaPreferences(){return JSON.parse((await readFile(process.env.DSH_QA_PREFERENCES??resolve('../pet-state/overlay.json'),'utf8')).replace(/^\uFEFF/,''))}
export async function loadPreferenceModel(h,preferences){
 const request={kind:'load-model',modelPath:preferences.modelPath,modelEntry:preferences.modelEntry??null,profilePath:null,adapter:{},overrides:{},watermarks:preferences.modelWatermarks??{}}
 const baseline=await h.call(request),resolved=resolveGlobalAdapter(preferences.globalAdapter??{},baseline.adapter)
 let prepared=baseline
 if(!confirmsGlobalAdapter(baseline.adapter,resolved.adapter)){
  prepared=await h.call({...request,adapter:resolved.adapter})
  assert.equal(prepared.modelKey,baseline.modelKey);assert.deepEqual(prepared.sourceProof,baseline.sourceProof)
 }
 assert.ok(confirmsGlobalAdapter(prepared.adapter,resolved.adapter),'Native adapter must match the running Host resolution')
 await h.call({kind:'commit-model'})
 const catalog=await h.call({kind:'get-adapter'}),record=preferences.modelWatermarks?.[catalog.modelKey]
 assert.equal(catalog.adapter.watermark.mode,record?.mode??'default')
 if(record)assert.equal(catalog.adapter.watermark.mocHash,record.mocHash)
 return catalog
}
