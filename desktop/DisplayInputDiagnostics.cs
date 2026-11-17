#nullable enable
using System;
using System.Text.Json.Nodes;
namespace GamePlayer.Desktop;
internal sealed partial class PetWindow {
    long inputReceivedCount,inputPostedCount,inputReceivedAt,inputPostedAt,inputReceivedSequence,inputPostedSequence;
    int inputReceivedKeys,inputPostedKeys;
    static long InputSequence(JsonObject value) => value["displaySequence"] is JsonValue sequence && sequence.TryGetValue<long>(out var n) && n >= 0 ? n : 0;
    // Read() already owns inboxLock. Posting is owned by the UI dispatcher.
    void RecordInputReceived(JsonObject value){inputReceivedCount++;inputReceivedAt=Environment.TickCount64;inputReceivedSequence=InputSequence(value);inputReceivedKeys=(value["keys"] as JsonArray)?.Count??0;}
    void RecordInputPosted(JsonObject value){lock(inboxLock){inputPostedCount++;inputPostedAt=Environment.TickCount64;inputPostedSequence=InputSequence(value);inputPostedKeys=(value["keys"] as JsonArray)?.Count??0;}}
    JsonObject InputDiagnostics(JsonNode? renderer){
        JsonObject desktop;long now=Environment.TickCount64;
        lock(inboxLock){desktop=new JsonObject{
            ["receivedCount"]=inputReceivedCount,["postedCount"]=inputPostedCount,["receivedSequence"]=inputReceivedSequence,["postedSequence"]=inputPostedSequence,
            ["receivedKeyCount"]=inputReceivedKeys,["postedKeyCount"]=inputPostedKeys,["lastReceivedAgeMs"]=inputReceivedCount==0?null:now-inputReceivedAt,
            ["lastPostedAgeMs"]=inputPostedCount==0?null:now-inputPostedAt,["rendererReady"]=webReady&&!rendererDisposed,["visible"]=rendererVisible};}
        return new JsonObject{["observer"]=humanObserver?.Diagnostics(),["observerError"]=humanObserverFailure,["desktop"]=desktop,["renderer"]=renderer?.DeepClone()};
    }
}
