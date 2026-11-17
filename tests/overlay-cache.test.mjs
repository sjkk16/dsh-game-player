import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import {resolve,join,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import {cleanupOverlayCache} from '../src/overlay-cache.js'
async function fixture(run){const base=resolve('.qa/tmp'),root=join(base,'cache-test-'+randomUUID());await fs.mkdir(root,{recursive:true});try{await run(root)}finally{assert.ok(resolve(root).startsWith(base+sep));await fs.rm(root,{recursive:true,force:true})}}
const id=()=>randomUUID().replaceAll('-','')
test('post-exit cleanup removes only the announced private cache and preserves preferences',async()=>fixture(async root=>{
 const settings=join(root,'overlay.json'),cache=join(root,'webview-cache'),directory=join(cache,id()),other=join(cache,id());await fs.mkdir(directory,{recursive:true});await fs.mkdir(other);await fs.writeFile(settings,'original');await fs.writeFile(join(directory,'temporary'),'cache');await cleanupOverlayCache(settings,{root:cache,directory});assert.equal(await fs.stat(directory).catch(()=>null),null);assert.equal(await fs.readFile(settings,'utf8'),'original');assert.ok(await fs.stat(other))
}))
test('post-exit cleanup accepts a valid data junction but deletes only its physical cache child',async()=>fixture(async root=>{
 const data=join(root,'data'),link=join(root,'link'),cache=join(data,'webview-cache'),directory=join(cache,id());await fs.mkdir(directory,{recursive:true});await fs.symlink(data,link,'junction');await cleanupOverlayCache(join(link,'overlay.json'),{root:cache,directory});assert.equal(await fs.stat(directory).catch(()=>null),null);assert.ok(await fs.stat(data));assert.ok((await fs.lstat(link)).isSymbolicLink())
}))
test('unannounced/outside/non-GUID cache paths cannot delete data',async()=>fixture(async root=>{
 const cache=join(root,'webview-cache'),outside=join(root,'other',id());await fs.mkdir(outside,{recursive:true});for(const value of [{root:join(root,'other'),directory:outside},{root:cache,directory:root},{root:cache,directory:join(cache,'..','overlay.json')}])await assert.rejects(cleanupOverlayCache(join(root,'overlay.json'),value),{code:'invalid_cache_path'});assert.ok(await fs.stat(outside))
}))
test('post-exit cleanup refuses a linked cache ID and keeps its target',async()=>fixture(async root=>{
 const cache=join(root,'webview-cache'),data=join(root,'data'),directory=join(cache,id());await fs.mkdir(cache);await fs.mkdir(data);await fs.symlink(data,directory,'junction');await assert.rejects(cleanupOverlayCache(join(root,'overlay.json'),{root:cache,directory}),{code:'invalid_cache_path'});assert.ok(await fs.stat(data))
}))
test('post-exit cleanup is harmless when native cleanup already removed its cache',async()=>fixture(async root=>{await cleanupOverlayCache(join(root,'overlay.json'),{root:join(root,'webview-cache'),directory:join(root,'webview-cache',id())})}))
