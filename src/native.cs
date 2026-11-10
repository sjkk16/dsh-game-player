using System;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;

public static class GamePlayerNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public MOUSEKEYBDHARDWAREINPUT data;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct MOUSEKEYBDHARDWAREINPUT
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    public static extern IntPtr GetThreadDesktop(uint dwThreadId);

    [DllImport("user32.dll")]
    public static extern IntPtr GetProcessWindowStation();

    [DllImport("user32.dll")]
    public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, System.Text.StringBuilder pvInfo, uint nLength, out uint lpnLengthNeeded);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKeyW(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    public const int INPUT_MOUSE = 0;
    public const int INPUT_KEYBOARD = 1;

    public const uint MOUSEEVENTF_MOVE = 0x0001;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
    public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const uint KEYEVENTF_SCANCODE = 0x0008;
    // MAPVK_VK_TO_VSC_EX packs an extended scan as 0xE0xx; a zero result means the
    // virtual key has no hardware scan code on this layout.
    public const uint MAPVK_VK_TO_VSC_EX = 4;

    public const int SM_CXSCREEN = 0;
    public const int SM_CYSCREEN = 1;
    public const int SM_XVIRTUALSCREEN = 76;
    public const int SM_YVIRTUALSCREEN = 77;
    public const int SM_CXVIRTUALSCREEN = 78;
    public const int SM_CYVIRTUALSCREEN = 79;

    public static bool Recording;
    public static int RecordedX, RecordedY;
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    public static void EnsureDpi() {
        if (Recording) return;
        try {
            if (SetThreadDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Cannot establish physical-pixel DPI context.");
        } catch (EntryPointNotFoundException) { throw new InvalidOperationException("Per-monitor physical-pixel DPI context is unavailable."); }
    }
    public static int Metrics(int index) {
        if (!Recording) { EnsureDpi(); return GetSystemMetrics(index); }
        switch(index) {
            case 0: return 2560; case 1: return 1440;
            case 76: return -1920; case 77: return -80;
            case 78: return 4480; case 79: return 1520;
            default: throw new ArgumentException("Unknown metric.");
        }
    }
    public static POINT Cursor() {
        if (Recording) return new POINT { X = RecordedX, Y = RecordedY };
        EnsureDpi(); POINT p;
        if (!GetCursorPos(out p)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return p;
    }
    public static INPUT MouseEvent(uint flags, int data, int dx, int dy) {
        INPUT input = new INPUT(); input.type = INPUT_MOUSE;
        input.data.mi.dx = dx; input.data.mi.dy = dy;
        input.data.mi.dwFlags = flags; input.data.mi.mouseData = unchecked((uint)data);
        return input;
    }
    public static INPUT KeyEvent(ushort vk, ushort scan, uint flags) {
        INPUT input = new INPUT(); input.type = INPUT_KEYBOARD;
        input.data.ki.wVk = vk; input.data.ki.wScan = scan; input.data.ki.dwFlags = flags;
        return input;
    }
    internal static void Inject(INPUT input) {
        EnsureDpi();
        uint sent = SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
        if (sent != 1) throw new Win32Exception(Marshal.GetLastWin32Error(), "SendInput failed; injected state is not assumed successful (UIPI may block it).");
    }
    public static bool DesktopInteractive()
    {
        if (Recording) return true;
        try
        {
            StringBuilder name = new StringBuilder(256);
            uint needed;
            GetUserObjectInformation(GetProcessWindowStation(), 2, name, 256, out needed);
            string station = name.ToString();
            StringBuilder desktop = new StringBuilder(256);
            GetUserObjectInformation(GetThreadDesktop(GetCurrentThreadId()), 2, desktop, 256, out needed);
            return station.Equals("WinSta0", StringComparison.OrdinalIgnoreCase)
                && desktop.ToString().Equals("Default", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    public static string ForegroundTitle()
    {
        if (Recording) return "recording backend";
        try
        {
            IntPtr h = GetForegroundWindow();
            if (h == IntPtr.Zero) return "";
            StringBuilder title = new StringBuilder(512);
            GetWindowTextW(h, title, 512);
            return title.ToString();
        }
        catch { return ""; }
    }
}

// Fixed-width shared ledger: header + 256 slots. Both processes serialize every
// native event with the same mutex. A down intent is durable before SendInput;
// an up entry is cleared only after success. There is no global keyboard sweep.
// Slot (32 bytes): type@0, code@4, owner@8, upFlags@12, expiry@16 (int64),
// sent@24, key packing@28. Offset 20 is the high half of the expiry timestamp
// and must stay untouched; offset 28 is the only free word.
public static partial class InputSession
{
    const int Slots = 256, Header = 256, SlotBytes = 32, Magic = 0x47504C34;
    static System.IO.MemoryMappedFiles.MemoryMappedFile map;
    static System.IO.MemoryMappedFiles.MemoryMappedViewAccessor view;
    static System.Threading.Mutex mutex;
    static System.Threading.Thread monitor;
    static volatile bool stop;
    static bool guard;
    static int owner, maxHold;
    static string logPath;
    static System.Diagnostics.Process parent, peer;
    static int peerId;
    // Header: state@4 (0 ready,1 canceled,2 unsafe), parent/worker/guard PIDs@8/12/16,
    // heartbeat@24, fake clock@32, failure attempt@40, send count@44, fail-ups@48.
    public static void Initialize(string name, int parentPid, bool isGuard, bool recording, string recordLog, bool observeInput = false) {
        guard = isGuard; ConfigureObservation(name, observeInput); logPath = recordLog; GamePlayerNative.Recording = recording;
        mutex = new System.Threading.Mutex(false, name + "-mutex");
        map = System.IO.MemoryMappedFiles.MemoryMappedFile.CreateOrOpen(name, Header + Slots * SlotBytes);
        view = map.CreateViewAccessor();
        Locked(delegate {
            if (view.ReadInt32(0) != Magic) {
                view.Write(0, Magic); view.Write(40, -1);
                view.Write(8, parentPid);
            }
            view.Write(isGuard ? 16 : 12, System.Diagnostics.Process.GetCurrentProcess().Id);
            if (isGuard) view.Write(24, RealNow());
        });
        parent = OpenProcess(parentPid);
        monitor = new System.Threading.Thread(Monitor) { IsBackground = true };
        monitor.Start();
    }
    static System.Diagnostics.Process OpenProcess(int pid) {
        if (pid <= 0) return null;
        try { var p = System.Diagnostics.Process.GetProcessById(pid); var handle = p.Handle; return p; }
        catch { return null; }
    }
    static bool Exited(System.Diagnostics.Process p) { try { return p == null || p.HasExited; } catch { return true; } }
    static long RealNow() { return (long)(System.Diagnostics.Stopwatch.GetTimestamp() * (1000.0 / System.Diagnostics.Stopwatch.Frequency)); }
    static long Now() { long fake = view.ReadInt64(32); return fake > 0 ? fake : RealNow(); }
    static void Locked(Action action) {
        bool acquired = false;
        try {
            try { acquired = mutex.WaitOne(2000); }
            catch (System.Threading.AbandonedMutexException) { acquired = true; if (view != null) view.Write(4, 1); }
            if (!acquired) throw new TimeoutException("Input ledger mutex unavailable.");
            action();
        } finally { if (acquired) mutex.ReleaseMutex(); }
    }
    static int At(int slot) { return Header + slot * SlotBytes; }
    static int Find(int type, int code) {
        for (int i = 0; i < Slots; i++) if (view.ReadInt32(At(i)) == type && view.ReadInt32(At(i)+4) == code) return i;
        return -1;
    }
    static int Allocate() {
        for (int i = 0; i < Slots; i++) if (view.ReadInt32(At(i)) == 0) return i;
        throw new InvalidOperationException("Input ledger is full.");
    }
    static bool HasEntries() { for (int i=0;i<Slots;i++) if (view.ReadInt32(At(i)) != 0) return true; return false; }
    static void CheckReady() {
        if (guard) throw new InvalidOperationException("Release watchdog cannot inject input-down events.");
        if (view.ReadInt32(4) != 0) throw new InvalidOperationException("Input session canceled or unsafe.");
        if (view.ReadInt32(16) == 0 || RealNow() - view.ReadInt64(24) > 750)
            throw new InvalidOperationException("Release watchdog is unavailable.");
        if (Exited(parent)) throw new InvalidOperationException("Input owner process is gone.");
        CheckTarget();
    }
    static void Send(GamePlayerNative.INPUT input) {
        if (!GamePlayerNative.Recording) { GamePlayerNative.Inject(input); return; }
        int attempt = view.ReadInt32(44) + 1; view.Write(44, attempt);
        bool up = input.type == 1 ? (input.data.ki.dwFlags & 2) != 0 : (input.data.mi.dwFlags & 0x54) != 0;
        if (view.ReadInt32(40) == attempt || (up && view.ReadInt32(48) != 0))
            throw new InvalidOperationException("Recording backend simulated SendInput failure.");
        if (!String.IsNullOrEmpty(logPath)) {
            string line = "{\"role\":\"" + (guard ? "guard" : "worker") + "\",\"type\":" + input.type
                + ",\"dx\":" + input.data.mi.dx + ",\"dy\":" + input.data.mi.dy
                + ",\"mouseFlags\":" + (input.type == 0 ? input.data.mi.dwFlags : 0)
                + ",\"mouseData\":" + (input.type == 0 ? input.data.mi.mouseData : 0)
                + ",\"vk\":" + (input.type == 1 ? input.data.ki.wVk : 0)
                + ",\"scan\":" + (input.type == 1 ? input.data.ki.wScan : 0)
                + ",\"keyFlags\":" + (input.type == 1 ? input.data.ki.dwFlags : 0) + "}";
            System.IO.File.AppendAllText(logPath, line + "\n", new System.Text.UTF8Encoding(false));
        }
    }
    static bool Down(int type, int code, uint upFlags, GamePlayerNative.INPUT input, int packed = 0) {
        bool added = false;
        Locked(delegate {
            CheckReady(); if(type==2){var p=GamePlayerNative.Cursor();GamePlayerWindow.Point(Target(),p.X,p.Y);}
            int slot = Find(type, code);
            if (slot >= 0) {
                if (view.ReadInt32(At(slot)+8) != owner) throw new InvalidOperationException("Held input belongs to another agent.");
                return; // Never renew a lease on a repeated down.
            }
            slot = Allocate(); int at = At(slot);
            view.Write(at+4, code); view.Write(at+8, owner); view.Write(at+12, upFlags);
            view.Write(at+16, Now()+maxHold); view.Write(at+24,0); view.Write(at+28,packed); view.Write(at, type);
            try { Send(input); } catch { Observe("fault",type,code,owner,0); throw; }
            view.Write(at+24,1);
            added = true; Observe("down",type,code,owner,0);
        });
        return added;
    }
    static void ReleaseSlot(int slot) {
        int at = At(slot), type = view.ReadInt32(at), code = view.ReadInt32(at+4);
        uint flags = view.ReadUInt32(at+12);
        int eventOwner=view.ReadInt32(at+8), packed=view.ReadInt32(at+28);
        try {
            if (type == 1) {
                int scan=packed&0xFF;
                if((packed&0x200)!=0) flags|=GamePlayerNative.KEYEVENTF_SCANCODE;
                if((packed&0x100)!=0) flags|=GamePlayerNative.KEYEVENTF_EXTENDEDKEY;
                Send(GamePlayerNative.KeyEvent((ushort)code, (ushort)scan, flags));
            }
            else if (type == 2) Send(GamePlayerNative.MouseEvent(flags, 0, 0, 0));
            else if (type == 3) Send(GamePlayerNative.KeyEvent(0, (ushort)code, flags));
        } catch { Observe("fault",type,code,eventOwner,0); throw; }
        view.Write(at, 0); view.Write(at+24,0); Observe("up",type,code,eventOwner,0);
    }
    static void Up(int type, int code) {
        Locked(delegate {
            int slot = Find(type,code); if(slot < 0) return;
            if(view.ReadInt32(At(slot)+8) != owner) throw new InvalidOperationException("Held input belongs to another agent.");
            ReleaseSlot(slot);
        });
    }
    // SDL2 and DirectInput read the hardware scan code; a VK-only KEYBDINPUT
    // arrives with wScan=0 and is discarded by those games. Windows derives the
    // virtual key from the scan code, so wVk stays as a hint.
    // MapVirtualKey's MAPVK_VK_TO_VSC_EX does not mark every E0-prefixed key on
    // current builds (arrows and Insert/Delete/Home/End/PgUp/PgDn come back
    // unprefixed), so the extended set is authoritative here. Without the flag an
    // arrow would arrive as the matching numpad key.
    static bool IsExtendedVk(int vk) {
        switch (vk) {
            case 0x21: case 0x22: case 0x23: case 0x24: case 0x25: case 0x26: case 0x27: case 0x28:
            case 0x2C: case 0x2D: case 0x2E: case 0x6F: case 0x90:
            case 0x5B: case 0x5C: case 0x5D: case 0xA3: case 0xA5:
                return true;
        }
        return false;
    }
    static int ScanFor(int vk, uint flags, out bool extended) {
        extended = (flags & GamePlayerNative.KEYEVENTF_EXTENDEDKEY) != 0 || IsExtendedVk(vk);
        if (vk <= 0 || vk > 0xFF || vk == 0x13) return 0; // Pause is E1-prefixed; no KEYBDINPUT form.
        if (vk == 0x2C) return 0x37; // PrintScreen is E0 37; the layout table reports the SysRq code.
        uint packed = GamePlayerNative.MapVirtualKeyW((uint)vk, GamePlayerNative.MAPVK_VK_TO_VSC_EX);
        int scan = (int)(packed & 0xFF);
        if ((packed >> 8) == 0xE0) extended = true;
        return scan;
    }
    public static bool KeyDown(int vk, uint flags) {
        bool extended; int scan = ScanFor(vk, flags, out extended);
        uint eventFlags = flags;
        if (extended) eventFlags |= GamePlayerNative.KEYEVENTF_EXTENDEDKEY;
        if (scan != 0) eventFlags |= GamePlayerNative.KEYEVENTF_SCANCODE;
        int packed = scan | (extended ? 0x100 : 0) | (scan != 0 ? 0x200 : 0);
        return Down(1, vk, eventFlags|2, GamePlayerNative.KeyEvent((ushort)vk,(ushort)scan,eventFlags), packed);
    }
    public static void KeyUp(int vk) { Up(1,vk); }
    public static bool ButtonDown(int button, uint flags, uint upFlags) { return Down(2,button,upFlags,GamePlayerNative.MouseEvent(flags,0,0,0)); }
    public static void ButtonUp(int button) { Up(2,button); }
    public static void UnicodeChar(ushort code) {
        Down(3,code,6,GamePlayerNative.KeyEvent(0,code,4)); Up(3,code);
    }
    public static void Mouse(uint flags, int data, int dx, int dy) { Locked(delegate { CheckReady(); var p=GamePlayerNative.Cursor(); GamePlayerWindow.Point(Target(),p.X,p.Y); Send(GamePlayerNative.MouseEvent(flags,data,dx,dy)); Observe("wheel",2,0,owner,data); }); }
    public static void Move(int x, int y) {
        int vx=GamePlayerNative.Metrics(76), vy=GamePlayerNative.Metrics(77), w=GamePlayerNative.Metrics(78), h=GamePlayerNative.Metrics(79);
        if(x<vx || y<vy || (long)x>= (long)vx+w || (long)y >= (long)vy+h) throw new ArgumentException("Coordinates outside virtual desktop.");
        int nx=(int)Math.Round((x-(double)vx)*65535/Math.Max(1,w-1));
        int ny=(int)Math.Round((y-(double)vy)*65535/Math.Max(1,h-1));
        Locked(delegate { CheckReady(); GamePlayerWindow.Point(Target(),x,y); Send(GamePlayerNative.MouseEvent(0xC001,0,nx,ny)); if(GamePlayerNative.Recording){GamePlayerNative.RecordedX=x;GamePlayerNative.RecordedY=y;} view.Write(184,1); view.Write(188,nx); view.Write(192,ny); Observe("move",2,0,owner,0); });
    }
    public static void Delay(int milliseconds) {
        long deadline=RealNow()+milliseconds;
        for(;;) {
            long remaining=deadline-RealNow();
            if(remaining<=0) return;
            Locked(CheckReady);
            System.Threading.Thread.Sleep((int)Math.Min(remaining,10));
        }
    }
    // ownerId=0 is session-wide cancellation; an agent disposer uses its own ID.
    public static bool Cancel(int ownerId) {
        bool ok=true;
        Locked(delegate {
            bool target = ownerId == 0 || view.ReadInt32(104)==ownerId;
            if (!target) for(int i=0;i<Slots;i++) if(view.ReadInt32(At(i))!=0 && view.ReadInt32(At(i)+8)==ownerId) { target=true; break; }
            if (!target) return;
            view.Write(4,1);
            for(int i=Slots-1;i>=0;i--) if(view.ReadInt32(At(i))!=0 && (ownerId==0 || view.ReadInt32(At(i)+8)==ownerId)) {
                try { ReleaseSlot(i); } catch { ok=false; }
            }
            if(!ok || HasEntries() && ownerId==0) view.Write(4,2);
            Snapshot();
        });
        return ok;
    }
    public static int[] Held(int type) {
        var result=new System.Collections.Generic.List<int>();
        Locked(delegate { for(int i=0;i<Slots;i++) if(view.ReadInt32(At(i))==type) result.Add(view.ReadInt32(At(i)+4)); });
        return result.ToArray();
    }
    public static int State() { int result=2; Locked(delegate { result=view.ReadInt32(4); }); return result; }
    static void CheckPeers() {
        int id=view.ReadInt32(guard ? 12 : 16);
        if(id>0 && id!=peerId) { if(peer!=null) peer.Dispose(); peer=OpenProcess(id); peerId=id; }
        bool gone=Exited(parent) || id>0 && Exited(peer);
        if(guard) view.Write(24,RealNow());
        if(!gone && view.ReadInt32(4)==0 && view.ReadInt32(104)!=0){try{CheckTarget();}catch{}}
        if(gone || view.ReadInt32(4)!=0) {
            if(gone) view.Write(4,1);
            bool ok=true;
            for(int i=Slots-1;i>=0;i--) if(view.ReadInt32(At(i))!=0) { try { ReleaseSlot(i); } catch { ok=false; } }
            if(!ok) view.Write(4,2);
            if(gone && !HasEntries()) stop=true;
            return;
        }
        for(int i=Slots-1;i>=0;i--) if(view.ReadInt32(At(i))!=0 && Now()>=view.ReadInt64(At(i)+16)) {
            view.Write(4,1); // Cancel the gesture before releasing; no late event can race this.
            bool ok=true;
            for(int j=Slots-1;j>=0;j--) if(view.ReadInt32(At(j))!=0) { try { ReleaseSlot(j); } catch { ok=false; } }
            if(!ok) view.Write(4,2);
            break;
        }
    }
    static void Monitor() {
        while(!stop) {
            try { Locked(delegate { CheckPeers(); SnapshotIfDue(); }); } catch { try { Locked(delegate { view.Write(4,2); Snapshot(); }); } catch {} }
            System.Threading.Thread.Sleep(100);
        }
    }
    public static bool MonitorStopped() { return stop; }
    public static void TestClock(long value) {
        if(!GamePlayerNative.Recording || value<=0) throw new InvalidOperationException("Fake clock is recording-only.");
        Locked(delegate { view.Write(32,value); });
    }
    public static void TestFailure(int attempt, bool failUps) {
        if(!GamePlayerNative.Recording) throw new InvalidOperationException("Fault injection is recording-only.");
        Locked(delegate { view.Write(40,attempt); view.Write(48,failUps?1:0); });
    }
    public static void Tick() { if(!GamePlayerNative.Recording) throw new InvalidOperationException(); Locked(CheckPeers); }
    public static void Dispose() {
        stop=true; if(monitor!=null) monitor.Join(3000);
        if(peer!=null) peer.Dispose(); if(parent!=null) parent.Dispose();
        GamePlayerOutput.Stop();
        if(view!=null) view.Dispose(); if(map!=null) map.Dispose(); if(mutex!=null) mutex.Dispose();
    }
}
