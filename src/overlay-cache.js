import * as fs from 'node:fs/promises'
import {resolve,dirname,join,basename} from 'node:path'
const equal=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b
/** Finish only the cache announced by our owned display, after that process closes. */
export async function cleanupOverlayCache(settingsPath,cache,{io=fs}={}) {
 if(!cache)return
 if(typeof cache.root!=='string'||typeof cache.directory!=='string'||cache.root.length>4096||cache.directory.length>4096)throw Object.assign(Error('Invalid native cache metadata.'),{code:'invalid_cache_path'})
 const root=resolve(cache.root),directory=resolve(cache.directory),expected=join(await io.realpath(dirname(settingsPath)),'webview-cache')
 if(!equal(root,expected)||!equal(dirname(directory),expected)||!/^[a-f0-9]{32}$/i.test(basename(directory)))throw Object.assign(Error('Refusing cache cleanup outside its approved data directory.'),{code:'invalid_cache_path'})
 let stat
 try{stat=await io.lstat(directory)}catch(error){if(error.code==='ENOENT')return;throw error}
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Object.assign(Error('Refusing linked/non-directory cache cleanup.'),{code:'invalid_cache_path'})
 // A WebView2 environment can hold a SQLite file until its embedding process exits.
 // Never broaden deletion to the data root or other cache IDs, and never close other apps.
 await io.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:50})
}
