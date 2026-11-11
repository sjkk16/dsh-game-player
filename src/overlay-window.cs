using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Display-only executable. No hooks, polling of physical keys or input injection.
//
// Appearance is data, not code: `Style()` applies a payload of resolved colors
// plus a key-count preset, and the panel recomputes its canvas from the keys that
// preset leaves visible. The same class draws the standalone panel and the
// keyboard view embedded in the Live2D desktop host.
public sealed class GamePlayerOverlay : Form {
    const int WS_EX_TRANSPARENT=0x20, WS_EX_TOOLWINDOW=0x80, WS_EX_NOACTIVATE=0x08000000;
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
    [DllImport("user32.dll")] static extern bool GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("dwmapi.dll")] static extern int DwmFlush();
    readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=65536 };
    readonly object inboxLock=new object();
    readonly Queue<Dictionary<string,object>> commands=new Queue<Dictionary<string,object>>();
    Dictionary<string,object> latest;
    readonly Dictionary<string,long> pulses=new Dictionary<string,long>();
    readonly HashSet<string> held=new HashSet<string>(), buttons=new HashSet<string>();
    readonly List<Dictionary<string,object>> keys=new List<Dictionary<string,object>>();
    Dictionary<string,object> layouts=new Dictionary<string,object>();
    readonly List<Dictionary<string,object>> visible=new List<Dictionary<string,object>>();
    readonly HashSet<string> visibleIds=new HashSet<string>(StringComparer.Ordinal);
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    NotifyIcon tray;
    Process parent;
    string settingsPath, mode="real", status="ready", hint="";
    bool embedded;
    bool simulation, adjusting, userHidden, activated, captureHidden, closed, offline, saving;
    volatile bool eof;
    int wheelDirection;
    long moveUntil, textUntil, wheelUntil;
    double widthDip=900, opacityValue=.85;
    // Appearance. The defaults are the shipped dark palette; a style payload
    // replaces them one color at a time, so a partial payload never blanks out.
    string controlMode="ai-only",lastActor="",controlNotes="";
    string theme="dark", accent="teal", layout="full", skin="builtin", skinPath;
    Color surface=Color.FromArgb(17,23,34), ink=Color.FromArgb(230,237,246), muted=Color.FromArgb(135,149,169);
    Color keyFill=Color.FromArgb(31,41,57), keyEdge=Color.FromArgb(57,71,90);
    Color accentReal=Color.FromArgb(73,223,190), accentSim=Color.FromArgb(255,183,83);
    Bitmap skinImage;
    string skinError;
    // Canvas computed from the visible keys: `contentLeft/Top` is the offset at
    // which absolute layout coordinates start, `mouseX` is the mouse block.
    float contentLeft, contentTop, mouseX, mouseY, footerTop, canvasWidth=1040, canvasHeight=364;
    float logicalWidth=1040, logicalHeight=364;
    Point dragOrigin, windowOrigin;
    bool dragging;
    long nextParentCheck, lastStateAt;
    bool affinity;
    static long Now() { return (long)(Stopwatch.GetTimestamp()*(1000.0/Stopwatch.Frequency)); }
    static string Str(Dictionary<string,object> d,string k,string def="") { object v;return d!=null&&d.TryGetValue(k,out v)&&v!=null?Convert.ToString(v):def; }
    static double Num(Dictionary<string,object> d,string k,double def=0) { object v;try{return d!=null&&d.TryGetValue(k,out v)?Convert.ToDouble(v):def;}catch{return def;} }
    static bool Bool(Dictionary<string,object> d,string k) { object v;return d!=null&&d.TryGetValue(k,out v)&&v is bool&&(bool)v; }
    static IEnumerable Items(Dictionary<string,object> d,string k) { object v;return d!=null&&d.TryGetValue(k,out v)&&v is IEnumerable?(IEnumerable)v:new object[0]; }
    static bool IsHex(string text) {
        if(String.IsNullOrEmpty(text)||text.Length!=7||text[0]!='#')return false;
        for(int i=1;i<7;i++){char c=text[i];bool hex=(c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F');if(!hex)return false;}
        return true;
    }
    static Color Hex(Dictionary<string,object> d,string key,Color fallback) {
        object v;
        if(d==null||!d.TryGetValue(key,out v)||v==null)return fallback;
        string text=Convert.ToString(v);
        if(!IsHex(text))return fallback;
        try{return ColorTranslator.FromHtml(text);}catch{return fallback;}
    }
    static void Report(string message) { try { Console.Error.WriteLine("overlay: "+message); } catch {} }
    /** Aspect ratio (height/width) of the current key-count preset. */
    public double AspectRatio { get { return canvasHeight/canvasWidth; } }
    public GamePlayerOverlay(string layoutPath,string savedSettings,int parentPid,bool renderOnly) {
        offline=renderOnly; settingsPath=savedSettings;
        var root=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(layoutPath));
        foreach(Dictionary<string,object> k in Items(root,"keys"))keys.Add(k);
        object presets;if(root.TryGetValue("layouts",out presets)&&presets is Dictionary<string,object>)layouts=(Dictionary<string,object>)presets;
        AutoScaleMode=AutoScaleMode.None; FormBorderStyle=FormBorderStyle.None; ShowInTaskbar=false;
        TopMost=true; DoubleBuffered=true; StartPosition=FormStartPosition.Manual;
        BackColor=surface; Text="AI Input · 游戏代打";
        if(!offline) { try{parent=Process.GetProcessById(parentPid);var unused=parent.Handle;}catch{throw new InvalidOperationException("Overlay needs a live parent process.");} }
        ApplyLayout();
        LoadSettings();
        timer.Interval=30; timer.Tick+=delegate { Drain(); if(closed)return; if(activated&&!simulation&&Now()-lastStateAt>1500)status="unknown"; Invalidate(); if(!offline&&Now()>=nextParentCheck){nextParentCheck=Now()+1000;try{if(parent.HasExited)Finish();}catch{Finish();}} };
        FormClosed+=delegate { Cleanup(); if(!embedded)Application.ExitThread(); };
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var cp=base.CreateParams;cp.ExStyle|=WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW;if(!adjusting)cp.ExStyle|=WS_EX_TRANSPARENT;return cp; } }
    protected override void WndProc(ref Message m) {
        if(m.Msg==0x21){m.Result=new IntPtr(3);return;} // MA_NOACTIVATE
        if(m.Msg==0x84&&!adjusting){m.Result=new IntPtr(-1);return;} // HTTRANSPARENT
        if(m.Msg==0x02E0){ // WM_DPICHANGED: retain logical size on the new monitor.
            var r=(NativeRect)Marshal.PtrToStructure(m.LParam,typeof(NativeRect));
            Location=new Point(r.left,r.top);ApplySize((int)((long)m.WParam&65535));return;
        }
        base.WndProc(ref m);
    }
    [StructLayout(LayoutKind.Sequential)] struct NativeRect { public int left,top,right,bottom; }
    bool HasLayout(string name) { return !String.IsNullOrEmpty(name)&&layouts.ContainsKey(name); }
    HashSet<string> Hidden() {
        var hide=new HashSet<string>(StringComparer.Ordinal);
        object preset,raw;
        if(layouts.TryGetValue(layout,out preset)&&preset is Dictionary<string,object>&&((Dictionary<string,object>)preset).TryGetValue("hide",out raw)&&raw is IEnumerable)
            foreach(object id in (IEnumerable)raw)hide.Add(Convert.ToString(id));
        return hide;
    }
    /** Recompute the visible keys and the canvas they occupy. */
    void ApplyLayout() {
        var hide=Hidden();
        visible.Clear(); visibleIds.Clear();
        float minX=Single.MaxValue, minY=Single.MaxValue, maxX=Single.MinValue, maxY=Single.MinValue;
        foreach(var k in keys) {
            string id=Str(k,"id");
            if(hide.Contains(id))continue;
            visible.Add(k); visibleIds.Add(id);
            float x=(float)Num(k,"x"), y=(float)Num(k,"y"), w=(float)Num(k,"w"), h=(float)Num(k,"h");
            if(x<minX)minX=x; if(y<minY)minY=y; if(x+w>maxX)maxX=x+w; if(y+h>maxY)maxY=y+h;
        }
        if(visible.Count==0) { foreach(var k in keys)visible.Add(k); minX=20; minY=70; maxX=848; maxY=320; }
        // Header band is 70 DIP above the first key row, footer 34 DIP below the
        // last one; the mouse block keeps its original 37 DIP gap at the right.
        contentLeft=minX-20; contentTop=minY-70;
        mouseX=maxX+37; mouseY=minY+20; footerTop=maxY+9;
        canvasWidth=mouseX+133+22-contentLeft; canvasHeight=footerTop+25+10-contentTop;
        logicalWidth=canvasWidth; logicalHeight=canvasHeight;
    }
    void LoadSettings() {
        var area=Screen.PrimaryScreen.WorkingArea;
        Location=new Point(area.Right-920,area.Bottom-340);
        try {
            if(!String.IsNullOrEmpty(settingsPath)&&File.Exists(settingsPath)) {
                var s=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(settingsPath));
                widthDip=Num(s,"keyboardWidthDip",Num(s,"widthDip",900));opacityValue=Num(s,"opacity",.85);
                Location=new Point((int)Num(s,"x",Location.X),(int)Num(s,"y",Location.Y));
                SetSkinPath(Str(s,"keyboardImage",""));
            }
        }catch(Exception e){Report("Settings ignored: "+e.Message);}
        widthDip=Math.Max(450,Math.Min(1350,Double.IsNaN(widthDip)?900:widthDip));
        opacityValue=Math.Max(.45,Math.Min(1,Double.IsNaN(opacityValue)?.85:opacityValue));
        Opacity=opacityValue;ApplySize(96);
    }
    void ApplySize(int dpi) {
        var area=Screen.FromPoint(new Point(Location.X,Location.Y)).WorkingArea;
        int width=(int)Math.Round(widthDip*Math.Max(96,dpi)/96.0);
        width=Math.Max(240,Math.Min(width,area.Width-24));
        int height=(int)Math.Round(width*logicalHeight/logicalWidth);
        if(height>area.Height-24){height=Math.Max(100,area.Height-24);width=(int)(height*logicalWidth/logicalHeight);}
        Size=new Size(width,height);
        Location=new Point(Math.Max(area.Left,Math.Min(Location.X,area.Right-Width)),Math.Max(area.Top,Math.Min(Location.Y,area.Bottom-Height)));
        Invalidate();
    }
    int Dpi() { try{return (int)GetDpiForWindow(Handle);}catch{return 96;} }
    void SaveSettings() {
        if(offline||saving||String.IsNullOrEmpty(settingsPath))return;
        saving=true;string temp=settingsPath+"."+Process.GetCurrentProcess().Id+".tmp";
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(settingsPath));
            var saved=File.Exists(settingsPath)?json.Deserialize<Dictionary<string,object>>(File.ReadAllText(settingsPath)):new Dictionary<string,object>();
            saved["x"]=Left;saved["y"]=Top;saved["opacity"]=opacityValue;saved["keyboardWidthDip"]=widthDip;
            if(String.IsNullOrEmpty(skinPath))saved.Remove("keyboardImage");else saved["keyboardImage"]=skinPath;
            if(!saved.ContainsKey("version"))saved["version"]=3;
            File.WriteAllText(temp,json.Serialize(saved),new System.Text.UTF8Encoding(false));
            if(File.Exists(settingsPath))File.Replace(temp,settingsPath,null);else File.Move(temp,settingsPath);
        }catch(Exception e){Report("Could not save settings: "+e.Message);try{File.Delete(temp);}catch{}}
        finally{saving=false;}
    }
    /**
     * Load or clear the user-supplied keyboard image.
     *
     * The image is display input only: a bounded local file, decoded once into an
     * owned bitmap so the original can move or be deleted afterwards. Anything
     * unexpected keeps the built-in drawing instead of breaking the panel.
     */
    void SetSkinPath(string value) {
        if(skinImage!=null){skinImage.Dispose();skinImage=null;}
        skinPath=String.IsNullOrWhiteSpace(value)?null:value.Trim();
        skinError=null;
        if(skinPath==null)return;
        try {
            string full=Path.GetFullPath(skinPath);
            string ext=Path.GetExtension(full).ToLowerInvariant();
            if(ext!=".png"&&ext!=".jpg"&&ext!=".jpeg"&&ext!=".bmp")throw new InvalidDataException("Unsupported image type.");
            if(full.StartsWith(@"\\")||full.StartsWith("//"))throw new InvalidDataException("Keyboard images must be a local file.");
            var info=new FileInfo(full);
            if(!info.Exists)throw new FileNotFoundException("Keyboard image not found.");
            if(info.Length>8*1024*1024)throw new InvalidDataException("Keyboard image is larger than 8 MB.");
            using(var stream=new FileStream(full,FileMode.Open,FileAccess.Read,FileShare.Read))
            using(var source=Image.FromStream(stream,true,true))skinImage=new Bitmap(source);
        } catch(Exception e) { skinError=e.Message;Report("Keyboard image ignored: "+e.Message); }
    }
    /**
     * Apply one style payload.
     *
     * Colors arrive already resolved by the Host, so a new theme never needs a
     * native rebuild. Missing or malformed entries keep the current value.
     * Returns whether a requested custom skin is actually available.
     */
    bool ApplyStyle(Dictionary<string,object> style) {
        if(style==null)return skin!="custom"||skinImage!=null;
        string next=Str(style,"theme",theme);if(!String.IsNullOrEmpty(next))theme=next;
        next=Str(style,"accent",accent);if(!String.IsNullOrEmpty(next))accent=next;
        object raw;
        if(style.TryGetValue("colors",out raw)&&raw is Dictionary<string,object>) {
            var colors=(Dictionary<string,object>)raw;
            surface=Hex(colors,"background",surface);ink=Hex(colors,"text",ink);muted=Hex(colors,"muted",muted);
            keyFill=Hex(colors,"keyFill",keyFill);keyEdge=Hex(colors,"keyEdge",keyEdge);
            accentReal=Hex(colors,"accent",accentReal);accentSim=Hex(colors,"accentSim",accentSim);
        }
        next=Str(style,"layout",layout);if(HasLayout(next))layout=next;
        next=Str(style,"skin",skin);if(next=="builtin"||next=="custom")skin=next;
        if(style.ContainsKey("skinPath"))SetSkinPath(Str(style,"skinPath",""));
        BackColor=surface;
        ApplyLayout();
        // Offline QA and the embedded keyboard view are sized by their owner; only
        // the standalone panel resizes itself when the key-count preset changes.
        if(!offline)ApplySize(Dpi());
        Invalidate();
        return skin!="custom"||skinImage!=null;
    }
    void SetAdjusting(bool value) {
        adjusting=value;int ex=GetWindowLong(Handle,-20);
        SetWindowLong(Handle,-20,value?ex&~WS_EX_TRANSPARENT:ex|WS_EX_TRANSPARENT);
        if(value){userHidden=false;UpdateVisible();}else SaveSettings();Invalidate();
    }
    /**
     * Pick a keyboard image and keep a copy beside the overlay settings, so the
     * panel still finds it after the original moves. Same rule as the Live2D
     * model: the path is local state, the mode is a Host setting.
     */
    void ImportSkin() {
        if(offline||String.IsNullOrEmpty(settingsPath))return;
        using(var dialog=new OpenFileDialog { Filter="键盘图片|*.png;*.jpg;*.jpeg;*.bmp", CheckFileExists=true, Title="选择键盘图片" }) {
            if(dialog.ShowDialog()!=DialogResult.OK)return;
            try {
                string directory=Path.Combine(Path.GetDirectoryName(settingsPath),"keyboard-skins");
                Directory.CreateDirectory(directory);
                string target=Path.Combine(directory,"keyboard"+Path.GetExtension(dialog.FileName).ToLowerInvariant());
                File.Copy(dialog.FileName,target,true);
                SetSkinPath(target);
                if(skinImage==null)throw new InvalidDataException(skinError==null?"The image could not be read.":skinError);
                SaveSettings();ApplySize(Dpi());Invalidate();
                // The image is local state; the mode is a Host setting. Say so
                // instead of silently overriding the user's chosen style.
                if(skin!="custom")MessageBox.Show("键盘图片已导入。请到「设置 → 游戏代打 → 键盘外观」把键盘皮肤切到「自定义图片」。","AI 键鼠可视化");
            }catch(Exception e){Report("Could not import keyboard image: "+e.Message);}
        }
    }
    void MakeTray() {
        tray=new NotifyIcon {Icon=SystemIcons.Application,Text="AI 键鼠可视化",Visible=true};
        var menu=new ContextMenuStrip();
        menu.Items.Add("显示 / 隐藏",null,delegate{userHidden=!userHidden;UpdateVisible();});
        menu.Items.Add("进入 / 退出调整模式",null,delegate{SetAdjusting(!adjusting);});
        var scale=new ToolStripMenuItem("大小");
        foreach(int percent in new[]{75,100,125,150}){int p=percent;scale.DropDownItems.Add(p+"%",null,delegate{widthDip=900*p/100.0;ApplySize(Dpi());SaveSettings();});}
        menu.Items.Add(scale);
        var opacity=new ToolStripMenuItem("不透明度");
        foreach(int percent in new[]{60,75,85,100}){int p=percent;opacity.DropDownItems.Add(p+"%",null,delegate{opacityValue=p/100.0;Opacity=opacityValue;SaveSettings();});}
        menu.Items.Add(opacity);
        menu.Items.Add("导入键盘图片…",null,delegate{ImportSkin();});
        menu.Items.Add("清除键盘图片",null,delegate{if(skinPath==null)return;SetSkinPath(null);SaveSettings();ApplySize(Dpi());Invalidate();});
        menu.Items.Add("恢复默认",null,delegate{widthDip=900;opacityValue=.85;Opacity=.85;var a=Screen.PrimaryScreen.WorkingArea;Location=new Point(a.Right-920,a.Bottom-340);ApplySize(Dpi());SaveSettings();});
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("本次会话关闭",null,delegate{Send(new {kind="closed"});Finish();});
        tray.ContextMenuStrip=menu;
        tray.DoubleClick+=delegate{userHidden=!userHidden;UpdateVisible();};
    }
    void Send(object value) { if(embedded)return;try { Console.Out.WriteLine(json.Serialize(value));Console.Out.Flush(); }catch{eof=true;} }
    void UpdateVisible() {
        if(offline)return;
        if(activated&&!userHidden&&!captureHidden&&!closed){if(!Visible)Show();}else Hide();
    }
    void State(Dictionary<string,object> s) {
        lastStateAt=Now();
        controlMode=Str(s,"controlMode","ai-only");lastActor=Str(s,"lastActor");controlNotes=(Bool(s,"externalInput")?"外部输入 / 未知":"")+(Str(s,"humanError").Length>0?" · "+Str(s,"humanError"):"");
        mode=Str(s,"mode","real");simulation=mode=="simulation";status=Str(s,"status","ready");hint=Str(s,"hint");
        held.Clear();foreach(var k in Items(s,"keys"))held.Add(Convert.ToString(k));
        buttons.Clear();foreach(var k in Items(s,"buttons"))buttons.Add(Convert.ToString(k));
        pulses.Clear();foreach(Dictionary<string,object> p in Items(s,"pulses"))pulses[Str(p,"id")]=Now()+(long)Math.Min(180,Num(p,"ms"));
        moveUntil=Now()+(long)Num(s,"moveMs");textUntil=Now()+(long)Num(s,"textMs");wheelUntil=Now()+(long)Num(s,"wheelMs");wheelDirection=(int)Num(s,"wheelDirection");
        activated=true;UpdateVisible();Invalidate();
    }
    void ReadLoop() {
        try {
            string line;
            while((line=Console.In.ReadLine())!=null) {
                if(line.Length>65536)throw new InvalidDataException("IPC line too large.");
                var d=new JavaScriptSerializer {MaxJsonLength=65536}.Deserialize<Dictionary<string,object>>(line);
                lock(inboxLock) {
                    if(Str(d,"kind")=="state")latest=d;
                    else {if(commands.Count>=64)throw new InvalidDataException("IPC control queue full.");commands.Enqueue(d);}
                }
            }
        }catch(Exception e){Report(e.Message);}finally{eof=true;}
    }
    void Drain() {
        if(eof){Finish();return;}
        // All capture-control commands run before a newly arrived display state.
        for(;;) {
            Dictionary<string,object> d;
            lock(inboxLock){if(commands.Count==0)break;d=commands.Dequeue();}
            var id=Str(d,"id");
            try {
                switch(Str(d,"kind")) {
                    case "capture":
                        captureHidden=Bool(d,"hidden");UpdateVisible();
                        if(captureHidden&&Visible)throw new InvalidOperationException("Overlay still visible.");
                        if(DwmFlush()!=0)throw new InvalidOperationException("Desktop composition did not confirm the visibility change.");
                        Send(new {kind="ack",id=id,ok=true,hidden=captureHidden});break;
                    case "style":
                        object raw;
                        if(!d.TryGetValue("style",out raw)||!(raw is Dictionary<string,object>))throw new InvalidDataException("Style payload missing.");
                        bool skinLoaded=ApplyStyle((Dictionary<string,object>)raw);
                        Send(new {kind="ack",id=id,ok=true,applied=true,layout=layout,skin=skin,skinLoaded=skinLoaded});break;
                    case "view":
                        // This process is the keyboard panel itself; only the
                        // desktop host can switch between a model and this view.
                        // `auto` asks for nothing, so it needs no warning.
                        if(Str(d,"view")=="auto")Send(new {kind="ack",id=id,ok=true,applied=true,view="auto"});
                        else Send(new {kind="ack",id=id,ok=true,applied=false,reason="The keyboard-only runtime cannot switch views."});
                        break;
                    case "shutdown":Send(new {kind="ack",id=id,ok=true});Finish();return;
                    default:throw new InvalidDataException("Unknown overlay command.");
                }
            }catch(Exception e){Send(new {kind="ack",id=id,ok=false,error=e.Message});}
        }
        Dictionary<string,object> update;
        lock(inboxLock){update=latest;latest=null;}
        if(update!=null)State(update);
    }
    void Finish(){if(closed)return;closed=true;Hide();Cleanup();Close();Application.ExitThread();}
    void Cleanup(){timer.Stop();if(tray!=null){tray.Visible=false;tray.Dispose();tray=null;}if(parent!=null){parent.Dispose();parent=null;}if(skinImage!=null){skinImage.Dispose();skinImage=null;}}
    protected override void OnMouseDown(MouseEventArgs e){base.OnMouseDown(e);if(adjusting&&e.Button==MouseButtons.Left){dragging=true;dragOrigin=Cursor.Position;windowOrigin=Location;Capture=true;}}
    protected override void OnMouseMove(MouseEventArgs e){base.OnMouseMove(e);if(dragging){var p=Cursor.Position;Location=new Point(windowOrigin.X+p.X-dragOrigin.X,windowOrigin.Y+p.Y-dragOrigin.Y);}}
    protected override void OnMouseUp(MouseEventArgs e){base.OnMouseUp(e);if(dragging){dragging=false;Capture=false;ApplySize(Dpi());SaveSettings();}}
    static Color Mix(Color a,Color b,double t){t=Math.Max(0,Math.Min(1,t));return Color.FromArgb((int)(a.R+(b.R-a.R)*t),(int)(a.G+(b.G-a.G)*t),(int)(a.B+(b.B-a.B)*t));}
    static GraphicsPath Rounded(RectangleF r,float rad){var p=new GraphicsPath();float d=rad*2;p.AddArc(r.X,r.Y,d,d,180,90);p.AddArc(r.Right-d,r.Y,d,d,270,90);p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90);p.AddArc(r.X,r.Bottom-d,d,d,90,90);p.CloseFigure();return p;}
    void Box(Graphics g,RectangleF r,Color fill,Color border){using(var p=Rounded(r,5))using(var b=new SolidBrush(fill))using(var pen=new Pen(border,1)){g.FillPath(b,p);g.DrawPath(pen,p);}}
    void Outline(Graphics g,RectangleF r,Color border){using(var p=Rounded(r,5))using(var pen=new Pen(border,1)){g.DrawPath(pen,p);}}
    void TextAt(Graphics g,string text,RectangleF r,float size,Color color,bool center=false,bool bold=false){using(var f=new Font("Microsoft YaHei UI",size,bold?FontStyle.Bold:FontStyle.Regular,GraphicsUnit.Pixel))using(var b=new SolidBrush(color))using(var sf=new StringFormat(StringFormat.GenericTypographic){Alignment=center?StringAlignment.Center:StringAlignment.Near,LineAlignment=StringAlignment.Center,Trimming=StringTrimming.EllipsisCharacter,FormatFlags=StringFormatFlags.NoWrap}){
            if(center){float measured=g.MeasureString(text,f,Int32.MaxValue,sf).Width;if(measured>r.Width-4)size=Math.Max(8,size*(r.Width-4)/measured);using(var fitted=new Font("Microsoft YaHei UI",size,bold?FontStyle.Bold:FontStyle.Regular,GraphicsUnit.Pixel))g.DrawString(text,fitted,b,r,sf);}
            else g.DrawString(text,f,b,r,sf);
        }}
    double Glow(string id){long t;return pulses.TryGetValue(id,out t)?Math.Max(0,(t-Now())/180.0):0;}
    /** Whether the current preset shows this key (directly, or as a generic modifier). */
    bool Displayed(string id) {
        if(visibleIds.Contains(id))return true;
        if(id=="ctrl")return visibleIds.Contains("lctrl")||visibleIds.Contains("rctrl");
        if(id=="shift")return visibleIds.Contains("lshift")||visibleIds.Contains("rshift");
        if(id=="alt")return visibleIds.Contains("lalt")||visibleIds.Contains("ralt");
        return false;
    }
    protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);DrawPanel(e.Graphics,ClientSize.Width,ClientSize.Height);}
    void DrawPanel(Graphics g,int width,int height) {
        g.Clear(surface);g.SmoothingMode=SmoothingMode.AntiAlias;g.ScaleTransform(width/canvasWidth,height/canvasHeight);g.TranslateTransform(-contentLeft,-contentTop);
        var accent=simulation?accentSim:accentReal;
        bool customSkin=skin=="custom"&&skinImage!=null;
        if(customSkin) {
            g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.PixelOffsetMode=PixelOffsetMode.Half;
            g.DrawImage(skinImage,new RectangleF(contentLeft,contentTop,canvasWidth,canvasHeight));
            // A light scrim keeps the highlights readable on any photo, and the
            // header/footer bands guarantee the text stays legible on a bright one.
            using(var scrim=new SolidBrush(Color.FromArgb(92,surface)))g.FillRectangle(scrim,contentLeft,contentTop,canvasWidth,canvasHeight);
            using(var band=new SolidBrush(Color.FromArgb(150,surface))){
                g.FillRectangle(band,contentLeft,contentTop,canvasWidth,55);
                g.FillRectangle(band,contentLeft,footerTop-4,canvasWidth,contentTop+canvasHeight-footerTop+4);
            }
        }
        TextAt(g,controlMode=="adaptive"?"控制输入":"AI INPUT",new RectangleF(contentLeft+20,contentTop+14,145,32),22,accent,false,true);
        TextAt(g,controlMode=="adaptive"?(lastActor=="human"?"人控制":lastActor=="ai"?"AI控制":"控制自适应模式"):simulation?"模拟预览 · 未操作电脑":"真实 AI 输入",new RectangleF(contentLeft+170,contentTop+16,360,28),17,ink);
        string stat=status=="locked"?"输入已锁定 · 需重新加载":status=="unknown"?"状态未知 / 释放未确认":status=="syncing"?"同步中 · 已恢复最新状态":status=="releasing"?"正在释放":"仅显示本插件的 AI 操作";
        if(controlMode=="adaptive"&&status=="ready")stat=(simulation?"模拟预览 · 非真实操作":controlNotes.Length>0?controlNotes:"最后识别的输入来源 · 不表示持续输入");
        float statusX=Math.Min(contentLeft+570,contentLeft+canvasWidth-20-448);
        TextAt(g,stat,new RectangleF(statusX,contentTop+16,448,28),14,(status=="unknown"||status=="locked")?Color.Salmon:muted);
        using(var pen=new Pen(keyEdge))g.DrawLine(pen,contentLeft+20,contentTop+55,contentLeft+canvasWidth-20,contentTop+55);
        foreach(var k in visible) {
            string id=Str(k,"id"),label=Str(k,"label");bool active=held.Contains(id);double glow=Glow("key:"+id);
            string generic=(id=="lctrl"||id=="rctrl")?"ctrl":(id=="lshift"||id=="rshift")?"shift":(id=="lalt"||id=="ralt")?"alt":"";
            bool ambiguous=generic!=""&&(held.Contains(generic)||Glow("key:"+generic)>0);
            var r=new RectangleF((float)Num(k,"x"),(float)Num(k,"y"),(float)Num(k,"w"),(float)Num(k,"h"));
            if(customSkin) {
                // The photo already shows the keys: only mark what the model did.
                if(active) { Box(g,r,Color.FromArgb(210,accent),accent);TextAt(g,label+(ambiguous?"*":""),r,label.Length>=5?10:label.Length>=4?11:14,surface,true,true); }
                else if(ambiguous) Outline(g,r,accent);
                else if(glow>0) Outline(g,r,Mix(accent,surface,1-glow*.6));
                continue;
            }
            var fill=active?accent:Mix(keyFill,accent,glow*.40);Box(g,r,fill,ambiguous?accent:keyEdge);
            TextAt(g,label+(ambiguous?"*":""),r,label.Length>=5?10:label.Length>=4?11:14,active?surface:id=="numenter"?muted:ink,true,active);
        }
        Box(g,new RectangleF(mouseX,mouseY,133,197),keyFill,keyEdge);
        foreach(var b in new[]{"left","right","middle"}) {
            var r=b=="left"?new RectangleF(mouseX+9,mouseY+9,48, 70):b=="right"?new RectangleF(mouseX+75,mouseY+9,48, 70):new RectangleF(mouseX+61,mouseY+23,10,40);
            bool active=buttons.Contains(b);
            if(customSkin&&!active&&Glow("button:"+b)<=0)continue;
            Box(g,r,active?accent:Mix(keyFill,accent,Glow("button:"+b)*.4),keyEdge);
            if(b!="middle")TextAt(g,b=="left"?"L":"R",r,18,active?surface:ink,true);
        }
        if(Now()<wheelUntil)TextAt(g,wheelDirection<0?"↓ 滚轮":"↑ 滚轮",new RectangleF(mouseX+7,mouseY+91,118,30),16,accent,true);
        TextAt(g,Now()<moveUntil?"↔ 移动":"MOUSE",new RectangleF(mouseX+7,mouseY+138,118,30),15,Now()<moveUntil?accent:muted,true);
        string footer=adjusting?"调整模式 · 拖动面板移动 · 从托盘退出调整":Now()<textUntil?"正在输入文本 · 内容不展示":String.Join(" + ",new List<string>(held).ToArray());
        if(held.Contains("ctrl")||held.Contains("shift")||held.Contains("alt"))footer+=" · * 通用修饰键未区分左右";
        // A key outside the current key-count preset is still reported in words:
        // a hidden key must never look like a key that was never pressed. The
        // generic Ctrl/Shift/Alt aliases are not keys of their own; they are drawn
        // as `*` on whichever sided key the preset still shows.
        var clipped=new List<string>();
        foreach(var id in held)if(!Displayed(id))clipped.Add(id);
        if(clipped.Count>0)footer+=(footer.Length>0?" · ":"")+"布局外按键："+String.Join(",",clipped.ToArray());
        if(footer.Length==0)footer="* Ctrl / Shift / Alt 通用键不区分左右 · 暗色小键盘 Enter 暂不支持独立发送";
        if(status=="locked")footer="输入安全锁定：请先确认按键已释放，再按宿主提示恢复或重新加载插件";
        if(status=="unknown")footer="连接或释放状态未知：亮键仅代表最后一次确认，不表示已安全释放";
        TextAt(g,footer,new RectangleF(contentLeft+20,footerTop,canvasWidth-40,25),13,(status=="unknown"||status=="locked")?Color.Salmon:muted);
        g.ResetTransform();
    }
    // Embedded mode is display-only; the WPF coordinator owns all visibility.
    public void Embed() { embedded=true; }
    public void EmbeddedState(string jsonState) { State(json.Deserialize<Dictionary<string,object>>(jsonState)); }
    public bool EmbeddedStyle(string jsonStyle) { return ApplyStyle(json.Deserialize<Dictionary<string,object>>(jsonStyle)); }
    public void EmbeddedAdjust(bool value) { adjusting=value;int ex=GetWindowLong(Handle,-20);SetWindowLong(Handle,-20,value?ex&~WS_EX_TRANSPARENT:ex|WS_EX_TRANSPARENT); }
    public void EmbeddedTick() { if(activated&&!simulation&&Now()-lastStateAt>1500)status="unknown";Invalidate(); }
    public static void Run(string layout,string settings,int parentPid) {
        try{if(SetThreadDpiAwarenessContext(new IntPtr(-4))==IntPtr.Zero)throw new InvalidOperationException("Per-monitor DPI awareness unavailable.");}
        catch(EntryPointNotFoundException){throw new InvalidOperationException("Per-monitor DPI awareness unavailable.");}
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        using(var form=new GamePlayerOverlay(layout,settings,parentPid,false)) {
            var handle=form.Handle;form.ApplySize(form.Dpi());uint value=0;
            try{form.affinity=SetWindowDisplayAffinity(handle,0x11)&&GetWindowDisplayAffinity(handle,out value)&&value==0x11;}catch{form.affinity=false;}
            form.MakeTray();form.timer.Start();
            new Thread(form.ReadLoop){IsBackground=true}.Start();
            form.Send(new {kind="ready",protocolVersion=2,renderer="keyboard",affinitySupported=form.affinity});
            Application.Run();
        }
    }
    // Offline visual QA renders our own controls only; it never captures desktop pixels.
    public static void Render(string layout,string output,string stateJson) { Render(layout,output,stateJson,null); }
    public static void Render(string layout,string output,string stateJson,string styleJson) {
        using(var form=new GamePlayerOverlay(layout,null,0,true)) {
            // The style decides the canvas size, so it must be applied before the
            // bitmap that receives the drawing exists.
            if(!String.IsNullOrEmpty(styleJson))form.ApplyStyle(form.json.Deserialize<Dictionary<string,object>>(styleJson));
            int width=(int)Math.Round(form.canvasWidth),height=(int)Math.Round(form.canvasHeight);
            using(var bitmap=new Bitmap(width,height))
            using(var g=Graphics.FromImage(bitmap)){
                form.State(form.json.Deserialize<Dictionary<string,object>>(stateJson));form.DrawPanel(g,width,height);bitmap.Save(output,ImageFormat.Png);
            }
        }
    }
}
