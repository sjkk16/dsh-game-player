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

    public const long InputSourceTag = 0x44534847; // render attribution only, never proof of successful input
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
        input.data.mi.dwExtraInfo = new IntPtr(InputSourceTag);
        return input;
    }
    public static INPUT KeyEvent(ushort vk, ushort scan, uint flags) {
        INPUT input = new INPUT(); input.type = INPUT_KEYBOARD;
        input.data.ki.wVk = vk; input.data.ki.wScan = scan; input.data.ki.dwFlags = flags;
        input.data.ki.dwExtraInfo = new IntPtr(InputSourceTag);
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

