#nullable enable
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace GamePlayer.Desktop;
internal static class Native {
    [DllImport("user32.dll",SetLastError=true)] internal static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] internal static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] internal static extern bool AreDpiAwarenessContextsEqual(IntPtr first,IntPtr second);
    internal static void InitializeDpi() {
        // dotnet DLL hosting does not use our apphost EXE manifest. Set the
        // UI thread context before either WPF or WinForms creates a window.
        if (SetThreadDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Per-monitor V2 DPI awareness unavailable.");
    }
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; }
    [DllImport("user32.dll",SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool GetCursorPos(out Point point);
    [DllImport("wtsapi32.dll",SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WTSRegisterSessionNotification(IntPtr h,uint flags);
    [DllImport("wtsapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] internal static extern bool WTSUnRegisterSessionNotification(IntPtr h);
    [DllImport("user32.dll")] internal static extern int GetWindowLong(IntPtr h,int n);
    [DllImport("user32.dll")] internal static extern int SetWindowLong(IntPtr h,int n,int v);
    [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
    [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr h,out Rect r);
    [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] internal static extern bool SetWindowDisplayAffinity(IntPtr h,uint v);
    [DllImport("user32.dll")] internal static extern bool GetWindowDisplayAffinity(IntPtr h,out uint v);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr h);
    [DllImport("dwmapi.dll")] internal static extern int DwmFlush();
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left,Top,Right,Bottom; }
    internal static void Style(IntPtr h,bool adjust) {
        int ex=GetWindowLong(h,-20)|0x08000000|0x80;
        SetWindowLong(h,-20,adjust?ex&~0x20:ex|0x20);
    }
}
