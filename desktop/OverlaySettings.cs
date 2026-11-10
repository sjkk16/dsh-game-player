#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GamePlayer.Desktop;
public sealed class OverlaySettings {
    public int Version { get; set; }=4;
    public long Revision { get; set; }=0;
    public string View { get; set; }="model";
    public string? ModelPath { get; set; }
    public string? ProfilePath { get; set; }
    public string? ModelEntry { get; set; }
    public JsonObject ModelOverrides { get; set; }=new();
    /** Locally imported keyboard image, copied next to this file by the tray import. */
    public string? KeyboardImage { get; set; }
    public double WidthDip { get; set; }=420;
    public double KeyboardWidthDip { get; set; }=900;
    public double Opacity { get; set; }=1;
    public int? X { get; set; }
    public int? Y { get; set; }
    static readonly JsonSerializerOptions Options=new(){PropertyNamingPolicy=JsonNamingPolicy.CamelCase,PropertyNameCaseInsensitive=true};
    public static OverlaySettings Load(string path) {
        if(!File.Exists(path))return new();
        if(new FileInfo(path).Length>65536)throw new InvalidDataException("Settings too large.");
        var json=File.ReadAllText(path);var s=JsonSerializer.Deserialize<OverlaySettings>(json,Options)??new();
        // Migration retains location and opacity, not the unfinished white-cat size.
        if(s.View=="bongo"||JsonNode.Parse(json)?["version"]?.GetValue<int>()<3){s.View=s.View=="keyboard"?"keyboard":"model";s.KeyboardWidthDip=s.WidthDip;s.WidthDip=420;}
        if(s.View!="keyboard")s.View="model";
        s.Version=4;s.WidthDip=Clamp(s.WidthDip,220,1000,420);s.KeyboardWidthDip=Clamp(s.KeyboardWidthDip,450,1350,900);s.Opacity=Clamp(s.Opacity,.45,1,1);return s;
    }
    public static OverlaySettings FromJson(string json) {
        var s=JsonSerializer.Deserialize<OverlaySettings>(json,Options)??throw new InvalidDataException("Invalid preferences.");
        if(!double.IsFinite(s.WidthDip)||s.WidthDip<220||s.WidthDip>1000||!double.IsFinite(s.KeyboardWidthDip)||s.KeyboardWidthDip<450||s.KeyboardWidthDip>1350||!double.IsFinite(s.Opacity)||s.Opacity<.45||s.Opacity>1)throw new InvalidDataException("Preferences outside display limits.");
        if(s.View!="model"&&s.View!="keyboard")throw new InvalidDataException("Invalid saved view.");
        if(s.X is int x&&Math.Abs((long)x)>1000000||s.Y is int y&&Math.Abs((long)y)>1000000)throw new InvalidDataException("Invalid display position.");
        s.Version=4;return s;
    }
    static double Clamp(double x,double min,double max,double fallback)=>double.IsFinite(x)?Math.Clamp(x,min,max):fallback;
    public void Save(string path) {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);string temp=path+"."+Environment.ProcessId+".tmp";
        try{File.WriteAllText(temp,JsonSerializer.Serialize(this,Options));File.Move(temp,path,true);}finally{if(File.Exists(temp))File.Delete(temp);}
    }
}
