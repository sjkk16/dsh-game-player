// Safe mathematical + actual render-method regressions. No native process/input.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {projectionFit} from '../src/live2d/projection.js'
const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`)
const bounds={minX:-.495,minY:-.502,maxX:.475,maxY:.496},spanX=bounds.maxX-bounds.minX,spanY=bounds.maxY-bounds.minY
const oldFit=(w,h,b)=>Math.min(2/(b.maxX-b.minX),2*(w/h)/(b.maxY-b.minY))*.94
const problematic=oldFit(231,209,bounds)*(231/209)*spanY
assert.ok(problematic>2,'Legacy formula overflows the narrow canvas height')
const corrected=projectionFit(231,209,bounds,true,1)*(231/209)*spanY
close(corrected,1.88)
for(const [w,h] of [[400,120],[120,400],[231,209],[231,223],[231,231],[231,250]]){
 const f=projectionFit(w,h,bounds,true,1),screenX=f*w/2,screenY=f*(w/h)*h/2
 close(screenX,screenY);close(screenX,.94*Math.min(w/spanX,h/spanY))
 assert.ok(f*spanX<=1.88+1e-6&&f*(w/h)*spanY<=1.88+1e-6)
}
let scanCases=0
for(let dip=220;dip<=300;dip++)for(const dpr of [1,1.25,1.5,1.75,2])for(const delta of [0,-14,-42,32]){
 const cw=dip-8,ch=cw+delta,w=Math.round(cw*dpr),h=Math.round(ch*dpr)
 const f=projectionFit(w,h,bounds,true,1),x=f*w/2,y=f*(w/h)*h/2
 close(x,y);close(x,.94*Math.min(w/spanX,h/spanY))
 // CSS pixel rounding can introduce <1 physical pixel, never a DIP-specific fit jump.
 close(x/dpr,.94*Math.min(cw/spanX,ch/spanY),.6)
 assert.ok(x*spanX<=w*.94+1e-6&&y*spanY<=h*.94+1e-6);scanCases++
}
for(const dip of [420,1000])for(const dpr of [1,1.25,1.5,1.75,2]){
 const pixels=Math.round((dip-8)*dpr);close(projectionFit(pixels,pixels,bounds,true,1),projectionFit(1,1,bounds,true,1))
}
// Continuity at the width/height-limited switch, including neighboring DIP values.
const h=200,switchWidth=h*spanX/spanY
for(const w of [switchWidth-.0001,switchWidth,switchWidth+.0001])close(projectionFit(w,h,bounds,true,1)*w/2,.94*Math.min(w/spanX,h/spanY))
close(projectionFit(231,231,bounds,true,1),oldFit(231,231,bounds))
for(const w of [220,239,300,420])for(const height of [160,300,500])close(projectionFit(w,height,null,false,2.5),.8)
for(const dims of [[0,2],[-1,2],[NaN,2],[2,Infinity]])assert.throws(()=>projectionFit(...dims,bounds,true,1),/viewport/)
for(const b of [null,{...bounds,maxX:bounds.minX},{...bounds,maxY:NaN}])assert.throws(()=>projectionFit(220,220,b,true,1),/bounds/)
assert.throws(()=>projectionFit(220,220,bounds,false,0),/canvas width/)
// Exercise the production render method, including unchanged author layout and hand transform.
const source=await readFile(new URL('../desktop/model-scene.js',import.meta.url),'utf8')
assert.ok(source.includes('projectionFit(width,height,b,l.autoFrame,c.getCanvasWidth())'))
assert.doesNotMatch(source,/2\*aspect\/\(b\.maxY-b\.minY\)/)
const method=source.slice(source.indexOf(' render(width'),source.indexOf(' probe(state)')).trim()
class Matrix{setMatrix(v){this.values=Array.from(v)}}
const sandbox=vm.createContext({projectionFit,CubismMatrix44:Matrix,Float32Array})
const Scene=vm.runInContext('class FixtureScene{'+method+'};FixtureScene',sandbox)
let renders=0
for(const autoFrame of [true,false])for(const flip of [true,false])for(const scale of [.5,1,1.75]){
 const scene=new Scene(),transforms=[],w=260,height=192,author={sx:1.2,sy:.8,x:.15,y:-.12},layout={autoFrame,scale,flip,offset:[12,-7],size:[1000,1000],handOffset:[4,5]},core={getCanvasWidth:()=>2.5,getCanvasHeight:()=>2}
 let matrix
 scene.gl={FRAMEBUFFER:1,COLOR_BUFFER_BIT:2,bindFramebuffer(){},viewport(){},clearColor(){},clear(){}}
 scene.model={core:()=>core,getRenderer:()=>({setMvpMatrix:m=>{matrix=m},setRenderState(){},drawModel(){}})}
 scene.manifest={layout};scene.bounds=bounds;scene.author=author;scene.pose={hand:0};scene.handCache={get:()=>({width:128,height:64})}
 scene.render(w,height,null,{clearRect(){},save(){},setTransform:(...v)=>transforms.push(v),drawImage(){},restore(){}})
 const fit=autoFrame?.94*Math.min(2/spanX,2*height/(w*spanY)):2/2.5
 const sx=fit*scale*(flip?-1:1),sy=Math.abs(fit*scale)*w/height
 const tx=(-(bounds.minX+bounds.maxX)/2*sx+2*12/1000)*author.sx+author.x,ty=(-(bounds.minY+bounds.maxY)/2*sy+2*7/1000)*author.sy+author.y
 close(matrix.values[0],sx*author.sx);close(matrix.values[5],sy*author.sy);close(matrix.values[12],tx);close(matrix.values[13],ty)
 close(transforms[0][0],sx*author.sx*2.5*w/(2*128));close(transforms[0][3],sy*author.sy*2*height/(2*64))
 close(transforms[0][4],(1+tx-sx*author.sx*2.5/2)*w/2);close(transforms[0][5],(1-ty-sy*author.sy*2/2)*height/2)
 renders++
}
console.log(`Projection regression passed: ${scanCases} DIP/DPR/shape cases, ${renders} production render combinations; overflow, continuity, manual mode, authored transforms and hands verified. No native input/capture.`)
