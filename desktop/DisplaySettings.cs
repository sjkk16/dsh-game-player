#nullable enable
using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows.Interop;
using Forms = System.Windows.Forms;

namespace GamePlayer.Desktop;
internal sealed partial class PetWindow {
    string EffectiveView => viewOverride == "auto" ? settings.View : viewOverride;
    bool UseKeyboard => EffectiveView == "keyboard" || !modelReady;
    void EnsureKeyboard() {
        if (keyboard != null) return;
        keyboard = new GamePlayerOverlay(Path.Combine(assetsDir, "overlay-layout.json"), null!, 0, true);
        keyboard.Embed(); _ = keyboard.Handle; keyboard.EmbeddedAdjust(adjusting);
        if (!ApplyCaptureAffinity(keyboard.Handle)) affinitySupported = false;
        AnnounceAffinity(); keyboard.MouseUp += (_, _) => { if (adjusting) { RememberLocation(); SaveLocation(); } };
        if (style != null) PushStyle(); if (state != null) keyboard.EmbeddedState(state.ToJsonString()); Place();
    }
    void VisibleGate() {
        if (dead) return;
        if (UseKeyboard && !loading) EnsureKeyboard();
        bool show = activated && !userHidden && !captureHidden && !qa;
        if (show) MakeTray();
        bool modelShow = show && !UseKeyboard;
        if(modelShow&&!rendererVisible&&!PrepareShow()){Hide();SyncCursorGaze();PublishStatus();return;}
        if(!modelShow)CancelShow();
        if (modelShow) { if (!IsVisible) Show(); } else Hide();
        if (keyboard != null) {
            if (show && UseKeyboard && (!loading || modelReady)) { keyboard.EmbeddedTick(); if (!keyboard.Visible) keyboard.Show(); }
            else keyboard.Hide();
        }
        if (keyboard?.Visible == true) keyboardTimer.Start(); else keyboardTimer.Stop();
        if (rendererVisible != modelShow) { rendererVisible = modelShow; Post(new JsonObject { ["kind"] = "visibility", ["visible"] = modelShow }); }
        if (!rendererDisposed && web.CoreWebView2 != null) web.CoreWebView2.IsMuted = true;
        SyncCursorGaze();PublishStatus();ConfirmVisibleFrame();
    }
    void Place() {
        double width = UseKeyboard ? settings.KeyboardWidthDip : settings.WidthDip;
        var area = Forms.Screen.FromPoint(new System.Drawing.Point(settings.X ?? Forms.Screen.PrimaryScreen!.WorkingArea.Right - 1, settings.Y ?? Forms.Screen.PrimaryScreen!.WorkingArea.Bottom - 1)).WorkingArea;
        IntPtr handle = UseKeyboard && keyboard != null ? keyboard.Handle : hwnd;
        double dpi = handle == IntPtr.Zero ? 96 : Math.Max(96, Native.GetDpiForWindow(handle));
        double ratio = UseKeyboard ? (keyboard == null ? 364.0 / 1040 : keyboard.AspectRatio) : 1 + 76.0 / settings.WidthDip;
        int w = (int)Math.Round(width * dpi / 96), h = (int)Math.Round(w * ratio);
        double fit = Math.Min(1, Math.Min((area.Width - 24.0) / w, (area.Height - 24.0) / h));
        w = Math.Max(100, (int)(w * fit)); h = Math.Max(60, (int)(h * fit));
        int x = Math.Clamp(settings.X ?? area.Right - w - 20, area.Left, Math.Max(area.Left, area.Right - w));
        int y = Math.Clamp(settings.Y ?? area.Bottom - h - 20, area.Top, Math.Max(area.Top, area.Bottom - h));
        Opacity = settings.Opacity;
        if (hwnd != IntPtr.Zero) Native.SetWindowPos(hwnd, new IntPtr(-1), x, y, w, h, 0x10);
        if (keyboard != null) { keyboard.Bounds = new System.Drawing.Rectangle(x, y, w, h); keyboard.Opacity = settings.Opacity; }
        PublishStatus();
    }
    void RememberLocation() {
        if (UseKeyboard && keyboard != null) { settings.X = keyboard.Left; settings.Y = keyboard.Top; }
        else if (Native.GetWindowRect(hwnd, out var r)) { settings.X = r.Left; settings.Y = r.Top; }
    }
    void SaveLocation() {
        if (qa) return;
        if (managed) Output(new { kind = "preferences-change", patch = new { x = settings.X, y = settings.Y }, revision = settings.Revision });
        else try { settings.Save(settingsPath); } catch (Exception e) { Warn("Could not save settings: " + e.Message); }
        PublishStatus();
    }
    void SetAdjusting(bool value) {
        adjusting = value; Native.Style(hwnd, adjusting); keyboard?.EmbeddedAdjust(adjusting);
        if (adjusting) { activated = true; userHidden = false; }
        else { RememberLocation(); SaveLocation(); }
        VisibleGate();
    }
    bool ApplyCaptureAffinity(IntPtr handle) {
        if (handle == IntPtr.Zero) return false;
        try { return Native.SetWindowDisplayAffinity(handle, 0x11) && Native.GetWindowDisplayAffinity(handle, out uint value) && value == 0x11; }
        catch { return false; }
    }
    void AnnounceAffinity() { if (announced) Output(new { kind = "affinity", affinitySupported }); }
    void AnnounceBounds() {
        if (!announced) return; var b = Forms.SystemInformation.VirtualScreen;
        Output(new { kind = "bounds", bounds = new { x = b.X, y = b.Y, width = b.Width, height = b.Height } });
    }
    void Ready() {
        if (announced) return; announced = true; var b = Forms.SystemInformation.VirtualScreen;
        Output(new { kind = "ready", protocolVersion = 3, renderer = modelReady ? "live2d" : "keyboard", affinitySupported,
            bounds = new { x = b.X, y = b.Y, width = b.Width, height = b.Height }, modelLoaded = modelReady, error = errorMessage, errorCode,
            cache = ownsCache ? new { root = cacheRoot, directory = cacheDirectory } : null,
            capabilities = new { confirmedVisibility = webReady && !rendererDisposed, management = true, model = webReady && !rendererDisposed, picker = true, metrics = webReady && !rendererDisposed, deferredModel = true, archives = true, adaptation = webReady && !rendererDisposed, watermark = webReady && !rendererDisposed, handStyles = webReady && !rendererDisposed, motions = webReady && !rendererDisposed } });
        PublishStatus();
    }
    void PublishStatus() {
        if (dead || (qa && !qaInteractive)) return;
        var value = new { phase = startup.Pending ? "starting" : loading ? "loading" : modelReady || (webReady && errorMessage == null) ? "ready" : "fallback", renderer = UseKeyboard ? "keyboard" : "live2d",
            modelCapable = webReady && !rendererDisposed, motionCapable = webReady && !rendererDisposed, adaptationCapable = webReady && !rendererDisposed, watermarkCapable = webReady && !rendererDisposed, archiveCapable = true,
            view = EffectiveView, visible = IsVisible || keyboard?.Visible == true, userHidden, adjusting, modelLoaded = modelReady, loading,
            modelName = package?.Manifest["name"]?.GetValue<string>(), modelPath = package?.ModelPath,
            modelSourcePath = package?.SourcePath, modelEntry = package?.ModelEntry, modelKey = package?.ModelKey, sourceProof = package?.SourceProof, adapterCatalog = modelAdapter,
            modelToken = package?.Token, modelProfilePath = package?.ProfilePath, motionSignature = package?.Manifest["signature"]?.GetValue<string>(), motionCatalog = modelMotions, error = errorMessage, errorCode,
            stage = startup.Pending ? startup.Stage : loading ? "model" : errorStage };
        string json = JsonSerializer.Serialize(value);
        if (json == lastStatus) return; lastStatus = json;
        Output(new { kind = "status", state = value, cache = ownsCache ? new { root = cacheRoot, directory = cacheDirectory } : null });
    }
    string StyleJson() {
        var copy = style == null ? new JsonObject() : style.DeepClone().AsObject(); copy["skinPath"] = settings.KeyboardImage ?? ""; return copy.ToJsonString();
    }
    bool PushStyle() { if (keyboard == null) return true; return keyboard.EmbeddedStyle(StyleJson()); }
    bool SkinAvailable() {
        if (keyboard != null) return PushStyle();
        return style?["skin"]?.GetValue<string>() != "custom" || (!string.IsNullOrEmpty(settings.KeyboardImage) && File.Exists(settings.KeyboardImage));
    }
    void SetView(string? view) {
        if (view != "auto" && view != "model" && view != "keyboard") throw new InvalidDataException("Invalid view.");
        viewOverride = view; Place(); VisibleGate();
    }
    void ApplyPreferences(JsonObject data) {
        settings = OverlaySettings.FromJson(data["preferences"]?.ToJsonString() ?? throw new InvalidDataException("Missing preferences."));
        settings.Revision = data["revision"]?.GetValue<long>() ?? 0;
        PushStyle(); Place(); VisibleGate();
    }
}
