#nullable enable
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Forms = System.Windows.Forms;

namespace GamePlayer.Desktop;
internal sealed partial class PetWindow : Window {
    readonly string settingsPath, defaultModel, assetsDir;
    readonly ParentWatch parent;
    readonly bool qa, managed, deferModel, qaInteractive;
    readonly string? qaDir;
    OverlaySettings settings;
    readonly WebView2CompositionControl web = new();
    readonly Grid root = new();
    readonly object inboxLock = new(), outputLock = new();
    readonly Queue<JsonObject> commands = new();
    readonly Dictionary<string, ModelPackage.Asset> appAssets = new(StringComparer.Ordinal);
    readonly DispatcherTimer lifeTimer = new() { Interval = TimeSpan.FromSeconds(1) };
    readonly DispatcherTimer keyboardTimer = new() { Interval = TimeSpan.FromMilliseconds(30) };
    readonly RendererStartupGate startup = new();
    EventHandler<object>? processChanged;
    JsonObject? latest, state, style;
    ModelPackage? package, pendingPackage;
    Forms.NotifyIcon? tray;
    GamePlayerOverlay? keyboard;
    CoreWebView2Environment? environment;
    BrowserJob? browserJob;
    IntPtr hwnd;
    bool activated, userHidden, captureHidden, adjusting, dead, webReady, modelReady, announced, loading, affinitySupported, inboxPosted;
    bool rendererVisible, drag, rendererDisposed;
    volatile bool eof;
    long loadTicket;
    DateTime loadDeadline;
    string viewOverride = "auto";
    string? errorMessage, errorCode, errorStage, loadReply, commitReply, lastStatus, cacheDirectory, cacheRoot;
    bool ownsCache;
    System.Drawing.Point dragStart;
    Native.Rect dragWindow;
    int qaFrame;

