import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PREFERENCE_DEFAULTS, migratePreferences, validatePreferenceRequest } from '../src/overlay-preferences.js'
import { defaultModelAvailable, requireModelSelection, DEFAULT_MODEL_ENTRY } from '../src/model-selection.js'
import { OverlayManagement } from '../src/overlay-management.js'
import { ModelLibrary } from '../src/model-library.js'
import { OverlayMotions } from '../src/overlay-motions.js'
import { OverlayModels } from '../src/overlay-models.js'
import { validateAdapterAgainstCatalog } from '../src/live2d/model-adapter.js'
import { AUTHORIZED_WATERMARKS } from '../src/live2d/watermark.js'

const root=dirname(dirname(fileURLToPath(import.meta.url)))
const fallback=join(root,'missing-default-model'),selected=join(root,'saved-source.zip'),present=path=>path===selected
assert.equal(defaultModelAvailable(fallback,()=>false),false)
assert.equal(defaultModelAvailable(null,()=>true),false)
assert.equal(defaultModelAvailable(fallback,path=>path===join(fallback,DEFAULT_MODEL_ENTRY)),true)
assert.throws(()=>requireModelSelection(null,fallback,()=>false),{code:'model_not_selected'})
assert.throws(()=>requireModelSelection(selected,fallback,()=>false),{code:'model_missing'})
assert.equal(requireModelSelection(selected,fallback,present),selected)
assert.equal(requireModelSelection(null,fallback,path=>path===join(fallback,DEFAULT_MODEL_ENTRY)),fallback)
assert.throws(()=>OverlayManagement.prototype.modelRequest.call({overlay:{defaultModel:fallback}},{modelPath:null}),{code:'model_not_selected'})
const generation='00000000-0000-0000-0000-000000000000',key='a'.repeat(64),hash=Object.keys(AUTHORIZED_WATERMARKS)[0]
const records={[key]:{mode:'hidden',mocHash:hash}}
const request=OverlayManagement.prototype.modelRequest.call({overlay:{defaultModel:fallback}},{modelPath:join(root,'index.js'),modelWatermarks:records})
assert.equal(request.modelPath,join(root,'index.js'));assert.deepEqual(request.watermarks,records)
let sent=0
await assert.rejects(OverlayMotions.prototype.ready.call({manager:{ensureModelManagement:async()=>{},models:null,store:{value:{modelPath:null}}},overlay:{defaultModel:fallback,capabilities:{motions:true},runtime:{},command:async()=>{sent++}}},new AbortController().signal),{code:'model_not_selected'})
assert.equal(sent,0,'Missing-default motion path must not send load-model')
assert.equal(ModelLibrary.prototype.defaultAvailable.call({manager:{overlay:{defaultModel:fallback}}}),false)
assert.deepEqual(validatePreferenceRequest({modelWatermark:{catalogGeneration:generation,mode:'hidden'}}),{modelWatermark:{catalogGeneration:generation,mode:'hidden'}})
assert.throws(()=>validatePreferenceRequest({modelWatermarks:records}),{code:'invalid_preferences'})
assert.deepEqual(PREFERENCE_DEFAULTS.modelWatermarks,{})
const old={version:5,view:'keyboard',modelPath:join(root,'index.js'),modelWatermarks:records,globalAdapter:{}}
const migrated=migratePreferences(old)
assert.equal(migrated.modelPath,old.modelPath);assert.equal(migrated.view,'keyboard');assert.deepEqual(migrated.modelWatermarks,records)
const modelCache={overlay:{defaultModel:fallback},manager:{store:{value:{modelPath:join(root,'index.js'),globalAdapter:{}}}},selection:()=> 'selected',currentKey:()=>key}
const a=OverlayModels.prototype.source.call(modelCache,{modelPath:join(root,'index.js'),globalAdapter:{},modelWatermarks:records})
const b=OverlayModels.prototype.source.call(modelCache,{modelPath:join(root,'index.js'),globalAdapter:{},modelWatermarks:{}})
assert.notEqual(a,b,'Watermark mode must participate in the current model cache identity')
assert.throws(()=>validateAdapterAgainstCatalog({catalogGeneration:generation,bindings:{keyboard:{id:'Paramshuiying',reverse:false}}},{generation,parameters:[{id:'Paramshuiying',min:0,max:1,default:0}],handStyles:[]}),{code:'invalid_adapter'})
assert.equal(existsSync(join(root,'src/live2d/watermark.js')),true)
console.log('Feature regression passed: missing-default loading remains blocked, explicit selection works, authorized watermark preferences are restored and reserved author parameters remain protected.')
