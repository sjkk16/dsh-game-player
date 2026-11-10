#nullable enable
using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using System.Windows;
using Forms = System.Windows.Forms;

namespace GamePlayer.Desktop;
internal sealed partial class PetWindow {
    void Read() {
        try {
            var line = new StringBuilder(); int c;
            while ((c = Console.In.Read()) != -1) {
                if (c != '\n') { if (c != '\r') { if (line.Length >= 65536) throw new InvalidDataException("IPC line too long"); line.Append((char)c); } continue; }
                if (line.Length == 0) continue;
                var data = JsonNode.Parse(line.ToString(), documentOptions: new JsonDocumentOptions { MaxDepth = 32 })!.AsObject(); line.Clear();
                bool post = false;
                lock (inboxLock) {
                    if (data["kind"]?.GetValue<string>() == "state") latest = data;
                    else { if (commands.Count >= 64) throw new InvalidDataException("Control queue full"); commands.Enqueue(data); }
                    if (!inboxPosted) { inboxPosted = true; post = true; }
                }
                if (post) Dispatcher.BeginInvoke(Drain);
            }
        } catch (Exception e) { Console.Error.WriteLine(e.Message); }
        finally { eof = true; try { Dispatcher.BeginInvoke(() => { if (!dead) Close(); }); } catch { } }
    }
    void Ack(string? id, bool ok = true, string? error = null) { if (id != null) Output(new { kind = "ack", id, ok, error }); }
    void Drain() {
        if (dead) return;
        for (;;) {
            JsonObject? data;
            lock (inboxLock) { data = commands.Count > 0 ? commands.Dequeue() : null; }
            if (data == null) break;
            string? id = data["id"]?.GetValue<string>();
            try {
                switch (data["kind"]?.GetValue<string>()) {
                    case "capture":
                        captureHidden = data["hidden"]!.GetValue<bool>(); VisibleGate();
                        if (captureHidden && (Native.IsWindowVisible(hwnd) || (keyboard != null && Native.IsWindowVisible(keyboard.Handle)))) throw new InvalidOperationException("A display window is still visible");
                        if (Native.DwmFlush() != 0) throw new InvalidOperationException("Composition did not confirm hidden state");
                        Output(new { kind = "ack", id, ok = true, hidden = captureHidden }); break;
                    case "style":
                        style = data["style"]?.DeepClone()?.AsObject(); bool skin = SkinAvailable(); Place();
                        Output(new { kind = "ack", id, ok = true, applied = true, skinLoaded = skin }); break;
                    case "view": SetView(data["view"]?.GetValue<string>()); Output(new { kind = "ack", id, ok = true, applied = true, view = EffectiveView }); break;
                    case "preferences": ApplyPreferences(data); Ack(id); break;
                    case "load-model":
                        if (loading) throw new InvalidOperationException("A model is already loading");
                        _ = BeginLoad(data["modelPath"]!.GetValue<string>(), data["profilePath"]?.GetValue<string>(), id, data["modelEntry"]?.GetValue<string>(), data["adapter"] as JsonObject, data["overrides"] as JsonObject, data["profileOverride"]?.GetValue<bool>() == true); break;
                    case "commit-model":
                        if (pendingPackage == null || loading) throw new InvalidOperationException("No validated model to commit");
                        commitReply = id; loading = true; loadDeadline = DateTime.UtcNow.AddSeconds(25); PublishStatus(); Post(new JsonObject { ["kind"] = "commit", ["token"] = pendingPackage.Token }); break;
                    case "cancel-load": CancelLoad(); Ack(id); break;
                    case "cancel": string? target=data["target"]?.GetValue<string>();if(target!=null&&(target==loadReply||target==commitReply))CancelLoad();if(target!=null&&target==confirmedShowId){userHidden=true;VisibleGate();}Ack(id);break;
                    case "control":
                        switch (data["action"]?.GetValue<string>()) {
                            case "show-confirmed": BeginConfirmedShow(id,data["modelToken"]?.GetValue<string>()); continue;
                            case "show": activated = true; userHidden = false; VisibleGate(); break;
                            case "hide": userHidden = true; VisibleGate(); break;
                            case "beginAdjust": SetAdjusting(true); break;
                            case "endAdjust": SetAdjusting(false); break;
                            default: throw new InvalidDataException("Unknown desktop control");
                        }
                        Ack(id); break;
                    case "get-adapter": case "get-motions": case "play-motion": case "stop-motion": MotionCommand(data); break;
                    case "qa-prepare": if(!qa||!qaInteractive)throw new InvalidOperationException("Private canvas QA only"); Post(new JsonObject{["kind"]="prepare-show",["id"]=id,["ticket"]=0,["token"]=package?.Token,["state"]=data["state"]?.DeepClone()});break;
                    case "qa-cursor-channel": case "qa-cursor-pressure": if(!qa||!qaInteractive)throw new InvalidOperationException("Private canvas QA only"); CursorQaCommand(data); Ack(id); break;
                    case "qa-cursor": if(!qa||!qaInteractive)throw new InvalidOperationException("Private canvas QA only"); var cursor=data.DeepClone().AsObject();cursor["kind"]="cursor-gaze";cursor.Remove("id");Post(cursor);Ack(id);break;
                    case "qa-run": case "qa-run-cancel": case "qa-step": if(!qa||!qaInteractive)throw new InvalidOperationException("Private canvas QA only"); Post(data); break;
                    case "metrics": Post(new JsonObject { ["kind"] = "metrics", ["id"] = id }); break;
                    case "shutdown": Ack(id); Close(); return;
                    default: throw new InvalidDataException("Unknown display command");
                }
            } catch (Exception e) { Ack(id, false, e.Message); }
        }
        JsonObject? update;
        bool again;
        lock (inboxLock) { update = latest; latest = null; again=commands.Count>0;inboxPosted = again; }
        if(again)Dispatcher.BeginInvoke(Drain);
        if (update != null) {
            state = update; activated = update["activated"]?.GetValue<bool>() ?? true;
            if (webReady) Post(update); keyboard?.EmbeddedState(update.ToJsonString()); VisibleGate();
        }
    }
    async Task BeginLoad(string selection, string? profile, string? reply = null, string? entry = null, JsonObject? adapter = null, JsonObject? overrides = null, bool explicitProfile = false) {
        if (!webReady || rendererDisposed) { Ack(reply, false, errorMessage ?? "WebView2 is unavailable; retry the display after installing its runtime."); return; }
        CancelLoad(); long ticket = ++loadTicket; loading = true; loadReply = reply; loadDeadline = DateTime.UtcNow.AddSeconds(25); errorMessage = errorCode = errorStage = null; VisibleGate();
        try {
            var imported = await Task.Run(() => ModelPackage.Load(selection, profile, entry, adapter, overrides ?? settings.ModelOverrides, explicitProfile));
            if (dead || ticket != loadTicket) return;
            pendingPackage = imported; imported.Manifest["token"] = imported.Token; imported.Manifest["qa"] = qa;
            Post(new JsonObject { ["kind"] = "load", ["manifest"] = imported.Manifest.DeepClone() });
        } catch (Exception e) { if (ticket == loadTicket) LoadFailed("Cannot load model: " + e.Message); }
    }
    void CancelLoad() {
        loadTicket++; loading = false; pendingPackage = null; pendingModelAdapter = null;
        Post(new JsonObject { ["kind"] = "cancel-load" });
        Ack(loadReply, false, "Model load canceled"); Ack(commitReply, false, "Model load canceled"); loadReply = commitReply = null; SyncCursorGaze(); PublishStatus();
    }
    void LoadFailed(string reason, string code = "model_load_failed") {
        errorMessage = reason; errorCode = code; errorStage = "model"; Ack(loadReply, false, reason); Ack(commitReply, false, reason); loadReply = commitReply = null;
        CancelLoad(); Warn(reason);
        if (modelReady) { VisibleGate(); PublishStatus(); } else Fallback(reason, code, "model");
    }
    void Fallback(string reason, string? code = null, string? stage = null) {
        if (dead) return; errorMessage = reason; errorCode = code; errorStage = stage; loading = false; modelReady = false; loadTicket++; pendingPackage = null;
        Ack(loadReply, false, reason); Ack(commitReply, false, reason); loadReply = commitReply = null; Warn(reason);
        if (qa) { Environment.ExitCode = 1; File.WriteAllText(Path.Combine(qaDir!, "failure.txt"), reason); Close(); return; }
        EnsureKeyboard(); Ready(); VisibleGate();
    }
    async void Message(string raw) {
        if (dead || rendererDisposed) return;
        try {
            if (raw.Length > 24 * 1024 * 1024) throw new InvalidDataException("Web message too large");
            var message = JsonNode.Parse(raw)!.AsObject(); string? kind = message["kind"]?.GetValue<string>();
            if (kind == "web-ready") {
                if (!startup.Pending || webReady) return;
                startup.Complete(); webReady = true;
                var selected = ModelLoadSelection.Resolve(settings.ModelPath, defaultModel);
                if (deferModel || selected == null) { loading = false; Ready(); VisibleGate(); }
                else await BeginLoad(selected, settings.ProfilePath, entry: settings.ModelEntry);
            }
            else if (kind == "model-ready") {
                if (pendingPackage == null || message["token"]?.GetValue<string>() != pendingPackage.Token) return;
                // Initial commit stays inside the model budget; staged imports await their explicit commit.
                loading = loadReply == null; pendingModelMotions = message["motionCatalog"]?.DeepClone() as JsonArray; pendingModelAdapter = message["adapterCatalog"]?.DeepClone() as JsonObject;
                if (qa) File.WriteAllText(Path.Combine(qaDir!, "core-report.json"), raw);
                if (loadReply != null) { Output(new{kind="ack",id=loadReply,ok=true,modelToken=pendingPackage.Token,modelKey=pendingPackage.ModelKey,adapter=pendingModelAdapter,signature=pendingPackage.Manifest["signature"]?.GetValue<string>(),sourceProof=pendingPackage.SourceProof}); loadReply = null; PublishStatus(); }
                else Post(new JsonObject { ["kind"] = "commit", ["token"] = pendingPackage.Token });
            } else if (kind == "model-committed") {
                if (pendingPackage == null || message["token"]?.GetValue<string>() != pendingPackage.Token) return;
                package = pendingPackage; pendingPackage = null; modelMotions = pendingModelMotions; pendingModelMotions = null; modelAdapter = pendingModelAdapter; pendingModelAdapter = null; modelReady = true; loading = false; errorMessage = errorCode = errorStage = null;
                if (state != null) Post(state); Place(); Ready(); VisibleGate(); Ack(commitReply); commitReply = null;
                if (qa && !qaInteractive) QaNext();
            } else if (kind == "model-error") {
                string? token = message["token"]?.GetValue<string>(), reason = message["error"]?.GetValue<string>();
                if (token == null || token == package?.Token) RuntimeFailed(reason ?? "Renderer failed", "renderer_failed", "model");
                else if (token == pendingPackage?.Token) LoadFailed(reason ?? "Model failed");
            } else if (kind == "cursor-gaze-ack") { CursorGazeAck(message);
            } else if (kind == "cursor-gaze-progress") { CursorGazeProgress(message);
            } else if (kind == "show-ready") { ShowReady(message);
            } else if (kind is "adapter-catalog" or "adapter-status") { AdapterReply(message);
            } else if (kind is "motion-catalog" or "motion-started" or "motion-stopped" or "motion-ended") { MotionReply(message);
            } else if (kind == "qa-run-sample" && qa && qaInteractive) { QaStepReply(message, true);
            } else if (kind == "qa-run-ended" && qa && qaInteractive) { message["kind"]="ack";Output(message);
            } else if (kind == "qa-step" && qa && qaInteractive) { QaStepReply(message);
            } else if (kind == "qa-frame" && qa) {
                string data = message["image"]!.GetValue<string>(); if (!data.StartsWith("data:image/png;base64,")) throw new InvalidDataException("Invalid frame");
                File.WriteAllBytes(Path.Combine(qaDir!, "live2d-" + qaFrame + ".png"), Convert.FromBase64String(data.Substring(22)));
                File.WriteAllText(Path.Combine(qaDir!, "pose-" + qaFrame + ".json"), message["pose"]!.ToJsonString()); QaNext();
            } else if (kind == "metrics") { if(qa)message["cursorSampling"]=new JsonObject{["reads"]=cursorReads,["timer"]=cursorTimer.IsEnabled,["queued"]=cursorChannel.Queued,["inFlight"]=cursorChannel.InFlight,["samples"]=cursorQaSamples,["maxSampleGapMs"]=cursorQaMaxGap,["sentSequence"]=cursorChannel.Sequence,["receivedSequence"]=cursorChannel.LastReceived,["pauseReason"]=CursorQaPauseReason,["sent"]=cursorChannel.Sent,["acknowledged"]=cursorChannel.Acknowledged,["coalesced"]=cursorChannel.Coalesced,["ackRecoveries"]=cursorChannel.AckRecoveries,["targetRecoveries"]=cursorChannel.TargetRecoveries,["maxWaitMs"]=cursorChannel.MaxWaitMs,["pressure"]=cursorQaPressure?.DeepClone()}; Output(new { kind = "metrics", id = message["id"]?.GetValue<string>(), rendered = message["rendered"]?.GetValue<long>(), visible = message["visible"]?.GetValue<bool>(), activeModels=message["activeModels"]?.GetValue<int>(),stagedModels=message["stagedModels"]?.GetValue<int>(),textures=message["textures"]?.GetValue<int>(),handImages=message["handImages"]?.GetValue<int>(),handPixels=message["handPixels"]?.GetValue<long>(),handPending=message["handPending"]?.GetValue<int>(),stagedHandImages=message["stagedHandImages"]?.GetValue<int>(),stagedHandPending=message["stagedHandPending"]?.GetValue<int>(),motions=message["motions"]?.GetValue<int>(),drawTimer=message["drawTimer"]?.GetValue<bool>(),timing=message["timing"],diagnostics=message["diagnostics"],cursorSampling=message["cursorSampling"] }); }
        } catch (Exception e) { RuntimeFailed("Invalid renderer message: " + e.Message, "renderer_message_failed", "page"); }
    }
    void QaNext() {
        qaFrame++; if (qaFrame > 4) { Close(); return; }
        string json = qaFrame switch {
            1 => "{\"kind\":\"state\",\"mode\":\"simulation\",\"status\":\"ready\",\"keys\":[],\"buttons\":[]}",
            2 => "{\"kind\":\"state\",\"mode\":\"real\",\"status\":\"ready\",\"keys\":[\"a\"],\"buttons\":[]}",
            3 => "{\"kind\":\"state\",\"mode\":\"real\",\"status\":\"ready\",\"keys\":[],\"buttons\":[\"left\"],\"position\":{\"x\":0.7,\"y\":0.4}}",
            _ => "{\"kind\":\"state\",\"mode\":\"real\",\"status\":\"unknown\",\"keys\":[],\"buttons\":[]}"
        };
        Post(JsonNode.Parse(json)!.AsObject()); Post(new JsonObject { ["kind"] = "qa-frame" });
    }
}
