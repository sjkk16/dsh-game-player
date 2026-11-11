#nullable enable
using System;
using System.Text.Json.Nodes;
namespace GamePlayer.Desktop;
internal static class AdaptiveObservationRules {
    internal static bool CanObserve(bool qa,bool dead,bool activated,bool hidden,string mode,bool registered,bool locked,bool disconnected)=>!qa&&!dead&&activated&&!hidden&&mode=="adaptive"&&registered&&!locked&&!disconnected;
}
internal sealed partial class PetWindow {
    HumanInputObserver? humanObserver;string? humanObserverFailure;
    bool HumanCanObserve=>AdaptiveObservationRules.CanObserve(qa,dead,activated,userHidden,settings.ControlMode,cursorSessionRegistered,cursorSessionLocked,cursorSessionDisconnected);
    void SyncControlObserver(){
        if(!qa&&!dead&&activated&&!userHidden&&settings.ControlMode=="adaptive"&&!cursorSessionRegistered){
            if(humanObserverFailure==null){humanObserverFailure="System session notifications unavailable; read-only observation stays disabled.";Output(new{kind="human-observer-status",status="error",session=""});}
            return;
        }
        if(!HumanCanObserve){StopControlObserver();return;}
        if(humanObserver!=null&&!humanObserver.IsRunning){var failed=humanObserver.Session;humanObserver.Dispose();humanObserver=null;humanObserverFailure="Read-only input observer disconnected.";Output(new{kind="human-observer-status",status="error",session=failed});}
        if(humanObserver!=null||humanObserverFailure!=null)return;
        var candidate=new HumanInputObserver(value=>Output(value));
        if(candidate.Start()){humanObserver=candidate;return;}
        humanObserverFailure=candidate.Error??"Read-only input observation unavailable.";candidate.Dispose();
        Output(new{kind="human-observer-status",status="error",session="",error="read-only observer unavailable"});Warn(humanObserverFailure);
    }
    void StopControlObserver(){
        if(humanObserver!=null){var old=humanObserver.Session;humanObserver.Dispose();humanObserver=null;Output(new{kind="human-observer-status",status="stopped",session=old});}
        humanObserverFailure=null;
    }
    void PushDisplayPreferences(){Post(new JsonObject{["kind"]="display-preferences",["modelInfoVisible"]=settings.ModelInfoVisible});}
}
