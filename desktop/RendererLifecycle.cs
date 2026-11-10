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
