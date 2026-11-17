#nullable enable
using System;
using System.Linq;
using System.Reflection;
namespace GamePlayer.Desktop;
// Pure packet/queue fixtures. No native registration, hooks, desktop window or input injection.
internal static class RawKeyboardQa {
    internal static int Run(){
        int count=0;void Check(bool value){count++;if(!value)throw new InvalidOperationException("Raw keyboard fixture "+count+" failed.");}
        var device=new IntPtr(1);var second=new IntPtr(2);
        RawKeyboardPacket Packet(ushort key=65,ushort scan=30,ushort flags=0)=>new(device,scan,flags,key,(flags&1)==0?0x100u:0x101u,0);
        RawKeyEvent Decode(RawKeyboardPacket p){Check(KeyboardObservationRules.Decode(p,out var value));return value;}
        Check(Decode(Packet()).Key==65);Check(Decode(Packet(flags:1)).Down==false);
        Check(Decode(Packet(16,0x2a)).Key==160);Check(Decode(Packet(16,0x36)).Key==161);
        Check(Decode(Packet(17,0x1d)).Key==162);Check(Decode(Packet(17,0x1d,2)).Key==163);
        Check(Decode(Packet(18,0x38)).Key==164);Check(Decode(Packet(18,0x38,2)).Key==165);
        Check(Decode(Packet(13,0x1c)).Key==13);Check(Decode(Packet(13,0x1c,2)).Key==256);
        Check(Decode(Packet(13,0x1c,3)).Key==256);Check(Decode(Packet(44,0x37,2)).Key==44);
        Check(!KeyboardObservationRules.Decode(Packet(16,0x2a,2),out _));
        Check(Decode(Packet(19,0x45,4)).Transient);Check(!Decode(Packet(144,0x45,2)).Transient);
        Check(!KeyboardObservationRules.Decode(Packet(17,0x1d,4),out _));
        Check(!KeyboardObservationRules.Decode(Packet(255),out _));Check(!KeyboardObservationRules.Decode(Packet(scan:255),out _));
        Check(!KeyboardObservationRules.Decode(Packet(flags:8),out _));Check(!KeyboardObservationRules.Decode(Packet() with{Device=IntPtr.Zero},out _));
        Check(!KeyboardObservationRules.Decode(Packet() with{Extra=0x44534847},out _));Check(!KeyboardObservationRules.Decode(Packet() with{Message=0x101},out _));
        Check(Decode(Packet(18,0x38) with{Message=0x104}).Key==164);
        Check(KeyboardObservationRules.Backend(true,true)=="raw-input");Check(KeyboardObservationRules.Backend(true,false)=="raw-input");
        Check(KeyboardObservationRules.Backend(false,true)=="hook");Check(KeyboardObservationRules.Backend(false,false)=="unavailable");
        Check(!KeyboardObservationRules.AcceptHook(true,"human"));Check(KeyboardObservationRules.AcceptHook(false,"human"));
        Check(!KeyboardObservationRules.AcceptHook(true,"own"));Check(!KeyboardObservationRules.AcceptHook(false,"own"));Check(KeyboardObservationRules.AcceptHook(true,"external"));
        var state=new RawKeyboardState();var down=Decode(Packet());
        Check(state.Apply(device,down));Check(!state.Apply(device,down));Check(!state.Apply(second,down));
        Check(!state.Apply(device,down with{Down=false}));Check(state.Held.SequenceEqual(new[]{65}));
        Check(state.Remove(second));Check(!state.Held.Any());Check(!state.Remove(second));
        Check(state.Apply(device,down));Check(state.Apply(second,new(87,true,false)));Check(state.Held.Count()==2);
        Check(state.Remove(device));Check(state.Held.SequenceEqual(new[]{87}));state.Clear();Check(!state.Held.Any());
        Check(!state.Apply(device,down with{Down=false}));Check(!state.Apply(IntPtr.Zero,down));
        for(int i=1;i<=64;i++)state.Apply(new IntPtr(i),down);
        Check(!state.Apply(new IntPtr(65),new(87,true,false)));Check(state.Held.SequenceEqual(new[]{65}));state.Clear();
        // Exercise the production ingestion and bounded queue without starting the observer.
        using(var observer=new HumanInputObserver(_=>throw new Exception("Fixture must not publish"))){
            const BindingFlags flags=BindingFlags.Instance|BindingFlags.NonPublic;
            var type=typeof(HumanInputObserver);
            type.GetField("connected",flags)!.SetValue(observer,true);
            type.GetField("rawRegistered",flags)!.SetValue(observer,true);
            void Feed(RawKeyboardPacket p)=>type.GetMethod("RawKeyboard",flags)!.Invoke(observer,new object[]{p});
            for(int i=0;i<400;i++)Feed(Packet(flags:(ushort)(i%2)));
            Check(observer.Diagnostics()["queueDrops"]!.GetValue<long>()>0);
            bool announced=false;var batch=observer.CollectBatch(ref announced);
            Check(announced);Check(batch[0]["kind"]!.GetValue<string>()=="human-observer-status");
            Check(batch.Count<=130);Check(batch.Skip(1).Any(p=>p["resync"]?.GetValue<bool>()==true));
            Check(batch[^1]["heldKeys"]!.AsArray().Count==0);
            var seq=batch.Skip(1).Select(p=>p["sequence"]!.GetValue<long>()).ToArray();Check(seq.Zip(seq.Skip(1),(a,b)=>b>a).All(v=>v));
            Feed(Packet(87,17));batch=observer.CollectBatch(ref announced);Check(batch[^1]["heldKeys"]!.AsArray().Count==1);
            Feed(Packet(87,17));Check(observer.CollectBatch(ref announced).All(p=>p["event"]?.GetValue<string>()=="state")); // typematic does not create duplicate edges
            type.GetMethod("RemoveKeyboardDevice",flags)!.Invoke(observer,new object[]{device});batch=observer.CollectBatch(ref announced);
            Check(batch[^1]["heldKeys"]!.AsArray().Count==0);Check(batch.Any(p=>p["resync"]?.GetValue<bool>()==true));
            Feed(Packet(19,0x45,4));batch=observer.CollectBatch(ref announced);Check(batch[^1]["heldKeys"]!.AsArray().Count==0);
            Check(!observer.Diagnostics().ToJsonString().Contains("heldKeys"));
        }
        return count;
    }
}
