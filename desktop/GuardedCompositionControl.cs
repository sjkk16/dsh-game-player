#nullable enable
using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Wpf;
namespace GamePlayer.Desktop;

// Disposed composition surfaces must never re-enter the SDK's D3D resize path.
internal sealed class GuardedCompositionControl : WebView2CompositionControl {
    bool retired, faultQueued;
    internal bool Retired => retired;
    internal event Action<Exception>? TextureCreationFailed;
    internal void Retire() { Dispatcher.VerifyAccess(); retired = true; }
    internal static bool IsTextureCreationFailure(Exception error) {
        var trace = error.StackTrace;
        return error is NullReferenceException && trace != null &&
            trace.Contains("Microsoft.Web.WebView2.Wpf.Direct3DHelper.CreateD3D11Texture", StringComparison.Ordinal) &&
            trace.Contains("Microsoft.Web.WebView2.Wpf.GraphicsItemD3DImage", StringComparison.Ordinal);
    }
    protected override void OnRenderSizeChanged(SizeChangedInfo info) => RunSizeUpdate(() => base.OnRenderSizeChanged(info));
    internal void RunSizeUpdate(Action update) {
        Dispatcher.VerifyAccess();
        if (retired) return;
        try { update(); }
        catch (NullReferenceException error) when (IsTextureCreationFailure(error)) {
            Retire();
            if (faultQueued) return;
            faultQueued = true;
            // Do not tear down WebView2 from inside its routed SizeChanged event.
            Dispatcher.BeginInvoke(DispatcherPriority.Normal, new Action(() => TextureCreationFailed?.Invoke(error)));
        }
    }
}

// Shared by the production window and invisible native regression checks.
internal sealed class RendererSurfaceLifetime {
    readonly GuardedCompositionControl control;
    readonly Grid parent;
    internal bool Retired { get; private set; }
    internal RendererSurfaceLifetime(GuardedCompositionControl control, Grid parent) { this.control = control; this.parent = parent; }
    internal bool RetireAndDispose(Action unsubscribe, Action<Exception> reportDisposalError) {
        control.Dispatcher.VerifyAccess();
        if (Retired) return false;
        Retired = true;
        control.Retire();
        try { unsubscribe(); }
        finally {
            parent.Children.Remove(control);
            try { control.Dispose(); }
            catch (Exception error) { reportDisposalError(error); }
        }
        return true;
    }
}
