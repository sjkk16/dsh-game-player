using System;
public static partial class InputSession {
    // Version 4 ledger: target@64..108; recording-only window controls@116..168.
    static GameWindowInfo Target() {
        if(view.ReadInt32(104)==0)throw new InvalidOperationException("A bound target window is required.");
        return GamePlayerWindow.Get(view.ReadInt64(64)+":"+view.ReadInt32(72)+":"+view.ReadInt64(80));
    }
    static void CheckTarget() {
        try {
            var info=Target();GamePlayerWindow.Ready(info);var b=info.client;
            if(b.x!=view.ReadInt32(88)||b.y!=view.ReadInt32(92)||b.width!=view.ReadInt32(96)||b.height!=view.ReadInt32(100))throw new InvalidOperationException("Target client geometry changed during gesture.");
        }catch { AbortTarget();throw; }
    }
    static void AbortTarget() {
        view.Write(4,1);bool ok=true;
        for(int i=Slots-1;i>=0;i--)if(view.ReadInt32(At(i))!=0){try{ReleaseSlot(i);}catch{ok=false;}}
        if(!ok)view.Write(4,2); Snapshot();
    }
    public static void Begin(int ownerId,int holdLimit,GameWindowInfo target,bool standalone) {
        if(ownerId<=0)throw new ArgumentException("Input needs an owning agent.");
        Locked(delegate {
            if(view.ReadInt32(4)==2)throw new InvalidOperationException("Input release was not confirmed; reload after manual recovery.");
            for(int i=0;i<Slots;i++)if(view.ReadInt32(At(i))!=0&&view.ReadInt32(At(i)+8)!=ownerId)throw new InvalidOperationException("Held input belongs to another agent.");
            if(standalone&&HasEntries())throw new InvalidOperationException("Standalone sequence cannot inherit held input.");
            if(HasEntries())CheckTarget();
            var info=GamePlayerWindow.Get(target.windowId);GamePlayerWindow.Ready(info);
            var b=info.client;if(b.x!=target.client.x||b.y!=target.client.y||b.width!=target.client.width||b.height!=target.client.height)throw new InvalidOperationException("Target geometry changed before injection.");
            var parts=info.windowId.Split(':');view.Write(64,long.Parse(parts[0]));view.Write(72,info.pid);view.Write(80,long.Parse(info.processStart));
            view.Write(88,b.x);view.Write(92,b.y);view.Write(96,b.width);view.Write(100,b.height);view.Write(104,ownerId);
            if(view.ReadInt32(4)==1&&!HasEntries())view.Write(4,0);
            CheckReady();owner=ownerId;maxHold=holdLimit;
        });
    }
    public static void End(){Locked(delegate{if(!HasEntries())view.Write(104,0);});}
    public static void ReleaseKey(int ownerId,int vk){ReleaseOwned(ownerId,1,vk);}
    public static void ReleaseButton(int ownerId,int button){ReleaseOwned(ownerId,2,button);}
    static void ReleaseOwned(int ownerId,int type,int code){Locked(delegate{int slot=Find(type,code);if(slot<0)return;if(view.ReadInt32(At(slot)+8)!=ownerId)throw new InvalidOperationException("Held input belongs to another agent.");try{ReleaseSlot(slot);}catch{view.Write(4,2);Snapshot();throw;}if(!HasEntries())view.Write(104,0);});}
    public static GameWindowInfo MockWindow() {
        bool configured=view.ReadInt32(116)!=0;int pid=configured?view.ReadInt32(152):1;long start=configured?view.ReadInt64(160):1;
        return new GameWindowInfo{windowId="1:"+pid+":"+start,pid=pid,processStart=start.ToString(),title="recording window",valid=!configured||view.ReadInt32(124)!=0,focused=!configured||view.ReadInt32(120)!=0,minimized=configured&&view.ReadInt32(128)!=0,client=new ClientBounds{x=configured?view.ReadInt32(132):-1920,y=configured?view.ReadInt32(136):-80,width=configured?view.ReadInt32(140):4480,height=configured?view.ReadInt32(144):1520}};
    }
    public static bool MockOccluded(){return view.ReadInt32(148)!=0;}
    public static void TestWindow(bool focused,bool valid,bool minimized,int x,int y,int width,int height,bool occluded,int pid,long start){
        if(!GamePlayerNative.Recording)throw new InvalidOperationException("Mock windows are recording-only.");
        Locked(delegate{view.Write(116,1);view.Write(120,focused?1:0);view.Write(124,valid?1:0);view.Write(128,minimized?1:0);view.Write(132,x);view.Write(136,y);view.Write(140,width);view.Write(144,height);view.Write(148,occluded?1:0);view.Write(152,pid);view.Write(160,start);});
    }
}

