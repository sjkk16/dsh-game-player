import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PREFERENCE_DEFAULTS, migratePreferences, validatePreferenceRequest } from '../src/overlay-preferences.js'
import { defaultModelAvailable, requireModelSelection, DEFAULT_MODEL_ENTRY } from '../src/model-selection.js'
import { OverlayManagement } from '../src/overlay-management.js'
import { ModelLibrary } from '../src/model-library.js'
import { OverlayMotions } from '../src/overlay-motions.js'
import { OverlayModels } from '../src/overlay-models.js'
import { validateAdapterAgainstCatalog } from '../src/live2d/model-adapter.js'

const root=dirname(dirname(fileURLToPath(import.meta.url)))
const fallback=join(root,'missing-default-model'), selected=join(root,'saved-source.zip')
const present=path=>path===selected
assert.equal(defaultModelAvailable(fallback,()=>false),false)
assert.equal(defaultModelAvailable(null,()=>true),false)
assert.equal(defaultModelAvailable(fallback,path=>path===join(fallback,DEFAULT_MODEL_ENTRY)),true)
assert.throws(()=>requireModelSelection(null,fallback,()=>false),{code:'model_not_selected'})
assert.throws(()=>requireModelSelection(selected,fallback,()=>false),{code:'model_missing'})
assert.equal(requireModelSelection(selected,fallback,present),selected)
assert.equal(requireModelSelection(null,fallback,path=>path===join(fallback,DEFAULT_MODEL_ENTRY)),fallback)
assert.throws(()=>OverlayManagement.prototype.modelRequest.call({overlay:{defaultModel:fallback}},{modelPath:null}),{code:'model_not_selected'})
const request=OverlayManagement.prototype.modelRequest.call({overlay:{defaultModel:fallback}},{modelPath:join(root,'index.js'),modelWatermarks:{legacy:true}})
assert.equal(request.modelPath,join(root,'index.js'));assert.equal('watermarks' in request,false)
let sent=0
await assert.rejects(OverlayMotions.prototype.ready.call({manager:{ensureModelManagement:async()=>{},models:null,store:{value:{modelPath:null}}},overlay:{defaultModel:fallback,capabilities:{motions:true},runtime:{},command:async()=>{sent++}}},new AbortController().signal),{code:'model_not_selected'})
assert.equal(sent,0,'Missing-default motion path must not send load-model')
assert.equal(ModelLibrary.prototype.defaultAvailable.call({manager:{overlay:{defaultModel:fallback}}}),false)
assert.throws(()=>validatePreferenceRequest({modelWatermark:{catalogGeneration:'00000000-0000-0000-0000-000000000000',mode:'hidden'}}),{code:'invalid_preferences'})
assert.throws(()=>validatePreferenceRequest({modelWatermarks:{}}),{code:'invalid_preferences'})
assert.equal('modelWatermarks' in PREFERENCE_DEFAULTS,false)
const old={version:5,view:'keyboard',modelPath:join(root,'index.js'),modelWatermarks:{legacy:{mode:'hidden'}},globalAdapter:{}}
const migrated=migratePreferences(old)
assert.equal(migrated.modelPath,old.modelPath);assert.equal(migrated.view,'keyboard');assert.equal('modelWatermarks' in migrated,false)
const modelCache={overlay:{defaultModel:fallback},manager:{store:{value:{modelPath:join(root,'index.js'),globalAdapter:{}}}}}
const a=OverlayModels.prototype.source.call({...modelCache,selection:()=> 'selected'},{modelPath:join(root,'index.js'),globalAdapter:{},modelWatermarks:{legacy:true}})
const b=OverlayModels.prototype.source.call({...modelCache,selection:()=> 'selected'},{modelPath:join(root,'index.js'),globalAdapter:{}})
assert.equal(a,b)
const generation='00000000-0000-0000-0000-000000000000'
assert.throws(()=>validateAdapterAgainstCatalog({catalogGeneration:generation,bindings:{keyboard:{id:'Paramshuiying',reverse:false}}},{generation,parameters:[{id:'Paramshuiying',min:0,max:1,default:0}],handStyles:[]}),{code:'invalid_adapter'})
for(const name of ['client.js','desktop/renderer.js','desktop/model-scene.js','desktop/DisplayCommands.cs','desktop/DisplaySettings.cs','desktop/ModelPackage.cs','desktop/OverlaySettings.cs','src/overlay-preferences.js','src/overlay-models.js','src/overlay-management.js','src/overlay.js']){
  assert.equal(/watermark/i.test(readFileSync(join(root,name),'utf8')),false,'Removed feature remains in '+name)
}
assert.equal(existsSync(join(root,'src/live2d/watermark.js')),false)
console.log('Regression checks passed: no missing-default load request, explicit selection retained, legacy hide settings ignored, removed requests rejected, UI/native/renderer feature absent and reserved author parameters still protected.')
