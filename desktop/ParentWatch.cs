#nullable enable
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace GamePlayer.Desktop;
internal sealed class ParentWatch : IDisposable {
    [DllImport("kernel32.dll",SetLastError=true)] static extern SafeProcessHandle OpenProcess(uint access,bool inherit,int pid);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(SafeProcessHandle process,uint timeout);
    readonly SafeProcessHandle handle;
    public ParentWatch(int pid) { handle=OpenProcess(0x100000,false,pid);if(handle.IsInvalid)throw new Win32Exception(); }
    public bool HasExited=>WaitForSingleObject(handle,0)!=258;
    public void Dispose()=>handle.Dispose();
}
