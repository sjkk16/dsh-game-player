#nullable enable
using System;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
namespace GamePlayer.Desktop;
internal static class RawKeyboardReceiverQa {
    [StructLayout(LayoutKind.Sequential)] struct Registration { public ushort Page,Usage; public uint Flags; public IntPtr Target; }
    [DllImport("user32.dll",SetLastError=true)] static extern uint GetRegisteredRawInputDevices([Out] Registration[]? devices,ref uint count,uint size);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] [return:MarshalAs(UnmanagedType.Bool)] static extern bool IsWindowVisible(IntPtr window);
    static Registration[] Registrations(){
        uint count=0,size=(uint)Marshal.SizeOf<Registration>();
        if(GetRegisteredRawInputDevices(null,ref count,size)==uint.MaxValue||count>256)throw new InvalidOperationException("Raw Input registration query failed.");
        if(count==0)return Array.Empty<Registration>();var values=new Registration[count];
        uint read=GetRegisteredRawInputDevices(values,ref count,size);if(read==uint.MaxValue)throw new InvalidOperationException("Raw Input registration query failed.");
        return values.Take((int)read).ToArray();
    }
    internal static int Run(){
        if(Registrations().Any(r=>r.Page==1&&r.Usage==6))throw new InvalidOperationException("Fixture will not replace an existing keyboard registration.");
        IntPtr before=GetForegroundWindow();bool registered,hidden;long errors;
        using(var sink=new RawKeyboardSink(_=>{},_=>{})){
            if(!sink.Open())throw new InvalidOperationException("Background keyboard registration failed: "+sink.RegistrationError);
            registered=Registrations().Any(r=>r.Page==1&&r.Usage==6&&r.Target==sink.Handle&&(r.Flags&0x100)!=0);
            hidden=!IsWindowVisible(sink.Handle)&&GetForegroundWindow()!=sink.Handle;
            // A short real message pump verifies lifetime; input packets are discarded, never logged.
            for(int i=0;i<5;i++){System.Windows.Forms.Application.DoEvents();System.Threading.Thread.Sleep(10);}
            errors=sink.ReadErrors;
        }
        bool removed=!Registrations().Any(r=>r.Page==1&&r.Usage==6);
        if(!registered||!hidden||!removed)throw new InvalidOperationException("Background keyboard lifetime/visibility check failed.");
        Console.WriteLine(JsonSerializer.Serialize(new{ok=true,backgroundRegistered=registered,messageWindowHidden=hidden,registrationRemoved=removed,
            foregroundUnchanged=before==GetForegroundWindow(),readErrors=errors,hooksInstalled=false,inputInjected=false,keyEventsRecorded=false,gameValidated=false}));return 0;
    }
}
