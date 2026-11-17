// One fit in model coordinates. The renderer multiplies Y by viewport aspect,
// so the available model-space height is 2/aspect, not 2*aspect.
// Authored scale, offsets and flips are deliberately applied by the caller.
export function projectionFit(width,height,bounds,autoFrame,canvasWidth) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Invalid projection viewport')
  if(!autoFrame){
    if(!Number.isFinite(canvasWidth)||canvasWidth<=0)throw Error('Invalid model canvas width')
    return 2/canvasWidth
  }
  const {minX,minY,maxX,maxY}=bounds??{}
  if(![minX,minY,maxX,maxY].every(Number.isFinite)||maxX<=minX||maxY<=minY)throw Error('Invalid projection bounds')
  const aspect=width/height,fit=Math.min(2/(maxX-minX),2/(aspect*(maxY-minY)))*.94
  if(!Number.isFinite(fit)||fit<=0)throw Error('Invalid projection fit')
  return fit
}
