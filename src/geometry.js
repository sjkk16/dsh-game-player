export const regionSchema = { type: 'object', additionalProperties: false, required: ['x','y','width','height'], properties: { x:{type:'integer'},y:{type:'integer'},width:{type:'integer'},height:{type:'integer'} } }
export const targetSchema = { type:'string', enum:['window','primary','virtual'] }
export function normalizeRegion(region) {
  if (region === undefined) return undefined
  if (!region || typeof region !== 'object' || Array.isArray(region) || Object.keys(region).some(k => !['x','y','width','height'].includes(k))) throw new Error('Invalid region.')
  for (const k of ['x','y','width','height']) if (!Number.isSafeInteger(region[k]) || region[k] < (k==='x'||k==='y'?0:1) || region[k] > 2147483647) throw new Error('Invalid region ' + k)
  return {x:region.x,y:region.y,width:region.width,height:region.height}
}
export function selectCapture(args, options, bound = false) {
  if (args.target !== undefined && args.monitor !== undefined) throw new Error('Supply target or legacy monitor, not both.')
  if (args.monitor !== undefined && !['primary','virtual'].includes(args.monitor)) throw new Error('monitor must be primary or virtual.')
  const target = args.target ?? args.monitor ?? (bound ? 'window' : options.monitor)
  if (!['window','primary','virtual'].includes(target)) throw new Error('Invalid capture target.')
  const region = normalizeRegion(args.region)
  return { target, ...(region ? {region} : {}) }
}
export function assertClient(info) {
  if (!info || info.valid !== true || info.minimized || !info.focused) throw new Error('Target window is invalid, minimized or not focused.')
  const b=info.client
  if (!b || !['x','y','width','height'].every(k=>Number.isSafeInteger(b[k])) || b.width<=0 || b.height<=0) throw new Error('Invalid client geometry.')
  return info
}
export function clientActions(actions, info, space) {
  if (!['screen','client'].includes(space)) throw new Error('coordinateSpace must be screen or client.')
  const b=assertClient(info).client
  return actions.map(a=>{
    const out={...a}
    for(const [x,y] of [['x','y'],['fromX','fromY']]) if(a[x]!==undefined){
      if(space==='client'){out[x]=a[x]+b.x;out[y]=a[y]+b.y}
      if(!Number.isSafeInteger(out[x])||!Number.isSafeInteger(out[y])||out[x]<b.x||out[y]<b.y||out[x]>=b.x+b.width||out[y]>=b.y+b.height) throw new Error('Mouse coordinates outside bound client area.')
    }
    return out
  })
}
