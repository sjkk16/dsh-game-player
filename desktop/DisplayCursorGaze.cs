#nullable enable
using System;
using System.Text.Json.Nodes;
using System.Windows.Threading;
using Forms=System.Windows.Forms;
namespace GamePlayer.Desktop;
internal sealed partial class PetWindow {
    readonly DispatcherTimer cursorTimer=new(DispatcherPriority.Normal){Interval=TimeSpan.FromSeconds(1.0/30)};
    readonly CursorGazeChannel cursorChannel=new();readonly CursorSampleCadence cursorCadence=new();
    bool cursorSessionRegistered,cursorSessionLocked,cursorSessionDisconnected;long cursorReads;
    void InitializeCursorGaze(){
        cursorSessionRegistered=Native.WTSRegisterSessionNotification(hwnd,0);cursorChannel.DiagnosticsEnabled=qa;
        cursorTimer.Tick+=(_,_)=>SampleCursorGaze();
        if(!cursorSessionRegistered&&!qa)Warn("System cursor gaze unavailable: session notification registration failed.");
    }
    bool CursorCanSample=>package!=null&&(qa&&qaInteractive&&cursorQaRunning
        ?CursorGazeRules.CanSample(false,!dead&&!rendererDisposed,webReady,modelReady,loading,!userHidden,true,adjusting,!UseKeyboard,!cursorSessionLocked&&!cursorSessionDisconnected)
        :CursorGazeRules.CanSample(qa,!dead&&!rendererDisposed,webReady,modelReady,loading,rendererVisible&&IsVisible,Native.IsWindowVisible(hwnd),adjusting,!UseKeyboard,cursorSessionRegistered&&!cursorSessionLocked&&!cursorSessionDisconnected));
    void SyncCursorGaze(){
        if(!CursorCanSample){StopCursorGaze();return;}
        bool changed=cursorChannel.Token!=package!.Token;cursorChannel.Begin(package!.Token);
        if(!cursorTimer.IsEnabled||changed){
            Post(new JsonObject{["kind"]="cursor-gaze-control",["token"]=package.Token,["enabled"]=true,["floor"]=cursorChannel.Sequence});
            cursorCadence.Reset(CursorGazeRules.Now);cursorQaLastSample=null;cursorTimer.Start();SampleCursorGaze();
        }
    }
    void SendCursorGaze(CursorGazePacket? packet){
        if(packet is not CursorGazePacket p)return;
        if(qa&&cursorQaRunning&&cursorQaDropTargets>0){cursorQaDropTargets--;return;}
        var message=new JsonObject{["kind"]="cursor-gaze",["token"]=p.Token,["sequence"]=p.Sequence,["valid"]=p.Value.Valid};
        if(p.Value.Valid){message["x"]=p.Value.X;message["y"]=p.Value.Y;}Post(message);
    }
    void SampleCursorGaze(){
        if(!CursorCanSample){StopCursorGaze();return;}
        double now=CursorGazeRules.Now;if(!cursorCadence.Due(now)){cursorTimer.Interval=TimeSpan.FromMilliseconds(cursorCadence.Remaining(now));return;}
        CursorGazeValue value;
        if(qa){value=CursorQaValue(now);cursorQaSamples++;if(cursorQaLastSample.HasValue)cursorQaMaxGap=Math.Max(cursorQaMaxGap,now-cursorQaLastSample.Value);cursorQaLastSample=now;}
        else{cursorReads++;value=new(false);if(Native.GetCursorPos(out var p)){var b=Forms.SystemInformation.VirtualScreen;value=CursorGazeRules.Normalize(p.X,p.Y,b.Left,b.Top,b.Width,b.Height);}}
        SendCursorGaze(cursorChannel.Offer(value));cursorTimer.Interval=TimeSpan.FromMilliseconds(cursorCadence.Remaining(CursorGazeRules.Now));
    }
    void CursorGazeAck(JsonObject message){
        if(!CursorCanSample)return;
        if(qa&&cursorQaRunning&&cursorQaDropAcks>0){cursorQaDropAcks--;return;}
        if(message["sequence"] is JsonValue v&&v.TryGetValue<long>(out var seq))SendCursorGaze(cursorChannel.Complete(message["token"]?.GetValue<string>(),seq));
    }
    void CursorGazeProgress(JsonObject message){
        if(!CursorCanSample)return;
        if(message["sequence"] is JsonValue v&&v.TryGetValue<long>(out var seq)&&message["frame"] is JsonValue f&&f.TryGetValue<long>(out var frame))SendCursorGaze(cursorChannel.Progress(message["token"]?.GetValue<string>(),seq,frame));
    }
    void StopCursorGaze(){
        cursorTimer.Stop();var packet=cursorChannel.Suspend();
        if(packet is CursorGazePacket p){Post(new JsonObject{["kind"]="cursor-gaze-control",["token"]=p.Token,["enabled"]=false,["floor"]=p.Sequence});SendCursorGaze(packet);}
        cursorQaLastSample=null;
    }
    void DisposeCursorGaze(){StopCursorGaze();if(cursorSessionRegistered){Native.WTSUnRegisterSessionNotification(hwnd);cursorSessionRegistered=false;}}
    void CursorSessionChanged(int reason){
        if(reason==7)cursorSessionLocked=true;else if(reason==8)cursorSessionLocked=false;
        if(reason is 2 or 4 or 6)cursorSessionDisconnected=true;else if(reason is 1 or 3)cursorSessionDisconnected=false;SyncCursorGaze();
    }
}
