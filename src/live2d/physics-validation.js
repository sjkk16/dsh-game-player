// Validate identifiers before the Framework can create virtual sinks for bad physics.
const own=(map,id)=>Object.prototype.hasOwnProperty.call(map??{},id)
export function validatePhysics(json,parameters){
 const j=typeof json==='string'?JSON.parse(json):json
 if(!j||j.Version!==3||!Array.isArray(j.PhysicsSettings)||j.PhysicsSettings.length>128)throw Error('Unsupported physics metadata')
 if(j.Meta?.Fps!==undefined&&(!Number.isFinite(j.Meta.Fps)||j.Meta.Fps<0||j.Meta.Fps>240))throw Error('Invalid physics rate')
 let total=0
 for(const setting of j.PhysicsSettings){
  if(!Array.isArray(setting.Input)||setting.Input.length>64||!Array.isArray(setting.Output)||setting.Output.length>64||!Array.isArray(setting.Vertices)||setting.Vertices.length>256)throw Error('Physics budget exceeded')
  total+=setting.Vertices.length;if(total>8192)throw Error('Physics vertex budget exceeded')
  for(const [items,key]of [[setting.Input,'Source'],[setting.Output,'Destination']])for(const item of items){const ref=item?.[key];if(!ref||ref.Target!=='Parameter'||typeof ref.Id!=='string'||!own(parameters,ref.Id))throw Error('Physics parameter is not provided');if(!Number.isFinite(item.Weight)||item.Weight<0||item.Weight>100)throw Error('Invalid physics weight')}
 }
 const check=(v,depth=0)=>{if(depth>32)throw Error('Physics depth exceeded');if(typeof v==='number'&&(!Number.isFinite(v)||Math.abs(v)>1e9))throw Error('Invalid physics number');if(v&&typeof v==='object')for(const value of Object.values(v))check(value,depth+1)};check(j);return true
}
