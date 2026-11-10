// At most one decoder; queued obsolete requests never decode or change the current hand.
export class HandImageCache {
 constructor(items,load,{maxEntries=8,maxPixels=16*1024*1024,onReady=()=>{}}={}){this.items=items;this.load=load;this.maxEntries=maxEntries;this.maxPixels=maxPixels;this.onReady=onReady;this.cache=new Map();this.pending=new Map();this.errors=new Map();this.pixels=0;this.desired=-1;this.pinned=-1;this.closed=false;this.controller=new AbortController();this.chain=Promise.resolve()}
 get(index){const record=this.cache.get(index);if(!record)return null;this.cache.delete(index);this.cache.set(index,record);return record.bitmap}
 request(index,pinned=-1){
  this.desired=index;this.pinned=pinned
  if(this.closed||index<0||!this.items[index]?.image||this.errors.has(index))return Promise.resolve(null)
  const ready=this.get(index);if(ready)return Promise.resolve(ready)
  if(this.pending.has(index))return this.pending.get(index)
  const promise=this.chain.then(async()=>{
   if(this.closed||index!==this.desired&&index!==this.pinned)return null
   const item=this.items[index],area=item.width*item.height
   if(!Number.isSafeInteger(area)||area<1||area>this.maxPixels){this.errors.set(index,'Hand image exceeds decode budget');return null}
   while(this.cache.size>=this.maxEntries||this.pixels+area>this.maxPixels){const old=[...this.cache.keys()].find(k=>k!==this.pinned);if(old===undefined){this.errors.set(index,'Hand cache is pinned by the confirmed pose');return null}this.drop(old)}
   let bitmap
   try{
    bitmap=await this.load(item.image,this.controller.signal)
    if(this.closed||this.controller.signal.aborted){bitmap.close();return null}
    if(bitmap.width!==item.width||bitmap.height!==item.height)throw Error('Hand image dimensions changed')
    this.cache.set(index,{bitmap,pixels:area});this.pixels+=area;bitmap=null
    if(index===this.desired)this.onReady(index)
    return this.cache.get(index).bitmap
   }catch(e){bitmap?.close();if(!this.closed){this.errors.set(index,String(e.message).slice(0,100));if(index===this.desired)this.onReady(index)}return null}
  }).finally(()=>{this.pending.delete(index);if(!this.closed&&index===this.desired)this.onReady(index)})
  this.pending.set(index,promise);this.chain=promise.then(()=>{},()=>{});return promise
 }
 drop(index){const value=this.cache.get(index);if(value){value.bitmap.close();this.pixels-=value.pixels;this.cache.delete(index)}}
 stats(){return {entries:this.cache.size,pixels:this.pixels,pending:this.pending.size,errors:[...this.errors].map(([index,error])=>({index,error}))}}
 release(){if(this.closed)return;this.closed=true;this.controller.abort();for(const id of this.cache.keys())this.drop(id);this.pending.clear();this.onReady=()=>{}}
}
