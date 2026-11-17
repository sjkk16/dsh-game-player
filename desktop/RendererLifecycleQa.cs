#nullable enable
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
namespace GamePlayer.Desktop;

// Explicit CLI-only QA: isolated data, zero-opacity windows, no models or input observers.
internal static class RendererLifecycleQa {
    sealed class TextureNull : NullReferenceException {
        readonly string trace;
        internal TextureNull(string trace) { this.trace = trace; }
        public override string StackTrace => trace;
    }
    const string TextureTrace = "at Microsoft.Web.WebView2.Wpf.Direct3DHelper.CreateD3D11Texture()\n at Microsoft.Web.WebView2.Wpf.GraphicsItemD3DImage.UpdateSize()";
    static void Pump() {
        var frame = new DispatcherFrame();
        Dispatcher.CurrentDispatcher.BeginInvoke(DispatcherPriority.Background, new Action(() => frame.Continue = false));
        Dispatcher.PushFrame(frame);
    }
    internal static int Run() {
        int checks = 0;
        void Check(bool value, string name) { checks++; if (!value) throw new InvalidOperationException("Renderer lifecycle check failed: " + name); }
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        try {
            foreach (var kind in Enum.GetValues<CoreWebView2ProcessFailedKind>()) {
                bool fatal = kind is CoreWebView2ProcessFailedKind.BrowserProcessExited or CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive or CoreWebView2ProcessFailedKind.UnknownProcessExited;
                Check(RendererProcessFailurePolicy.IsFatal(kind.ToString()) == fatal, "failure classification " + kind);
            }
            Check(RendererProcessFailurePolicy.IsFatal("FutureUnknownFailure"), "unknown kinds fail closed");
            Check(RendererProcessFailurePolicy.IsFatal(null), "missing kind fails closed");
            var text = RendererProcessFailurePolicy.Describe("UtilityProcessExited", "Unexpected", -7, "Audio\nService\r" + new string('x', 1000));
            Check(text.Contains("kind=UtilityProcessExited") && text.Contains("reason=Unexpected") && text.Contains("exitCode=-7"), "diagnostic correlation");
            Check(!text.Contains('\n') && !text.Contains('\r') && text.Length < 500, "bounded single-line diagnostic");
            var gate = new RendererStartupGate(); var ticket = gate.Begin(DateTime.UtcNow); gate.Cancel();
            Check(!gate.CanContinue(ticket), "late initialization cancelled");
            var next = gate.Begin(DateTime.UtcNow); Check(!gate.CanContinue(ticket) && gate.CanContinue(next), "old initialization generation rejected");
            var control = new GuardedCompositionControl(); var parent = new Grid(); parent.Children.Add(control);
            var surface = new RendererSurfaceLifetime(control, parent); int updates = 0, removals = 0, disposalErrors = 0;
            control.RunSizeUpdate(() => updates++); Check(updates == 1, "live update executes");
            Check(surface.RetireAndDispose(() => { Check(control.Retired, "gate closed before unsubscribe"); removals++; }, _ => disposalErrors++), "first retirement");
            Check(!parent.Children.Contains(control), "detached from layout");
            Check(!surface.RetireAndDispose(() => removals++, _ => disposalErrors++), "duplicate retirement ignored");
            control.RunSizeUpdate(() => updates++); Check(updates == 1 && removals == 1 && disposalErrors == 0, "retired update and duplicate dispose blocked");
            var faulty = new GuardedCompositionControl(); int failures = 0; faulty.TextureCreationFailed += _ => failures++;
            var known = new TextureNull(TextureTrace); Check(GuardedCompositionControl.IsTextureCreationFailure(known), "known SDK stack admitted");
            faulty.RunSizeUpdate(() => throw known); Check(faulty.Retired && failures == 0, "fault retires before deferred notification");
            faulty.RunSizeUpdate(() => throw known); Pump(); Check(failures == 1, "fault notification exactly once"); faulty.Dispose();
            var cancelled = new GuardedCompositionControl(); Action<Exception> handler = _ => failures++;
            cancelled.TextureCreationFailed += handler; cancelled.RunSizeUpdate(() => throw known);
            new RendererSurfaceLifetime(cancelled, new Grid()).RetireAndDispose(() => cancelled.TextureCreationFailed -= handler, _ => disposalErrors++);
            Pump(); Check(failures == 1, "shutdown cancels queued failure subscriber");
            var unrelated = new GuardedCompositionControl(); var other = new NullReferenceException("unrelated"); bool propagated = false;
            try { unrelated.RunSizeUpdate(() => throw other); } catch (NullReferenceException error) { propagated = ReferenceEquals(error, other); }
            Check(propagated && !unrelated.Retired, "unrelated null reference propagates");
            Check(!GuardedCompositionControl.IsTextureCreationFailure(new TextureNull("GraphicsItemD3DImage.OtherMethod")), "partial SDK stack rejected");
            var invalid = new InvalidOperationException("unrelated"); propagated = false;
            try { unrelated.RunSizeUpdate(() => throw invalid); } catch (InvalidOperationException error) { propagated = ReferenceEquals(error, invalid); }
            Check(propagated, "other exception types propagate"); unrelated.Dispose();
            Console.WriteLine(JsonSerializer.Serialize(new { ok = true, checks, version = typeof(RendererLifecycleQa).Assembly.GetName().Version?.ToString(), hooksInstalled = false, inputInjected = false, userSettingsModified = false }));
            return 0;
        } finally { app.Shutdown(); }
    }
    internal static void InstallSmokePage(Dictionary<string, ModelPackage.Asset> assets) {
        assets["/app/index.html"] = new(Encoding.UTF8.GetBytes("<!doctype html><html><body style='background:transparent'><div>renderer lifecycle QA</div><script src='/app/renderer-smoke.js'></script></body></html>"), "text/html");
        assets["/app/renderer-smoke.js"] = new(Encoding.UTF8.GetBytes("window.chrome.webview.postMessage({kind:'web-ready'});"), "text/javascript");
    }
    internal static int RunSmoke(string directory) {
        directory = Path.GetFullPath(directory); Directory.CreateDirectory(directory);
        Native.InitializeDpi();
        int checks = 0;
        void Check(bool value, string name) { checks++; if (!value) throw new InvalidOperationException("Renderer smoke check failed: " + name); }
        var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        var window = new PetWindow(Path.Combine(directory, "settings.json"), Path.Combine(directory, "missing-model"), AppContext.BaseDirectory, Environment.ProcessId, directory, true, true, true, true);
        app.Startup += async (_, _) => {
            try {
                await window.Start();
                await window.QaRendererLifecycleSmoke(Check);
                Console.WriteLine(JsonSerializer.Serialize(new { ok = true, smoke = true, checks, version = typeof(RendererLifecycleQa).Assembly.GetName().Version?.ToString(), hooksInstalled = false, inputInjected = false, userModelsLoaded = false, userSettingsModified = false, screenshotsTaken = false }));
            } catch (Exception error) { Console.Error.WriteLine(error); Environment.ExitCode = 1; }
            finally { window.Close(); }
        };
        app.Run(); return Environment.ExitCode;
    }
}
internal sealed partial class PetWindow {
    internal async Task QaRendererLifecycleSmoke(Action<bool, string> check) {
        if (!qa || !rendererSmoke || !qaInteractive) throw new InvalidOperationException("Isolated renderer QA only");
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (!webReady && !rendererDisposed && DateTime.UtcNow < deadline) await Task.Delay(20);
        check(webReady && !rendererDisposed && errorMessage == null, "real WebView2 initialized with synthetic page");
        check(Opacity == 0 && !IsVisible && humanObserver == null && package == null, "invisible, no input observer or model");
        var core = web.CoreWebView2; var currentState = state?.ToJsonString(); var cache = cacheDirectory;
        foreach (var kind in new[] { "UtilityProcessExited", "GpuProcessExited", "SandboxHelperProcessExited", "FrameRenderProcessExited", "PpapiPluginProcessExited", "PpapiBrokerProcessExited" }) {
            HandleRendererProcessFailure(kind, "Unexpected", -7, "Synthetic QA service");
            check(!rendererDisposed && webReady && ReferenceEquals(core, web.CoreWebView2) && state?.ToJsonString() == currentState && errorMessage == null, kind + " retains renderer and state");
        }
        Width += 17; Height += 13; UpdateLayout(); await Task.Delay(100);
        check(!rendererDisposed && root.Children.Contains(web), "live layout resize succeeds");
        var owned = OwnedBrowserIds(); check(owned.Length > 0, "only private environment process IDs captured");
        var originalEnvironment = environment!;
        // An independently cached WebView2 must survive production renderer cleanup.
        var otherRoot = new Grid(); var other = new GuardedCompositionControl(); otherRoot.Children.Add(other);
        var otherSurface = new RendererSurfaceLifetime(other, otherRoot);
        var otherWindow = new Window { Content = otherRoot, Width = 240, Height = 160, Opacity = 0, ShowActivated = false, ShowInTaskbar = false, WindowStyle = WindowStyle.None };
        CoreWebView2Environment? otherEnvironment = null; int[] otherIds = Array.Empty<int>();
        try {
            otherWindow.Show();
            otherEnvironment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(qaDir!, "sentinel-cache"), new CoreWebView2EnvironmentOptions());
            await other.EnsureCoreWebView2Async(otherEnvironment); otherWindow.Hide();
            otherIds = OwnedBrowserIds(otherEnvironment);
            check(otherIds.Length > 0 && !otherIds.Intersect(owned).Any(), "independent private environment created");
            HandleRendererProcessFailure("RenderProcessExited", "Unexpected", -8, "Synthetic fatal failure");
            check(rendererDisposed && rendererSurface.Retired && web.Retired && !root.Children.Contains(web), "fatal failure safely detaches and disposes");
            check(!dead && keyboard != null && errorCode == "runtime_process_failed" && UseKeyboard, "production keyboard fallback keeps window alive");
            Width += 83; Height += 41; UpdateLayout(); await Task.Delay(150);
            int lateUpdates = 0; web.RunSizeUpdate(() => lateUpdates++);
            check(lateUpdates == 0 && !dead, "post-disposal resize cannot enter SDK");
            var firstError = errorMessage; DisposeRenderer(); DisposeLateEnvironment(originalEnvironment);
            HandleRendererProcessFailure("BrowserProcessExited", "Unexpected", -9, "Late event"); Message("not JSON");
            check(errorMessage == firstError && !dead, "duplicate cleanup, late environment and late callback ignored");
            deadline = DateTime.UtcNow.AddSeconds(5);
            bool Exited(int pid) { try { using var process = Process.GetProcessById(pid); return process.HasExited; } catch (ArgumentException) { return true; } }
            while (owned.Any(pid => !Exited(pid)) && DateTime.UtcNow < deadline) await Task.Delay(50);
            check(owned.All(Exited), "owned browser processes exited");
            check(otherIds.All(pid => !Exited(pid)) && await other.CoreWebView2.ExecuteScriptAsync("1+1") == "2", "unrelated browser environment survives cleanup");
            check(cache == null || !Directory.Exists(cache), "only isolated cache removed after process cleanup");
            check(Opacity == 0 && !IsVisible && humanObserver == null, "fallback remains invisible and input-free");
        } finally {
            otherSurface.RetireAndDispose(() => {}, _ => {});
            StopOwnedBrowsers(otherIds.Length > 0 ? otherIds : OwnedBrowserIds(otherEnvironment));
            otherWindow.Close();
        }
    }
}
