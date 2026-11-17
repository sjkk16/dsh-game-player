// Decoder for our own 8-bit RGB/RGBA private canvas PNGs, not arbitrary user uploads.
import{inflateSync}from'node:zlib'
export function decodePrivatePng(bytes){
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Not a private PNG')
 let width,height,type;const chunks=[]
 for(let at=8;at<bytes.length;){const size=bytes.readUInt32BE(at),name=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+size);if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);type=data[9];if(data[8]!==8||data[12]!==0||![2,6].includes(type)||width<1||height<1||width>8192||height>8192||width*height>16777216)throw Error('Unsupported private canvas PNG')}if(name==='IDAT')chunks.push(data);at+=size+12}
 const bpp=type===6?4:3,stride=width*bpp,raw=inflateSync(Buffer.concat(chunks));if(raw.length!==(stride+1)*height)throw Error('Truncated private canvas PNG');const rows=Buffer.alloc(height*stride);let at=0
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c}
 for(let y=0;y<height;y++){const filter=raw[at++];for(let x=0;x<stride;x++){const left=x>=bpp?rows[y*stride+x-bpp]:0,up=y?rows[(y-1)*stride+x]:0,upperLeft=y&&x>=bpp?rows[(y-1)*stride+x-bpp]:0;const prediction=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,upperLeft):NaN;if(!Number.isFinite(prediction))throw Error('Unsupported PNG filter');rows[y*stride+x]=(raw[at++]+prediction)&255}}
 return {width,height,bpp,pixels:rows}
}
export function comparePrivatePng(a,b){const x=decodePrivatePng(a),y=decodePrivatePng(b);if(x.width!==y.width||x.height!==y.height||x.bpp!==y.bpp)throw Error('Private canvas dimensions changed');let changedChannels=0,maxDelta=0,totalDelta=0;for(let i=0;i<x.pixels.length;i++){const delta=Math.abs(x.pixels[i]-y.pixels[i]);if(delta)changedChannels++;maxDelta=Math.max(maxDelta,delta);totalDelta+=delta}return {changedChannels,maxDelta,totalDelta,totalChannels:x.pixels.length}}
