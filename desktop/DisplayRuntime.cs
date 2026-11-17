#nullable enable
using System;
using System.Diagnostics;
using System.Linq;
using Microsoft.Web.WebView2.Core;
namespace GamePlayer.Desktop;
internal sealed partial class PetWindow {
    CoreWebView2? subscribedCore;
    static int[] OwnedBrowserIds(CoreWebView2Environment? value) { try { return value?.GetProcessInfos().Select(p => p.ProcessId).ToArray() ?? Array.Empty<int>(); } catch { return Array.Empty<int>(); } }
    int[] OwnedBrowserIds() => OwnedBrowserIds(environment);
    void OwnBrowsers() {
        if (rendererDisposed || dead || environment == null || browserJob == null) return;
        foreach (var process in environment.GetProcessInfos()) if (process.Kind == CoreWebView2ProcessKind.Browser) browserJob.Own(process.ProcessId);
    }
    static void StopOwnedBrowsers(int[] owned) {
        // IDs are snapshots of this window's unique private environment only.
        foreach (int pid in owned) try { using var process = Process.GetProcessById(pid); if (!process.HasExited) process.Kill(); } catch { }
    }
    void SubscribeRenderer(CoreWebView2 core) {
        subscribedCore = core;
        core.WebResourceRequested += RendererResourceRequested;
        core.NavigationStarting += RendererNavigationStarting;
        core.NewWindowRequested += RendererNewWindowRequested;
        core.DownloadStarting += RendererDownloadStarting;
        core.PermissionRequested += RendererPermissionRequested;
        core.ProcessFailed += RendererProcessFailed;
        core.WebMessageReceived += RendererMessageReceived;
        core.NavigationCompleted += RendererNavigationCompleted;
    }
    void UnsubscribeRenderer() {
        web.TextureCreationFailed -= RendererTextureFailed;
        if (environment != null && processChanged != null) {
            try { environment.ProcessInfosChanged -= processChanged; } catch (Exception e) { Warn("Renderer event cleanup: " + e.GetType().Name); }
        }
        processChanged = null;
        var core = subscribedCore; subscribedCore = null;
        if (core == null) return;
        // A dead COM process may reject one removal; still detach every other callback.
        foreach (var remove in new Action[] {
            () => core.WebResourceRequested -= RendererResourceRequested,
            () => core.NavigationStarting -= RendererNavigationStarting,
            () => core.NewWindowRequested -= RendererNewWindowRequested,
            () => core.DownloadStarting -= RendererDownloadStarting,
            () => core.PermissionRequested -= RendererPermissionRequested,
            () => core.ProcessFailed -= RendererProcessFailed,
            () => core.WebMessageReceived -= RendererMessageReceived,
            () => core.NavigationCompleted -= RendererNavigationCompleted,
        }) try { remove(); } catch (Exception e) { Warn("Renderer event cleanup: " + e.GetType().Name); }
    }
    void RendererResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e) { if (!dead && !rendererDisposed && environment != null) Resource(environment, e); }
    void RendererNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e) { if (dead || rendererDisposed || e.Uri != "https://overlay.invalid/app/index.html") e.Cancel = true; }
    void RendererNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e) => e.Handled = true;
    void RendererDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e) => e.Cancel = true;
    void RendererPermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e) => e.State = CoreWebView2PermissionState.Deny;
    void RendererMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e) { if (!dead && !rendererDisposed) Message(e.WebMessageAsJson); }
    void RendererNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e) { if (!dead && !rendererDisposed && !e.IsSuccess) RuntimeFailed("Local renderer page failed: " + e.WebErrorStatus, "page_load_failed", "page"); }
    void RendererProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e) {
        if (dead || rendererDisposed) return;
        HandleRendererProcessFailure(e.ProcessFailedKind.ToString(), e.Reason.ToString(), e.ExitCode, e.ProcessDescription);
    }
    void HandleRendererProcessFailure(string kind, string reason, int exitCode, string? description) {
        if (dead || rendererDisposed) return;
        var message = RendererProcessFailurePolicy.Describe(kind, reason, exitCode, description);
        if (RendererProcessFailurePolicy.IsFatal(kind)) RuntimeFailed(message, "runtime_process_failed", "runtime");
        else Warn(message + "; renderer retained");
    }
    void RendererTextureFailed(Exception error) => RuntimeFailed("WebView2 composition D3D texture creation failed during resize: " + error.GetType().Name, "runtime_composition_failed", "runtime");
    void DisposeLateEnvironment(CoreWebView2Environment created) {
        Dispatcher.VerifyAccess();
        var owned = OwnedBrowserIds(created);
        DisposeRenderer();
        StopOwnedBrowsers(owned); CleanupCache(owned);
    }
    void DisposeRenderer() {
        Dispatcher.VerifyAccess();
        if (rendererDisposed) return;
        // Close all callback gates before touching subscriptions, layout or COM.
        rendererDisposed = true; startup.Cancel(); webReady = false; rendererVisible = false; StopCursorGaze();
        var owned = OwnedBrowserIds();
        rendererSurface.RetireAndDispose(UnsubscribeRenderer, error => Warn("Renderer disposal: " + error.GetType().Name));
        browserJob?.Dispose(); browserJob = null;
        StopOwnedBrowsers(owned); CleanupCache(owned); environment = null;
    }
    void RuntimeFailed(string reason, string code = "runtime_start_failed", string? stage = null) {
        if (dead || rendererDisposed) return;
        FailConfirmedShow(reason);
        string failedStage = stage ?? startup.Stage;
        DisposeRenderer(); package = null; Fallback(reason, code, failedStage);
    }
}
