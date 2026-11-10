using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
public class ClientBounds { public int x,y,width,height; }
public class GameWindowInfo {
    public string windowId, title, processStart;
    public int pid;
    public bool valid,focused,minimized;
    public ClientBounds client;
}
public static class GamePlayerWindow {
    delegate bool EnumCallback(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int left,top,right,bottom; }
    [DllImport("user32.dll",SetLastError=true)] static extern bool GetClientRect(IntPtr hwnd,out RECT rect);
    [DllImport("user32.dll",SetLastError=true)] static extern bool ClientToScreen(IntPtr hwnd,ref GamePlayerNative.POINT point);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(GamePlayerNative.POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flag);
    static GameWindowInfo Describe(IntPtr hwnd) {
        if(!IsWindow(hwnd)||!GamePlayerNative.IsWindowVisible(hwnd))throw new InvalidOperationException("Window is no longer visible/valid.");
        uint pid;GamePlayerNative.GetWindowThreadProcessId(hwnd,out pid);
        long start;using(var process=Process.GetProcessById((int)pid)){start=process.StartTime.ToUniversalTime().Ticks;}
        GamePlayerNative.EnsureDpi();RECT rect;var origin=new GamePlayerNative.POINT();
        if(!GetClientRect(hwnd,out rect)||!ClientToScreen(hwnd,ref origin)||rect.right<=rect.left||rect.bottom<=rect.top)throw new InvalidOperationException("Window client geometry unavailable.");
        var title=new StringBuilder(512);GamePlayerNative.GetWindowTextW(hwnd,title,512);
        return new GameWindowInfo {windowId=hwnd.ToInt64()+":"+pid+":"+start,processStart=start.ToString(),pid=(int)pid,title=title.ToString(),valid=true,focused=GamePlayerNative.GetForegroundWindow()==hwnd,minimized=IsIconic(hwnd),client=new ClientBounds{x=origin.X,y=origin.Y,width=rect.right-rect.left,height=rect.bottom-rect.top}};
    }
    public static GameWindowInfo Get(string id) {
        if(GamePlayerNative.Recording){var mock=InputSession.MockWindow();if(id!=mock.windowId||!mock.valid)throw new InvalidOperationException("Window identity is invalid.");return mock;}
        long hwnd;var parts=(id??"").Split(':');if(parts.Length!=3||!long.TryParse(parts[0],out hwnd)||hwnd==0)throw new ArgumentException("Invalid windowId.");
        var info=Describe(new IntPtr(hwnd));if(info.windowId!=id)throw new InvalidOperationException("Window HWND/PID/process lifetime changed.");return info;
    }
    public static GameWindowInfo[] List() {
        if(GamePlayerNative.Recording)return new GameWindowInfo[]{InputSession.MockWindow()};
        var list=new List<GameWindowInfo>();EnumWindows(delegate(IntPtr hwnd,IntPtr data){try{list.Add(Describe(hwnd));}catch{}return true;},IntPtr.Zero);return list.ToArray();
    }
    public static void Ready(GameWindowInfo info) {
        if(!info.valid||!info.focused||info.minimized)throw new InvalidOperationException("Target window is invalid, minimized or not focused.");
    }
    public static void Point(GameWindowInfo info,int x,int y) {
        Ready(info);var b=info.client;
        if(x<b.x||y<b.y||(long)x>=(long)b.x+b.width||(long)y>=(long)b.y+b.height)throw new ArgumentException("Mouse point outside bound client area.");
        if(GamePlayerNative.Recording){if(InputSession.MockOccluded())throw new InvalidOperationException("Mouse point is occluded.");return;}
        var hit=GetAncestor(WindowFromPoint(new GamePlayerNative.POINT{X=x,Y=y}),2);
        if(hit.ToInt64().ToString()!=info.windowId.Split(':')[0])throw new InvalidOperationException("Mouse point is occluded by another window.");
    }
}
