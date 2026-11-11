// Runtime-independent adapter. Inputs contain identities and activity, never text.
export function mapPose(state, parameters, profile, previous=null, keyCodes={}) {
  if(['unknown','locked'].includes(state.status))return {values:{...(previous?.values??{})},frozen:true,missing:previous?.missing??[],hand:previous?.hand??-1}
  const values={},missing=[...(profile.missingInputs??[])]
  const binds=profile.bindings??{}
  const set=(action,unit,neutral=false)=>{
    const id=binds[action];if(!id)return
    const p=parameters[id]
    if(!p || ![p.min,p.max,p.default].every(Number.isFinite)){missing.push(action);return}
    values[id]=neutral?p.default:p.min+(p.max-p.min)*Math.max(0,Math.min(1,profile.reverse?.[action]?1-unit:unit))
  }
  set('keyboard',state.keys?.length?1:0,true)
  if(state.keys?.length)set('keyboard',1)
  for(const b of ['left','right','middle'])set(b,state.buttons?.includes(b)?1:0,!state.buttons?.includes(b))
  const position=state.position
  const valid=position&&Number.isFinite(position.x)&&Number.isFinite(position.y)&&position.x>=0&&position.x<=1&&position.y>=0&&position.y<=1
  set('mouseX',valid?position.x:0,!valid);set('mouseY',valid?(profile.invertY?1-position.y:position.y):0,!valid)
  set('wheel',(Math.sign(state.wheelDirection??0)+1)/2,!(state.wheelMs>0))
  const codes=new Set((state.keys??[]).map(k=>keyCodes[k]).filter(Number.isInteger))
  // Generic modifier artwork may illustrate either side; status text retains
  // exact names and never claims a generic Ctrl was a physical left Ctrl.
  if(codes.has(160)||codes.has(161))codes.add(16)
  if(codes.has(162)||codes.has(163))codes.add(17)
  if(codes.has(164)||codes.has(165))codes.add(18)
  const hand=(profile.hands??[]).findIndex(h=>h.codes.every(c=>codes.has(c)))
  if(profile.hands?.length&&hand<0)set('keyboard',0,true) // No replacement image: keep the model's own hand visible.
  return {values,frozen:false,missing:[...new Set(missing)],hand}
}
export function displayText(s) {
  if(s.status==='locked')return '输入已锁定 · 释放未确认'
  if(s.status==='unknown')return '连接 / 释放状态未知 · 仅为最后确认'
  const parts=[]
  if(s.status==='syncing')parts.push('同步中')
  if(s.status==='releasing')parts.push('正在释放')
  if(s.textMs>0)parts.push('正在输入文本 · 内容不展示')
  if(s.keys?.length)parts.push(s.keys.join(' + '))
  if(s.keys?.some(k=>['ctrl','shift','alt'].includes(k)))parts.push('通用修饰键不区分左右')
  const labels={left:'鼠标左键',right:'鼠标右键',middle:'鼠标中键'}
  for(const b of s.buttons??[])parts.push(labels[b]??'鼠标')
  if(s.moveMs>0)parts.push('移动')
  if(s.wheelMs>0)parts.push(s.wheelDirection<0?'滚轮 ↓':'滚轮 ↑')
  const released=(s.pulses??[]).filter(p=>p.ms>0).filter(p=>p.id?.startsWith('key:')?!s.keys?.includes(p.id.slice(4)):p.id?.startsWith('button:')?!s.buttons?.includes(p.id.slice(7)):false).map(p=>p.id.startsWith('key:')?p.id.slice(4):(labels[p.id.slice(7)]??'鼠标'))
  if(released.length)parts.push('已释放 '+[...new Set(released)].join(' + ')+' · 余光')
  return parts.join(' · ')||(s.controlMode==='adaptive'?'未检测到新的键鼠动作 · 上方保留最后操作者':'待命 · 仅显示本插件的操作')
}
