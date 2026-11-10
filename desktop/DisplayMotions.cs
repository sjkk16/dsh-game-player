#nullable enable
using System;
using System.IO;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
namespace GamePlayer.Desktop;
internal sealed partial class PetWindow {
    JsonArray? modelMotions, pendingModelMotions;
    void MotionCommand(JsonObject data) {
        string? kind=data["kind"]?.GetValue<string>();
        if(!webReady||rendererDisposed||!modelReady)throw new InvalidOperationException("Live2D motion playback is unavailable");
        if(kind=="play-motion") {
            if(data["token"]?.GetValue<string>()!=package?.Token)throw new InvalidOperationException("Motion model generation changed");
            string? motion=data["motionId"]?.GetValue<string>(),ticket=data["ticket"]?.GetValue<string>();
            if(motion==null||!Regex.IsMatch(motion,"^motion-[0-9]{1,2}$")||!Guid.TryParse(ticket,out _))throw new InvalidDataException("Invalid motion request");
        }
        Post(data);
    }
    void MotionReply(JsonObject message) {
        string? kind=message["kind"]?.GetValue<string>(),id=message["id"]?.GetValue<string>(),token=message["token"]?.GetValue<string>();
        if(token!=package?.Token){Ack(id,false,"Motion reply belongs to an expired model");return;}
        if(kind=="motion-catalog") {
            modelMotions=message["motions"]?.DeepClone() as JsonArray;
            Output(new {kind="ack",id,ok=true,modelToken=token,signature=message["signature"]?.GetValue<string>(),motions=modelMotions});PublishStatus();
        } else if(kind=="motion-ended") Output(new {kind="motion-ended",token,ticket=message["ticket"]?.GetValue<string>(),reason=message["reason"]?.GetValue<string>()});
        else Output(new {kind="ack",id,ok=message["ok"]?.GetValue<bool>()==true,error=message["error"]?.GetValue<string>(),modelToken=token,ticket=message["ticket"]?.GetValue<string>(),durationMs=message["durationMs"]?.GetValue<int>()});
    }
    void QaStepReply(JsonObject message, bool sample = false) {
        string? name=message["name"]?.GetValue<string>();
        if(name==null||!Regex.IsMatch(name,"^[a-zA-Z0-9_-]{1,64}$"))throw new InvalidDataException("Invalid private QA frame name");
        string image=message["image"]!.GetValue<string>();if(!image.StartsWith("data:image/png;base64,"))throw new InvalidDataException("Invalid private canvas frame");
        File.WriteAllBytes(Path.Combine(qaDir!,name+".png"),Convert.FromBase64String(image.Substring(22)));
        message.Remove("image");File.WriteAllText(Path.Combine(qaDir!,name+".json"),message.ToJsonString());
        message["kind"]=sample?"qa-run-sample":"ack";message["ok"]=true;message["frame"]=name;Output(message);
    }
}
