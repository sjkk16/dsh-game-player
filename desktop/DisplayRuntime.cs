#nullable enable
using System;
using System.Diagnostics;
using System.Linq;
using Microsoft.Web.WebView2.Core;
namespace GamePlayer.Desktop;
internal sealed partial class PetWindow {
    int[] OwnedBrowserIds() { try { return environment?.GetProcessInfos().Select(p => p.ProcessId).ToArray() ?? Array.Empty<int>(); } catch { return Array.Empty<int>(); } }
    void OwnBrowsers() {
        if (rendererDisposed || dead || environment == null || browserJob == null) return;
        foreach (var process in environment.GetProcessInfos()) if (process.Kind == CoreWebView2ProcessKind.Browser) browserJob.Own(process.ProcessId);
    }
    void DisposeLateEnvironment(CoreWebView2Environment created) {
        int[] owned;
        try { owned = created.GetProcessInfos().Select(p => p.ProcessId).ToArray(); } catch { owned = Array.Empty<int>(); }
        try { web.Dispose(); } catch { }
        foreach (int pid in owned) try { using var process = Process.GetProcessById(pid); if (!process.HasExited) process.Kill(); } catch { }
        CleanupCache(owned);
    }
    void DisposeRenderer() {
        if (rendererDisposed) return;
        StopCursorGaze(); rendererDisposed = true; startup.Cancel(); webReady = false; rendererVisible = false;
        var owned = OwnedBrowserIds();
        if (environment != null && processChanged != null) environment.ProcessInfosChanged -= processChanged;
        processChanged = null;
        try { web.Dispose(); } catch { }
        browserJob?.Dispose(); browserJob = null;
        // IDs come only from our unique private environment; never enumerate/kill other browsers.
        foreach (int pid in owned) try { using var process = Process.GetProcessById(pid); if (!process.HasExited) process.Kill(); } catch { }
        CleanupCache(owned); environment = null;
    }
    void RuntimeFailed(string reason, string code = "runtime_start_failed", string? stage = null) {
        if (dead || rendererDisposed) return;
        FailConfirmedShow(reason);
        string failedStage = stage ?? startup.Stage;
        DisposeRenderer(); package = null; Fallback(reason, code, failedStage);
    }
}
