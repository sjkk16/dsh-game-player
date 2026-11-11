#nullable enable
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using System.Threading;
namespace GamePlayer.Desktop;
// Entirely read-only: hooks always chain, callbacks never write stdout or inject input.
internal sealed class HumanInputObserver : IDisposable {
    const int KeyboardHook=13, MouseHook=14;
    const long OwnTag=0x44534847;
    delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    readonly HookProc keyboardProc,mouseProc;
    readonly Action<JsonObject> publish;
    readonly object gate=new(); readonly Queue<JsonObject> queue=new();
    readonly HashSet<int> keys=new(),buttons=new();
    readonly AutoResetEvent wake=new(false); readonly ManualResetEventSlim started=new(false);
    readonly string session=Guid.NewGuid().ToString("N");
    Thread? hookThread,writerThread; IntPtr keyboard,mouse; uint threadId; long sequence;
    volatile bool stopping; bool lost; double? x,y;long lastHeartbeat;
    System.Drawing.Rectangle bounds=System.Windows.Forms.SystemInformation.VirtualScreen;long humanMoveAt,externalMoveAt;
    public string Session=>session;public bool IsRunning=>!stopping;
    public void RefreshBounds(){lock(gate)bounds=System.Windows.Forms.SystemInformation.VirtualScreen;}
    internal static string Source(bool keyboard,uint flags,long extra){bool injected=(flags&(keyboard?0x12u:3u))!=0;return !injected?"human":extra==OwnTag?"own":"external";}
    internal static int KeyCode(uint vk,uint scan,uint flags){int key=(int)vk;if(key==13&&(flags&1)!=0)return 256;if(key==16)return scan==0x36?161:160;if(key==17)return (flags&1)!=0?163:162;if(key==18)return (flags&1)!=0?165:164;return key;}
    public string? Error {get;private set;}
    public HumanInputObserver(Action<JsonObject> output){publish=output;keyboardProc=Keyboard;mouseProc=Mouse;}
    public bool Start(){
        writerThread=new Thread(WriteLoop){IsBackground=true,Name="DSH read-only input output"};writerThread.Start();
        hookThread=new Thread(HookLoop){IsBackground=true,Name="DSH read-only input hooks"};hookThread.Start();
        if(!started.Wait(1500)){Error="Read-only input listener startup timed out.";Dispose();return false;}
        if(Error!=null){Dispose();return false;}return true;
    }
    void HookLoop(){
        try{
            threadId=GetCurrentThreadId();PeekMessage(out _,IntPtr.Zero,0,0,0); // establish queue before Stop can post
            keyboard=SetWindowsHookEx(KeyboardHook,keyboardProc,GetModuleHandle(null),0);
            mouse=SetWindowsHookEx(MouseHook,mouseProc,GetModuleHandle(null),0);
            if(keyboard==IntPtr.Zero||mouse==IntPtr.Zero)throw new InvalidOperationException("Read-only key/mouse hooks unavailable ("+Marshal.GetLastWin32Error()+").");
            lock(gate)queue.Enqueue(new JsonObject{["kind"]="human-observer-status",["status"]="connected",["session"]=session});wake.Set();started.Set();
            while(!stopping&&GetMessage(out var message,IntPtr.Zero,0,0)>0){TranslateMessage(ref message);DispatchMessage(ref message);}
        }catch(Exception e){Error=e.Message;started.Set();}
        finally{
            if(keyboard!=IntPtr.Zero)UnhookWindowsHookEx(keyboard);if(mouse!=IntPtr.Zero)UnhookWindowsHookEx(mouse);
            keyboard=mouse=IntPtr.Zero;stopping=true;wake.Set();started.Set();
        }
    }
    JsonObject Snapshot(string source,string kind,int device,int code,int amount){
        var heldKeys=new JsonArray();foreach(int k in keys.OrderBy(k=>k))heldKeys.Add(k);
        var heldButtons=new JsonArray();foreach(int b in buttons.OrderBy(b=>b))heldButtons.Add(b);
        return new JsonObject{["kind"]="human-observation",["session"]=session,["sequence"]=++sequence,["source"]=source,["event"]=kind,["device"]=device,["code"]=code,["amount"]=amount,
            ["heldKeys"]=heldKeys,["heldButtons"]=heldButtons,["position"]=x.HasValue?new JsonObject{["x"]=x.Value,["y"]=y!.Value}:null};
    }
    void Enqueue(string source,string kind,int device,int code,int amount){
        // Called with the tiny state lock held. Full snapshots repair queue loss.
        if(queue.Count>=128){queue.Clear();lost=true;}
        var packet=Snapshot(source,kind,device,code,amount);if(lost){packet["resync"]=true;lost=false;}queue.Enqueue(packet);wake.Set();
    }
    IntPtr Keyboard(int n,IntPtr message,IntPtr data){
        if(n>=0&&!stopping)try{
            var info=Marshal.PtrToStructure<KeyInfo>(data);int m=message.ToInt32();bool down=m==0x100||m==0x104,up=m==0x101||m==0x105;
            string source=Source(true,info.Flags,info.ExtraInfo.ToInt64());
            if((down||up)&&source!="own")lock(gate){
                bool injected=source=="external";int key=KeyCode(info.Vk,info.Scan,info.Flags);
                if(key>=0&&key<=256){if(!injected){if(down)keys.Add(key);else keys.Remove(key);}Enqueue(injected?"external":"human",down?"down":"up",1,key,0);}
            }
        }catch{/* observation can never block another application's input */}
        return CallNextHookEx(IntPtr.Zero,n,message,data);
    }
    IntPtr Mouse(int n,IntPtr message,IntPtr data){
        if(n>=0&&!stopping)try{
            var info=Marshal.PtrToStructure<MouseInfo>(data);int m=message.ToInt32();
            string source=Source(false,info.Flags,info.ExtraInfo.ToInt64());
            if(source!="own")lock(gate){
                bool injected=source=="external";int code=-1;string? kind=null;int amount=0;
                if(m==0x200)kind="move";
                else if(m==0x20a||m==0x20e){kind="wheel";amount=(short)(info.MouseData>>16);}
                else if(m==0x201||m==0x202){code=0;kind=m==0x201?"down":"up";}
                else if(m==0x204||m==0x205){code=1;kind=m==0x204?"down":"up";}
                else if(m==0x207||m==0x208){code=2;kind=m==0x207?"down":"up";}
                else if(m==0x20b||m==0x20c){code=(info.MouseData>>16)==1?3:4;kind=m==0x20b?"down":"up";}
                if(kind!=null){if(!injected){if(code>=0){if(kind=="down")buttons.Add(code);else buttons.Remove(code);}x=Math.Clamp((double)(info.X-bounds.Left)/Math.Max(1,bounds.Width-1),0,1);y=Math.Clamp((double)(info.Y-bounds.Top)/Math.Max(1,bounds.Height-1),0,1);}long now=Environment.TickCount64;bool emit=kind!="move"||now-(injected?externalMoveAt:humanMoveAt)>=16;if(emit){if(kind=="move"){if(injected)externalMoveAt=now;else humanMoveAt=now;}Enqueue(injected?"external":"human",kind,2,Math.Max(0,code),amount);}}
            }
        }catch{/* no input interception, even on observer failure */}
        return CallNextHookEx(IntPtr.Zero,n,message,data);
    }
    void WriteLoop(){
        try{
            while(!stopping){wake.WaitOne(250);List<JsonObject> batch=new();lock(gate){while(queue.Count>0)batch.Add(queue.Dequeue());long now=Environment.TickCount64;if(keyboard!=IntPtr.Zero&&!stopping&&now-lastHeartbeat>=250){batch.Add(Snapshot("human","state",0,0,0));lastHeartbeat=now;}}foreach(var value in batch){if(stopping)break;publish(value);}}
        }catch{stopping=true;if(threadId!=0)PostThreadMessage(threadId,0x12,IntPtr.Zero,IntPtr.Zero);}
    }
    public void Dispose(){stopping=true;if(threadId!=0)PostThreadMessage(threadId,0x12,IntPtr.Zero,IntPtr.Zero);wake.Set();hookThread?.Join(500);writerThread?.Join(500);lock(gate){keys.Clear();buttons.Clear();queue.Clear();}}
    [StructLayout(LayoutKind.Sequential)] struct KeyInfo{public uint Vk,Scan,Flags,Time;public IntPtr ExtraInfo;}
    [StructLayout(LayoutKind.Sequential)] struct MouseInfo{public int X,Y;public uint MouseData,Flags,Time;public IntPtr ExtraInfo;}
    [StructLayout(LayoutKind.Sequential)] struct Message{public IntPtr Hwnd;public uint Id;public UIntPtr WParam;public IntPtr LParam;public uint Time;public int X,Y;public uint Private;}
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id,HookProc proc,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string? name);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern int GetMessage(out Message message,IntPtr hwnd,uint min,uint max);
    [DllImport("user32.dll")] static extern bool PeekMessage(out Message message,IntPtr hwnd,uint min,uint max,uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint id,uint message,IntPtr wp,IntPtr lp);
}
