#nullable enable
using System;
using System.Diagnostics;
namespace GamePlayer.Desktop;
internal readonly record struct CursorGazeValue(bool Valid, double X = 0, double Y = 0);
internal readonly record struct CursorGazePacket(string Token, long Sequence, CursorGazeValue Value);
internal static class CursorGazeRules {
    internal static double Now => Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency;
    internal static CursorGazeValue Normalize(int x,int y,int left,int top,int width,int height) {
        if(width<=1||height<=1)return new(false);
        return new(true,Math.Clamp(((double)x-left)/(width-1)*2-1,-1,1),Math.Clamp(1-((double)y-top)/(height-1)*2,-1,1));
    }
    internal static bool CanSample(bool qa,bool alive,bool ready,bool modelReady,bool loading,bool visible,bool nativeVisible,bool adjusting,bool modelView,bool sessionAvailable) =>
        !qa&&alive&&ready&&modelReady&&!loading&&visible&&nativeVisible&&!adjusting&&modelView&&sessionAvailable;
}
// Absolute monotonic deadlines; a delayed tick consumes only the current position.
internal sealed class CursorSampleCadence {
    const double Period=1000.0/30;double next;
    internal void Reset(double now){next=now;}
    internal bool Due(double now){if(now+.01<next)return false;next+=Math.Max(1,Math.Floor((now-next+.01)/Period)+1)*Period;return true;}
    internal double Remaining(double now)=>Math.Max(1,next-now);
}
internal sealed class CursorGazeChannel {
    readonly Func<double> now;
    internal CursorGazeChannel(Func<double>? clock=null){now=clock??(()=>CursorGazeRules.Now);}
    internal string? Token {get;private set;}
    internal long Sequence=>sequence;
    long sequence,progressFloor,lastFrame,frameAtSend;string? previousToken;
    double sentAt;CursorGazePacket? inFlight;CursorGazeValue? pending,lastSent,latest;
    internal bool DiagnosticsEnabled;
    internal long Sent,Acknowledged,Coalesced,AckRecoveries,TargetRecoveries,LastReceived;
    internal double MaxWaitMs;
    internal void ResetDiagnostics(){Sent=Acknowledged=Coalesced=AckRecoveries=TargetRecoveries=0;LastReceived=0;MaxWaitMs=0;}
    internal int Queued=>pending.HasValue?1:0;
    internal bool InFlight=>inFlight.HasValue;
    internal void Begin(string token){if(Token==token)return;progressFloor=previousToken==token?sequence:0;previousToken=Token=token;inFlight=null;pending=null;lastSent=null;latest=null;}
    internal CursorGazePacket? Offer(CursorGazeValue value){
        if(Token==null)return null;latest=value;
        if(inFlight.HasValue){pending=value==inFlight.Value.Value?null:value;if(DiagnosticsEnabled)Coalesced++;return null;}
        if(lastSent==value)return null;pending=value;return Flush();
    }
    CursorGazePacket? Flush(){
        if(Token==null||inFlight.HasValue||!pending.HasValue)return null;
        var packet=new CursorGazePacket(Token,++sequence,pending.Value);pending=null;lastSent=packet.Value;inFlight=packet;sentAt=now();frameAtSend=lastFrame;if(DiagnosticsEnabled)Sent++;return packet;
    }
    void RecordWait(){if(DiagnosticsEnabled)MaxWaitMs=Math.Max(MaxWaitMs,Math.Max(0,now()-sentAt));}
    internal CursorGazePacket? Complete(string? token,long reply){
        if(!inFlight.HasValue||inFlight.Value.Token!=token||inFlight.Value.Sequence!=reply)return null;
        RecordWait();if(DiagnosticsEnabled){Acknowledged++;LastReceived=Math.Max(LastReceived,reply);}inFlight=null;return Flush();
    }
    // No timer retransmission: only fresh renderer progress can recover a blocked slot.
    internal CursorGazePacket? Progress(string? token,long received,long frame){
        if(Token==null||token!=Token||received<progressFloor||received>sequence||frame<=lastFrame)return null;
        lastFrame=frame;if(DiagnosticsEnabled)LastReceived=Math.Max(LastReceived,received);if(!inFlight.HasValue)return null;
        if(received>=inFlight.Value.Sequence){if(DiagnosticsEnabled)AckRecoveries++;return Complete(token,inFlight.Value.Sequence);}
        if(now()-sentAt<250||frame<=frameAtSend||!latest.HasValue)return null;
        RecordWait();if(DiagnosticsEnabled)TargetRecoveries++;inFlight=null;lastSent=null;pending=latest;return Flush();
    }
    internal CursorGazePacket? Suspend(){var token=Token;Token=null;pending=null;inFlight=null;lastSent=null;latest=null;return token==null?null:new CursorGazePacket(token,++sequence,new(false));}
}