    public PetWindow(string settingsFile, string model, string assets, int parentPid, string? output, bool managed = false, bool deferModel = false, bool qaInteractive = false) {
        settingsPath = settingsFile; defaultModel = model; assetsDir = assets; qaDir = output; qa = output != null; this.managed = managed; this.deferModel = deferModel; this.qaInteractive = qaInteractive;
        parent = new ParentWatch(parentPid);
        try { settings = qa ? new() : OverlaySettings.Load(settingsPath); }
        catch (Exception e) { settings = new(); Warn("Settings ignored: " + e.Message); }
        WindowStyle = WindowStyle.None; AllowsTransparency = true; Background = Brushes.Transparent; ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false; ShowActivated = false; Topmost = true; Title = "AI Live2D 桌宠";
        Width = settings.WidthDip; Height = settings.WidthDip + 76;
        root.Children.Add(web); Content = root; web.DefaultBackgroundColor = System.Drawing.Color.Transparent;
        SourceInitialized += (_, _) => {
            hwnd = new WindowInteropHelper(this).Handle;
            HwndSource.FromHwnd(hwnd).AddHook(Hook); Native.Style(hwnd, false);
            affinitySupported = ApplyCaptureAffinity(hwnd); InitializeCursorGaze(); Place();
        };
        PreviewMouseLeftButtonDown += (_, e) => {
            if (!adjusting) return;
            drag = true; dragStart = Forms.Cursor.Position; Native.GetWindowRect(hwnd, out dragWindow); CaptureMouse(); e.Handled = true;
        };
        PreviewMouseMove += (_, _) => {
            if (!drag) return;
            var p = Forms.Cursor.Position;
            Native.SetWindowPos(hwnd, new IntPtr(-1), dragWindow.Left + p.X - dragStart.X, dragWindow.Top + p.Y - dragStart.Y, 0, 0, 0x15);
        };
        PreviewMouseLeftButtonUp += (_, _) => {
            if (!drag) return;
            drag = false; ReleaseMouseCapture(); RememberLocation(); Place(); SaveLocation();
        };
        lifeTimer.Tick += (_, _) => {
            if (eof || parent.HasExited) { Close(); return; }
            SyncControlObserver();
            if (startup.Expired(DateTime.UtcNow)) RuntimeFailed("Renderer startup timed out (25 s) during " + startup.Stage + "; cache: " + (cacheDirectory ?? settingsPath), "runtime_start_timeout");
            else if(showPending&&DateTime.UtcNow>showDeadline){CancelShow();RuntimeFailed("Renderer could not prepare the latest frame for display.","renderer_frame_timeout","frame");}
            else if (loading && DateTime.UtcNow > loadDeadline) {
                if (commitReply != null) RuntimeFailed("Model commit timed out (25 s); renderer state could not be confirmed.", "model_commit_timeout", "model");
                else LoadFailed("Model loading / initial commit timed out (25 s): " + (pendingPackage?.ModelPath ?? settings.ModelPath ?? defaultModel), "model_load_timeout");
            }
        };
        keyboardTimer.Tick += (_, _) => { if (keyboard?.Visible == true) keyboard.EmbeddedTick(); };
        Closed += (_, _) => Cleanup();
    }
    IntPtr Hook(IntPtr h, int msg, IntPtr wp, IntPtr lp, ref bool handled) {
        if (msg == 0x2b1) { CursorSessionChanged(wp.ToInt32()); SyncControlObserver(); }
        if (msg == 0x21) { handled = true; return new IntPtr(3); }
        if (msg == 0x84 && !adjusting) { handled = true; return new IntPtr(-1); }
        if (msg == 0x2e0 || msg == 0x7e) Dispatcher.BeginInvoke(() => { humanObserver?.RefreshBounds(); Place(); AnnounceBounds(); });
        return IntPtr.Zero;
    }
    void Output(object value) { lock (outputLock) { Console.Out.WriteLine(JsonSerializer.Serialize(value)); Console.Out.Flush(); } }
    void Warn(string message) {
        try { Console.Error.WriteLine("desktop: " + message); if (!qa) Output(new { kind = "warning", message }); }
        catch { eof = true; }
    }
    public async Task Start() {
        long ticket = startup.Begin(DateTime.UtcNow);
        new WindowInteropHelper(this).EnsureHandle(); lifeTimer.Start(); PublishStatus();
        if (!qa || qaInteractive) new Thread(Read) { IsBackground = true }.Start();
        try {
            try {
                var cache = DesktopStorage.PrepareCache(qa ? qaDir! : Path.GetDirectoryName(settingsPath)!, qa);
                cacheRoot = cache.Root; cacheDirectory = cache.Directory; ownsCache = true;
                lastStatus = null; PublishStatus();
            } catch (Exception e) { RuntimeFailed("Desktop storage/cache unavailable: " + settingsPath + "; " + e.Message, "storage_unavailable", "storage"); return; }
            // WPF composition must initialize a zero-opacity surface; no desktop pixels are captured.
            Opacity = 0; Show(); affinitySupported = ApplyCaptureAffinity(hwnd);
            root.Measure(new Size(Width, Height)); root.Arrange(new Rect(0, 0, Width, Height));
            string webDir = Path.Combine(assetsDir, "web");
            foreach (string relative in new[] { "index.html", "style.css", "renderer.js", "vendor/live2dcubismcore.min.js" }) {
                appAssets["/app/" + relative] = new(File.ReadAllBytes(Path.Combine(webDir, relative)), relative.EndsWith(".html") ? "text/html" : relative.EndsWith(".css") ? "text/css" : "text/javascript");
            }
            foreach (var file in Directory.GetFiles(Path.Combine(webDir, "shaders"))) appAssets["/app/shaders/" + Path.GetFileName(file)] = new(File.ReadAllBytes(file), "text/plain");
            appAssets["/app/key-map.json"] = new(File.ReadAllBytes(Path.Combine(assetsDir, "key-map.json")), "application/json");
            startup.Advance(ticket, "runtime"); PublishStatus();
            var created = await CoreWebView2Environment.CreateAsync(null, cacheDirectory!, new CoreWebView2EnvironmentOptions());
            if (!startup.CanContinue(ticket) || dead || rendererDisposed) { DisposeLateEnvironment(created); return; }
            environment = created; browserJob = new BrowserJob();
            processChanged = (_, _) => { try { OwnBrowsers(); } catch (Exception e) { RuntimeFailed("Cannot own private renderer processes: " + e.Message); } };
            environment.ProcessInfosChanged += processChanged;
            await web.EnsureCoreWebView2Async(environment);
            if (!startup.CanContinue(ticket) || dead || rendererDisposed) { DisposeRenderer(); DisposeLateEnvironment(created); return; }
            Hide();
            if (qa) Console.Error.WriteLine("WebView2 initialized (invisible startup surface).");
            OwnBrowsers(); browserJob?.Own((int)web.CoreWebView2.BrowserProcessId);
            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false; core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false; core.Settings.IsStatusBarEnabled = false; core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false; core.Settings.IsPasswordAutosaveEnabled = false;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += (_, e) => Resource(environment, e);
            core.NavigationStarting += (_, e) => { if (e.Uri != "https://overlay.invalid/app/index.html") e.Cancel = true; };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.ProcessFailed += (_, e) => RuntimeFailed("WebView2 process failed: " + e.ProcessFailedKind, "runtime_process_failed", "runtime");
            core.WebMessageReceived += (_, e) => Message(e.WebMessageAsJson);
            core.NavigationCompleted += (_, e) => { if (!e.IsSuccess) RuntimeFailed("Local renderer page failed: " + e.WebErrorStatus, "page_load_failed", "page"); };
            startup.Advance(ticket, "page"); PublishStatus();
            core.Navigate("https://overlay.invalid/app/index.html");
        } catch (Exception e) { if (qa) Console.Error.WriteLine(e); if (startup.CanContinue(ticket) && !rendererDisposed && !dead) RuntimeFailed("Renderer initialization failed during " + startup.Stage + ": " + e.Message); }
    }
    void Resource(CoreWebView2Environment env, CoreWebView2WebResourceRequestedEventArgs e) {
        var uri = new Uri(e.Request.Uri); ModelPackage.Asset? asset = null;
        if (uri.Scheme == "https" && uri.Host == "overlay.invalid" && uri.Port == 443 && uri.Query.Length == 0 && e.Request.Method == "GET") {
            appAssets.TryGetValue(uri.AbsolutePath, out asset);
            if (asset == null) package?.Assets.TryGetValue(uri.AbsolutePath, out asset);
            if (asset == null) pendingPackage?.Assets.TryGetValue(uri.AbsolutePath, out asset);
        }
        e.Response = asset == null ? env.CreateWebResourceResponse(Stream.Null, 403, "Blocked", "Content-Type: text/plain") :
            env.CreateWebResourceResponse(new MemoryStream(asset.Data, false), 200, "OK", "Content-Type: " + asset.Mime + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'");
    }
    void Post(JsonObject value) { if (webReady && !dead && !rendererDisposed) web.CoreWebView2.PostWebMessageAsJson(value.ToJsonString()); }
    void MakeTray() {
        if (tray != null || qa) return;
        tray = new Forms.NotifyIcon { Icon = System.Drawing.SystemIcons.Application, Text = "AI Live2D 桌宠", Visible = true };
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("显示 / 隐藏", null, (_, _) => { userHidden = !userHidden; VisibleGate(); });
        menu.Items.Add("进入 / 退出位置调整", null, (_, _) => SetAdjusting(!adjusting));
        menu.Items.Add("本次会话关闭", null, (_, _) => { Output(new { kind = "closed" }); Close(); });
        tray.ContextMenuStrip = menu; tray.DoubleClick += (_, _) => { userHidden = !userHidden; VisibleGate(); };
    }
    void CleanupCache(int[] owned) {
        if(!ownsCache||cacheDirectory==null||cacheRoot==null)return;
        try {
            var end=DateTime.UtcNow.AddSeconds(2);
            bool Alive(int pid){try{using var p=Process.GetProcessById(pid);return !p.HasExited;}catch(ArgumentException){return false;}}
            while(owned.Any(Alive)&&DateTime.UtcNow<end)Thread.Sleep(25);
            if(owned.Any(Alive)){Warn("Private renderer cache retained: owned browser is still exiting.");return;}
            string path=Path.GetFullPath(cacheDirectory),boundary=Path.GetFullPath(cacheRoot).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            string name=Path.GetFileName(path);
            if(!path.StartsWith(boundary,StringComparison.OrdinalIgnoreCase)||!(Guid.TryParseExact(name,"N",out _)||qa&&name=="webview-cache-"+Environment.ProcessId)){Warn("Private renderer cache retained: unexpected cache boundary: "+path);return;}
            // Refuse junctions/symlinks anywhere in the resolved, self-created cache path.
            for(string? part=path;part!=null;part=Path.GetDirectoryName(part))if((File.GetAttributes(part)&FileAttributes.ReparsePoint)!=0){Warn("Private renderer cache retained: linked ancestor: "+part);return;}
            Directory.Delete(path,true);
        }catch(Exception e){Warn((managed ? "Private cache cleanup deferred until display exit: " : "Private renderer cache retained: ")+e.Message+"; "+cacheDirectory);/* Never broaden the cleanup target. */}
    }
    void Cleanup() {
        if (dead) return; dead = true; loadTicket++; lifeTimer.Stop(); keyboardTimer.Stop(); StopControlObserver(); DisposeCursorGaze(); Hide();
        keyboard?.Hide(); keyboard?.Dispose(); tray?.Dispose();
        if (qa && environment != null) try { File.WriteAllText(Path.Combine(qaDir!, "browser-pids.json"), JsonSerializer.Serialize(environment.GetProcessInfos().Select(p => p.ProcessId).ToArray())); } catch { }
        DisposeRenderer(); parent.Dispose(); package = pendingPackage = null;
        Application.Current.Shutdown();
    }
}
internal static class Program {
    [STAThread] static int Main(string[] args) {
        try {
            var a = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i + 1 < args.Length; i += 2) a[args[i]] = args[i + 1];
            Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
            if (a.ContainsKey("--qa-control-selftest")) return AdaptiveControlQa.Run();
            Native.InitializeDpi();
            if (a.ContainsKey("--pick") || a.ContainsKey("--validate-skin") || a.ContainsKey("--discover-model") || a.ContainsKey("--describe-model-source")) return DesktopUtility.Run(a);
            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            var window = new PetWindow(a["--settings"], a["--default-model"], a.GetValueOrDefault("--assets", AppContext.BaseDirectory), int.Parse(a["--parent"]), a.GetValueOrDefault("--qa-dir"), a.GetValueOrDefault("--managed") == "true", a.GetValueOrDefault("--defer-model") == "true", a.GetValueOrDefault("--qa-interactive") == "true");
            app.Startup += async (_, _) => await window.Start(); app.Run(); return Environment.ExitCode;
        } catch (Exception e) { Console.Error.WriteLine(e); return 1; }
    }
}
