using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;

// One serialized stdout writer. Telemetry producers never write pipes, wait for
// the writer, or hold a queue lock while it writes. Request replies are reliable.
public static class GamePlayerOutput {
    static readonly object queueLock = new object(), outputLock = new object();
    static readonly Queue<string> events = new Queue<string>();
    static readonly AutoResetEvent ready = new AutoResetEvent(false);
    static Thread writer;
    static bool lost;
    static volatile bool stopping;
    public static void Start() {
        if (writer != null) return;
        writer = new Thread(Loop) { IsBackground = true }; writer.Start();
    }
    public static void Event(string json) {
        lock (queueLock) {
            if (events.Count >= 128) { events.Clear(); lost = true; }
            if (lost) { json = json.Substring(0,json.Length-1) + ",\"resync\":true}"; lost=false; }
            events.Enqueue(json);
        }
        ready.Set();
    }
    public static void Reply(string json) {
        lock (outputLock) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    }
    static void Loop() {
        while (!stopping) {
            ready.WaitOne(100);
            for (;;) {
                string json;
                lock (queueLock) { if(events.Count==0) break; json=events.Dequeue(); }
                try { Reply(json); } catch { stopping=true; break; }
            }
        }
    }
    public static void Stop() { stopping=true; ready.Set(); if(writer!=null) writer.Join(100); }
}

public static partial class InputSession {
    // v4: position-valid@184, normalized x/y integers@188/192; global observation sequence@176; per-slot confirmed-down@24.
    // No text/Unicode code units ever leave this observer.
    static bool observing;
    static string observationSession;
    static long lastSnapshot;
    static void ConfigureObservation(string session, bool enabled) {
        observing=enabled;
        observationSession=session.Replace("\\", "\\\\").Replace("\"", "\\\"");
        if(enabled) GamePlayerOutput.Start();
    }
    static void Observe(string kind, int type, int code, int eventOwner, int amount) {
        if(!observing) return;
        try {
            long seq=view.ReadInt64(176)+1; view.Write(176,seq);
            var keys=new List<int>(); var buttons=new List<int>(); bool uncertain=false;
            for(int i=0;i<Slots;i++) {
                int at=At(i), t=view.ReadInt32(at);
                if(t==0) continue;
                if(view.ReadInt32(at+24)!=1) { uncertain=true; continue; }
                if(t==1) keys.Add(view.ReadInt32(at+4));
                if(t==2) buttons.Add(view.ReadInt32(at+4));
            }
            // Values interpolated below are fixed enums, integers and our escaped
            // generated session id. The input text is deliberately not a field.
            string json="{\"kind\":\"input-observation\",\"session\":\""+observationSession
                +"\",\"sequence\":"+seq+",\"source\":\""+(guard?"guard":"worker")
                +"\",\"timestamp\":"+RealNow()+",\"ownerId\":"+eventOwner
                +",\"event\":\""+kind+"\",\"device\":"+type+",\"code\":"+(type==3?0:code)
                +",\"amount\":"+amount+",\"state\":"+view.ReadInt32(4)
                +",\"uncertain\":"+(uncertain?"true":"false")
                +",\"position\":"+(view.ReadInt32(184)==1 ? "{\"x\":"+(view.ReadInt32(188)/65535.0).ToString(System.Globalization.CultureInfo.InvariantCulture)+",\"y\":"+(view.ReadInt32(192)/65535.0).ToString(System.Globalization.CultureInfo.InvariantCulture)+"}" : "null")
                +",\"heldKeys\":["+String.Join(",",keys)+"],\"heldButtons\":["+String.Join(",",buttons)+"]}";
            GamePlayerOutput.Event(json); lastSnapshot=RealNow();
        } catch { /* Observation must never change input or release outcomes. */ }
    }
    static void Snapshot() { Observe("state",0,0,0,0); }
    static void SnapshotIfDue() { if(observing && RealNow()-lastSnapshot>=250) Snapshot(); }
}
