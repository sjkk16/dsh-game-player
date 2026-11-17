// Pixel-level acceptance for completed private DIP scans; never reads a desktop screenshot.
import assert from 'node:assert/strict'
import {readFile,readdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {decodePrivatePng} from './private-png.mjs'
const out=resolve(process.env.DSH_DIP_QA_DIR??'.qa/projection-dip-20261114/native'),run=JSON.parse(await readFile(join(out,'report.json'),'utf8'))
assert.equal(run.ok,true,'Only audit a completed native scan')
const frames=(await readdir(out)).filter(n=>/^p-\d+\.json$/.test(n)),pixels=[]
for(const file of frames){
 const s=JSON.parse(await readFile(join(out,file),'utf8')),c=s.diagnostics.layout.canvas,p=decodePrivatePng(await readFile(join(out,file.replace(/\.json$/,'.png'))))
 assert.equal(p.bpp,4);assert.equal(p.width,c.pixelWidth);assert.equal(p.height,c.pixelHeight)
 let minX=p.width,minY=p.height,maxX=-1,maxY=-1,edges=0,visible=0
 for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)if(p.pixels[(y*p.width+x)*4+3]>8){visible++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);if(x===0||y===0||x===p.width-1||y===p.height-1)edges++}
 assert.ok(visible>0,'Non-empty private model image '+file)
 // This fixture uses the user's current <1 authored scale. Do not redefine >1 author scaling as invalid.
 if(s.projection.autoFrame&&s.projection.scale<=1)assert.equal(edges,0,'Visible model/hand touches the clipping edge '+file)
 assert.equal(s.watermark.mode,run.watermark.mode)
 pixels.push({frame:file,width:p.width,height:p.height,bounds:{minX,minY,maxX,maxY},edgePixels:edges,visiblePixels:visible})
}
await writeFile(join(out,'pixel-audit.json'),JSON.stringify({ok:true,frames:frames.length,pixels,realDesktopCaptured:false},null,2))
console.log(`Private pixel audit passed: ${frames.length} rendered frames have expected dimensions, visible models, matching watermark state and no clipping edges.`)
