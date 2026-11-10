#nullable enable
using System;
using System.Text.Json.Nodes;
namespace GamePlayer.Desktop;
internal sealed partial class PetWindow {
    JsonObject? modelAdapter,pendingModelAdapter;
    void AdapterReply(JsonObject message) {
        if(package==null||message["token"]?.GetValue<string>()!=package.Token)return;
        if(message["kind"]?.GetValue<string>()=="adapter-status") {if(modelAdapter!=null)modelAdapter["handCache"]=message["handCache"]?.DeepClone();PublishStatus();return;}
        modelAdapter=message["adapter"]?.DeepClone() as JsonObject;
        Output(new{kind="ack",id=message["id"]?.GetValue<string>(),ok=true,modelToken=package.Token,signature=package.Manifest["signature"]?.GetValue<string>(),modelKey=package.ModelKey,modelSourcePath=package.SourcePath,modelEntry=package.ModelEntry,adapter=modelAdapter,sourceProof=package.SourceProof});PublishStatus();
    }
}
