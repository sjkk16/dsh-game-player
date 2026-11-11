// Display metadata only; never changes native input or model parameters.
export const actorText=actor=>actor==='human'?'人控制':actor==='ai'?'AI控制':'控制自适应模式'
export const footerPresentation=(visible,status)=>({hidden:!visible&&!['unknown','locked'].includes(status),capabilitiesHidden:!visible})
