#nullable enable
using System;
namespace GamePlayer.Desktop;
// The runtime/page budget ends at web-ready. Model loading has its own budget.
internal sealed class RendererStartupGate {
    readonly TimeSpan timeout;
    long generation;
    public bool Pending { get; private set; }
    public string Stage { get; private set; } = "storage";
    public DateTime Deadline { get; private set; }
    public RendererStartupGate(TimeSpan? timeout = null) { this.timeout = timeout ?? TimeSpan.FromSeconds(25); }
    public long Begin(DateTime now) { generation++; Pending = true; Stage = "storage"; Deadline = now + timeout; return generation; }
    public bool CanContinue(long ticket) => Pending && ticket == generation;
    public void Advance(long ticket, string stage) { if (CanContinue(ticket)) Stage = stage; }
    public bool Expired(DateTime now) => Pending && now > Deadline;
    public void Complete() { Pending = false; generation++; }
    public void Cancel() { Pending = false; generation++; }
}


// Keep restartable WebView2 subprocess failures out of renderer teardown.
internal static class RendererProcessFailurePolicy {
    internal static bool IsFatal(string? kind) => kind switch {
        "UtilityProcessExited" or "GpuProcessExited" or "SandboxHelperProcessExited" or "FrameRenderProcessExited" or "PpapiPluginProcessExited" or "PpapiBrokerProcessExited" => false,
        _ => true,
    };
    static string Clean(string? value, int limit) {
        if (String.IsNullOrEmpty(value)) return "unknown";
        var length = Math.Min(value.Length, limit);
        var chars = new char[length];
        for (int i = 0; i < length; i++) chars[i] = Char.IsControl(value[i]) ? ' ' : value[i];
        return new string(chars);
    }
    internal static string Describe(string? kind, string? reason, int exitCode, string? description) =>
        "WebView2 process failed: kind=" + Clean(kind, 64) + "; reason=" + Clean(reason, 64) +
        "; exitCode=" + exitCode + "; description=" + Clean(description, 256);
}
