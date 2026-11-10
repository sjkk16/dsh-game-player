#nullable enable
using System;
using System.Text.Json.Nodes;
namespace GamePlayer.Desktop;
internal sealed partial class PetWindow {
    string? confirmedShowId, confirmedShowToken;
    void FailConfirmedShow(string reason){if(confirmedShowId!=null){Ack(confirmedShowId,false,reason);confirmedShowId=confirmedShowToken=null;}}
    void BeginConfirmedShow(string? id,string? token){
        if(qa||!modelReady||package==null||token!=package.Token)throw new InvalidOperationException("Confirmed display requires the committed model and a real display window.");
        CancelShow();Hide();rendererVisible=false;Post(new JsonObject{["kind"]="visibility",["visible"]=false});
        confirmedShowId=id;confirmedShowToken=token;activated=true;userHidden=false;viewOverride="model";Place();VisibleGate();
    }
    void ConfirmVisibleFrame(){
        if(confirmedShowId==null||!modelReady||package?.Token!=confirmedShowToken||!showPrepared||showPending||!rendererVisible||!IsVisible||!Native.IsWindowVisible(hwnd)||captureHidden)return;
        Output(new{kind="ack",id=confirmedShowId,ok=true,visible=true,framePrepared=true,modelToken=confirmedShowToken});confirmedShowId=confirmedShowToken=null;
    }
    long showTicket;bool showPending,showPrepared;string? preparedInputKey;DateTime showDeadline;
    JsonObject? ShowSnapshot(){lock(inboxLock)return (latest??state)?.DeepClone() as JsonObject;}
    static string InputKey(JsonObject? snapshot){var key=new JsonObject();foreach(var name in new[]{"mode","status","keys","buttons","position"})key[name]=snapshot?[name]?.DeepClone();return key.ToJsonString();}
    bool PrepareShow(){
        var snapshot=ShowSnapshot();string key=InputKey(snapshot)+"\0"+package?.Token;
        if(showPrepared&&preparedInputKey==key)return true;
        if(!showPending||preparedInputKey!=key){showPrepared=false;showPending=true;preparedInputKey=key;showTicket++;showDeadline=DateTime.UtcNow.AddSeconds(5);Post(new JsonObject{["kind"]="prepare-show",["ticket"]=showTicket,["token"]=package?.Token,["state"]=snapshot});}
        return false;
    }
    void CancelShow(){FailConfirmedShow("Display confirmation canceled.");if(showPending||showPrepared){showPending=showPrepared=false;showTicket++;}}
    void ShowReady(JsonObject message){
        if(qaInteractive&&message["id"]!=null){Output(new{kind="ack",id=message["id"]!.GetValue<string>(),ok=true,values=message["values"]});return;}
        if(!showPending||message["ticket"]?.GetValue<long>()!=showTicket||message["token"]?.GetValue<string>()!=package?.Token)return;
        showPending=false;showPrepared=preparedInputKey==InputKey(ShowSnapshot())+"\0"+package?.Token;VisibleGate();
    }
}
