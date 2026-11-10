#nullable enable
using System;
using System.Threading;
using System.Text.Json.Nodes;
using System.Windows.Threading;
namespace GamePlayer.Desktop;
// Only explicitly opted-in isolated QA. This source cannot read an OS cursor.
internal sealed partial class PetWindow {
    bool cursorQaRunning,cursorQaTour;double cursorQaStart,cursorQaMaxGap;double? cursorQaLastSample;
    long cursorQaSamples;int cursorQaDropAcks,cursorQaDropTargets;CursorGazeValue cursorQaTarget=new(true);
    JsonObject? cursorQaPressure;
    string CursorQaPauseReason=>dead||rendererDisposed?"disposed":loading?"loading":adjusting?"adjusting":UseKeyboard?"keyboard":cursorSessionLocked||cursorSessionDisconnected?"session":userHidden?"hidden":!cursorQaRunning?"disabled":"active";
    CursorGazeValue CursorQaValue(double now){
        if(!cursorQaTour)return cursorQaTarget;double t=((now-cursorQaStart)%60000)/1000;
        if(t<1)return new(true);if(t<3)return new(true,-(t-1)/2,0);if(t<5)return new(true,-1,0);
        if(t<7)return new(true,-1+(t-5),0);if(t<9)return new(true,1,0);if(t<11)return new(true,0,1);if(t<13)return new(true,0,-1);
        if(t<17)return new(true,(t-13)/2-1,(t-13)/2-1);if(t<25)return new(true,Math.Sin((t-17)*Math.PI/2),Math.Cos((t-17)*Math.PI/2));
        if(t<35)return new(true,(int)(t*4)%2==1?1:-1,(int)(t*4)%2==1?-1:1);if(t<45)return new(false);return new(true,.6,-.4);
    }
    void CursorQaCommand(JsonObject data){
        if(!qa||!qaInteractive)throw new InvalidOperationException("Private canvas QA only");
        if(data["kind"]?.GetValue<string>()=="qa-cursor-pressure"){CursorQaLoad(data);return;}
        if(data["enabled"] is JsonValue e){cursorQaRunning=e.GetValue<bool>();if(cursorQaRunning){cursorQaStart=CursorGazeRules.Now;cursorQaMaxGap=0;cursorQaSamples=0;cursorQaLastSample=null;cursorChannel.ResetDiagnostics();} }
        if(data["tour"] is JsonValue tour)cursorQaTour=tour.GetValue<bool>();
        if(data["valid"] is JsonValue valid){bool ok=valid.GetValue<bool>();double x=data["x"]?.GetValue<double>()??0,y=data["y"]?.GetValue<double>()??0;if(!double.IsFinite(x)||!double.IsFinite(y)||Math.Abs(x)>1||Math.Abs(y)>1)throw new InvalidOperationException("Invalid synthetic target");cursorQaTarget=new(ok,x,y);}
        cursorQaDropAcks=Math.Clamp(data["dropAcks"]?.GetValue<int>()??cursorQaDropAcks,0,1000000);cursorQaDropTargets=Math.Clamp(data["dropTargets"]?.GetValue<int>()??cursorQaDropTargets,0,1000000);
        SyncCursorGaze();
    }
    void CursorQaLoad(JsonObject data){
        double duration=data["durationMs"]?.GetValue<double>()??0;string priority=data["priority"]?.GetValue<string>()??"Input";
        if(!double.IsFinite(duration)||duration<100||duration>3000||priority is not("Input" or "Render"))throw new InvalidOperationException("Invalid bounded dispatcher load");
        double start=CursorGazeRules.Now;int backgroundTicks=0;var legacy=new DispatcherTimer(DispatcherPriority.Background){Interval=TimeSpan.FromSeconds(1.0/30)};
        legacy.Tick+=(_,_)=>backgroundTicks++;legacy.Start();long before=cursorQaSamples;cursorQaPressure=new JsonObject{["running"]=true};
        Action? pump=null;pump=()=>{if(dead||CursorGazeRules.Now-start>=duration){legacy.Stop();cursorQaPressure=new JsonObject{["running"]=false,["priority"]=priority,["elapsedMs"]=CursorGazeRules.Now-start,["backgroundTicks"]=backgroundTicks,["normalSamples"]=cursorQaSamples-before};return;}
            double end=CursorGazeRules.Now+1;while(CursorGazeRules.Now<end)Thread.SpinWait(100);Dispatcher.BeginInvoke(priority=="Input"?DispatcherPriority.Input:DispatcherPriority.Render,pump!);};
        Dispatcher.BeginInvoke(priority=="Input"?DispatcherPriority.Input:DispatcherPriority.Render,pump);
    }
}
