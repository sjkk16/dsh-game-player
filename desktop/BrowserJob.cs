#nullable enable
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.ComponentModel;
using Microsoft.Win32.SafeHandles;
namespace GamePlayer.Desktop;
// This job owns ONLY process IDs reported by our private WebView2 environment.
// Closing the job (including abrupt host termination) tears down its descendants.
internal sealed class BrowserJob : IDisposable {
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string? name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,IntPtr data,uint size);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential)] struct Basic { public long ProcessTime,JobTime; public uint Flags; public UIntPtr Min,Max; public uint Processes; public UIntPtr Affinity;public uint Priority,Scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct Io { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct Limits { public Basic Basic;public Io Io;public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
[DllImport("kernel32.dll",SetLastError=true)] static extern SafeProcessHandle OpenProcess(uint access,bool inherit,int pid);
    IntPtr handle;
    public BrowserJob() {
        handle=CreateJobObject(IntPtr.Zero,null);if(handle==IntPtr.Zero)throw new Win32Exception();
        var limits=new Limits{Basic=new Basic{Flags=0x2000}};int size=Marshal.SizeOf<Limits>();var mem=Marshal.AllocHGlobal(size);
        try{Marshal.StructureToPtr(limits,mem,false);if(!SetInformationJobObject(handle,9,mem,(uint)size))throw new Win32Exception();}
        catch{Dispose();throw;}finally{Marshal.FreeHGlobal(mem);}
    }
    public void Own(int pid) {
        if(handle==IntPtr.Zero)return;
        using var p=OpenProcess(0x1101,false,pid);if(p.IsInvalid){if(Marshal.GetLastWin32Error()==87)return;throw new Win32Exception();}
        if(IsProcessInJob(p.DangerousGetHandle(),handle,out bool already)&&already)return;
        if(!AssignProcessToJobObject(handle,p.DangerousGetHandle()))throw new Win32Exception();
    }
    public void Dispose(){if(handle==IntPtr.Zero)return;CloseHandle(handle);handle=IntPtr.Zero;}
}
