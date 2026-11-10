// Internal liveness receipts, paced by the existing draw loop. No pointer coordinates.
export class CursorProgress {
 constructor(){this.token=null;this.floor=0;this.lastAt=null}
 control(message,token){
  if(message.token!==token||typeof message.enabled!=='boolean'||!Number.isSafeInteger(message.floor)||message.floor<0)return false
  if(!message.enabled){if(this.token===token){this.token=null;this.lastAt=null}return true}
  if(this.token===token&&message.floor<=this.floor)return false
  this.token=token;this.floor=message.floor;this.lastAt=null;return true
 }
 update(now,token,sequence,frame,visible){
  if(!visible||this.token!==token||!Number.isFinite(now)||!Number.isSafeInteger(frame)||frame<1)return null
  if(this.lastAt!==null&&now-this.lastAt<250)return null
  this.lastAt=now;return {kind:'cursor-gaze-progress',token,sequence:Math.max(this.floor,sequence),frame}
 }
 reset(){this.token=null;this.lastAt=null;this.floor=0}
}
