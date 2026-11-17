#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Cryptography;
namespace GamePlayer.Desktop;
// Immutable admitted bytes. Only these opaque URLs are served to the private WebView.
public sealed class ModelPackage {
    public const int MaxAssets=256,MaxTexture=8192;
    public const long MaxTotalBytes=160L*1024*1024,MaxAssetBytes=32L*1024*1024,MaxPixels=48L*1024*1024;
    public string Root { get; private set; }="";
    public string ModelPath { get; private set; }="";
    public string SourcePath { get; private set; }="";
    public string ModelEntry { get; private set; }="";
    public string ModelKey { get; private set; }="";
    public string? ProfilePath { get; private set; }
    public string Token { get; }=Guid.NewGuid().ToString("N");
    public Dictionary<string,Asset> Assets { get; }=new(StringComparer.Ordinal);
    public JsonObject Manifest { get; private set; }=new();
    public JsonArray SourceProof { get; }=new();
    public sealed record Asset(byte[] Data,string Mime);
    readonly Dictionary<string,string> imported=new(StringComparer.OrdinalIgnoreCase);
    readonly HashSet<string> proofPaths=new(StringComparer.OrdinalIgnoreCase);
    long total,pixels;
    public static string SafePath(string root,string relative) {
        if(string.IsNullOrWhiteSpace(relative)||Path.IsPathRooted(relative)||relative.IndexOfAny(new[]{':','%','?','#','\0'})>=0)throw new InvalidDataException("Invalid local resource path.");
        string full=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar)));
        if(!full.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Resource escapes selected model directory.");
        ModelSource.RejectLinks(full);return full;
    }
    void Proof(ModelSource s,string name) {
        string file=s.IsZip?s.SourcePath:SafePath(s.Root,name);
        if(!proofPaths.Add(file))return;var f=new FileInfo(file);
        SourceProof.Add(new JsonObject{["path"]=file,["size"]=f.Length,["mtime"]=f.LastWriteTimeUtc.Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture)});
    }
    string Add(ModelSource s,string name,string extension,bool hand=false) {
        name=ModelSource.Normalize(name);if(imported.TryGetValue(name,out var old))return old;
        string ext=Path.GetExtension(name).ToLowerInvariant();if(ext!=extension||!new[]{".png",".moc3",".json"}.Contains(ext))throw new InvalidDataException("Unsupported resource format: "+ext);
        byte[] data=s.Read(name,ext==".json"?1024*1024:MaxAssetBytes);
        if(total+data.Length>MaxTotalBytes||Assets.Count>=MaxAssets)throw new InvalidDataException("Model resource budget exceeded.");
        if(ext==".png") {
            var (w,h)=Png(data);long area=(long)w*h;
            if(hand?area>16L*1024*1024:pixels+area>MaxPixels)throw new InvalidDataException("Texture dimensions/budget exceeded.");
            if(!hand)pixels+=area;
        }
        if(ext==".moc3"&&(data.Length<8||Encoding.ASCII.GetString(data,0,4)!="MOC3"))throw new InvalidDataException("Invalid MOC3 header.");
        if(ext==".json") {using var r=new StreamReader(new MemoryStream(data),Encoding.UTF8,true);string text=r.ReadToEnd();using(JsonDocument.Parse(text,new JsonDocumentOptions{MaxDepth=32})){}data=Encoding.UTF8.GetBytes(text);}
        Proof(s,name);string id="/model/"+Token+"/"+Assets.Count+ext;Assets.Add(id,new(data,ext==".png"?"image/png":ext==".json"?"application/json":"application/octet-stream"));imported[name]=id;total+=data.Length;return id;
    }
    public static (int W,int H) Png(byte[] data) {
        if(data.Length<24||!data.Take(8).SequenceEqual(new byte[]{137,80,78,71,13,10,26,10}))throw new InvalidDataException("Invalid PNG.");
        int w=System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(16,4)),h=System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(20,4));
        if(w<1||h<1||w>MaxTexture||h>MaxTexture)throw new InvalidDataException("Texture dimensions/budget exceeded.");return(w,h);
    }
    public static ModelPackage Load(string selection,string? profilePath=null,string? modelEntry=null,JsonObject? localAdapter=null,JsonObject? overrides=null,bool explicitProfile=false,JsonObject? watermarks=null) {
        using var source=ModelSource.Open(selection);string entry;
        if(modelEntry!=null) {entry=ModelSource.Normalize(modelEntry,false);if(!entry.EndsWith(".model3.json",StringComparison.OrdinalIgnoreCase)||!source.Exists(entry)||source.SelectedFile!=null&&!entry.Equals(source.SelectedFile,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Invalid model entry.");}
        else if(source.SelectedFile!=null)entry=source.SelectedFile;
        else {var matches=ModelDiscovery.From(source).Where(x=>x.error==null).ToArray();if(matches.Length!=1)throw new InvalidDataException("Select one .model3.json: model package contains "+matches.Length+" valid candidates.");entry=matches[0].entry;}
        var p=new ModelPackage{Root=source.Root,SourcePath=source.SourcePath,ModelEntry=entry,ModelKey=ModelDiscovery.Identity(source,entry),ModelPath=source.IsZip?source.SourcePath:Path.GetFullPath(Path.Combine(source.Root,entry)),ProfilePath=profilePath};
        localAdapter??=overrides?[p.ModelKey] as JsonObject;
        if(!explicitProfile&&localAdapter?.ContainsKey("profilePath")==true){profilePath=localAdapter["profilePath"]?.GetValue<string>();p.ProfilePath=profilePath;}
        var model=source.Json(entry);p.Proof(source,entry);
        if(model["Version"]?.GetValue<int>()!=3)throw new InvalidDataException("Unsupported model manifest version.");
        var refs=model["FileReferences"] as JsonObject??throw new InvalidDataException("Missing model references.");string dir=ModelDiscovery.DirectoryOf(entry);
        var textures=refs["Textures"] as JsonArray??throw new InvalidDataException("Missing textures.");if(textures.Count<1||textures.Count>8)throw new InvalidDataException("Expected 1–8 textures.");
        var textureUrls=new JsonArray();foreach(var t in textures)textureUrls.Add(p.Add(source,source.Resolve(dir,t!.GetValue<string>()),".png"));
        string moc=p.Add(source,source.Resolve(dir,refs["Moc"]!.GetValue<string>()),".moc3");
        string mocHash=Convert.ToHexString(SHA256.HashData(p.Assets[moc].Data)).ToLowerInvariant();
        var profile=new JsonObject{["bindings"]=new JsonObject(),["invertY"]=false};
        if(profilePath!=null) {
            ModelSource.RejectLinks(profilePath);if(new FileInfo(profilePath).Length>1024*1024)throw new InvalidDataException("Adapter JSON exceeds 1 MiB.");
            var supplied=JsonNode.Parse(File.ReadAllText(profilePath),documentOptions:new JsonDocumentOptions{MaxDepth=32}) as JsonObject??throw new InvalidDataException("Expected adapter object.");
            if(supplied["version"]?.GetValue<int>()!=1)throw new InvalidDataException("Adapter profile version must be 1.");
            if(supplied["bindings"] is JsonObject map)foreach(var pair in map){if(!new[]{"keyboard","mouseX","mouseY","left","right","middle","wheel"}.Contains(pair.Key))throw new InvalidDataException("Unknown adapter action.");if(pair.Value is JsonValue v&&v.TryGetValue<string>(out var id)&&id.Length>0&&id.Length<=128)profile["bindings"]![pair.Key]=id;else throw new InvalidDataException("Invalid adapter parameter ID.");}
            if(supplied["invertY"]!=null)profile["invertY"]=supplied["invertY"]!.GetValue<bool>();
            var f=new FileInfo(profilePath);p.SourceProof.Add(new JsonObject{["path"]=f.FullName,["size"]=f.Length,["mtime"]=f.LastWriteTimeUtc.Ticks.ToString()});
        }
        string? standard=ModelDiscovery.StandardRoot(source,entry);JsonObject? config=standard==null?null:source.Json(ModelDiscovery.Prefix(standard)+"config.json",true);
        if(standard!=null)p.Proof(source,ModelDiscovery.Prefix(standard)+"config.json");
        var warnings=new JsonArray();var styles=new JsonArray{new JsonObject{["id"]="default",["name"]="Original"}};
        string handDir=standard==null?"":ModelDiscovery.Prefix(standard)+"img/standard/hand";
        var styleDirs=new Dictionary<string,string>{{"default",handDir}};
        if(standard!=null) {
            string family=ModelDiscovery.DirectoryOf(standard);
            foreach(var style in new[]{("no-labels","无按键显示"),("labels","有按键显示")}) {
                var dirs=source.Names.Where(n=>ModelDiscovery.Within(n,family)&&n.Contains(style.Item2,StringComparison.Ordinal)&&n.EndsWith("/img/standard/hand/0.png",StringComparison.OrdinalIgnoreCase)).Select(ModelDiscovery.DirectoryOf).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                if(dirs.Length==1){styleDirs[style.Item1]=dirs[0];styles.Add(new JsonObject{["id"]=style.Item1,["name"]=style.Item2});}
            }
        }
        string selectedStyle=localAdapter?["handStyle"]?.GetValue<string>()??"default";
        if(!styleDirs.TryGetValue(selectedStyle,out string? selectedHandDir)){warnings.Add("Selected hand style is unavailable; using original.");selectedStyle="default";selectedHandDir=handDir;}
        var hands=new JsonArray();
        if(config?["standard"]?["hand"] is JsonArray groups) {
            if(groups.Count>128)throw new InvalidDataException("Too many hand groups (maximum 128).");
            for(int i=0;i<groups.Count;i++) {
                if(groups[i] is not JsonArray codes||codes.Count<1||codes.Count>8)throw new InvalidDataException("Invalid hand key group.");
                foreach(var code in codes)if(code==null||code.GetValue<int>()<0||code.GetValue<int>()>255)throw new InvalidDataException("Invalid virtual key code.");
                var h=new JsonObject{["codes"]=codes.DeepClone(),["index"]=i};string file=selectedHandDir+"/"+i+".png";
                try{if(!source.Exists(file))throw new FileNotFoundException("Hand image missing.");string url=p.Add(source,file,".png",true);var (w,hh)=Png(p.Assets[url].Data);h["image"]=url;h["width"]=w;h["height"]=hh;}
                catch(Exception e) when(e is IOException||e is InvalidDataException||e is UnauthorizedAccessException||e is ArgumentException){h["image"]=null;h["error"]="Hand image unavailable; preserving model hand.";warnings.Add("Hand "+i+" unavailable.");}
                hands.Add(h);
            }
        }
        var motions=new JsonArray();if(refs["Motions"] is JsonObject motionGroups){int i=0;foreach(var group in motionGroups){if(group.Value is not JsonArray entries)continue;foreach(var item in entries){if(i>=64)break;string? file=item?["File"]?.GetValue<string>();string name=file==null?"Unnamed":Path.GetFileName(file).Replace(".motion3.json","",StringComparison.OrdinalIgnoreCase);var record=new JsonObject{["id"]="motion-"+i++,["name"]=name.Substring(0,Math.Min(48,name.Length))};try{if(file==null||!file.EndsWith(".motion3.json",StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Expected .motion3.json");record["url"]=p.Add(source,source.Resolve(dir,file),".json");foreach(string fade in new[]{"FadeInTime","FadeOutTime"})if(item?[fade]!=null){double value=item[fade]!.GetValue<double>();if(!double.IsFinite(value)||value<0||value>10)throw new InvalidDataException("Invalid motion fade.");record[fade]=value;}}catch(Exception e) when(e is IOException||e is InvalidDataException||e is UnauthorizedAccessException||e is InvalidOperationException||e is JsonException||e is ArgumentException){record.Remove("url");record["error"]="Invalid or unavailable local motion resource";}motions.Add(record);}if(i>=64)break;}}
        string? Optional(string key){if(refs[key] is not JsonValue v||!v.TryGetValue<string>(out var file))return null;try{return p.Add(source,source.Resolve(dir,file),".json");}catch(Exception e) when(e is IOException||e is InvalidDataException||e is UnauthorizedAccessException||e is JsonException||e is ArgumentException){warnings.Add(key+" unavailable.");return null;}}
        var labels=new JsonObject();if(refs["DisplayInfo"] is JsonValue info&&info.TryGetValue<string>(out var infoFile)){try{var cdi=source.Json(source.Resolve(dir,infoFile));p.Proof(source,source.Resolve(dir,infoFile));if(cdi["Parameters"] is JsonArray ps)foreach(var item in ps.Take(512)){string? id=item?["Id"]?.GetValue<string>(),name=item?["Name"]?.GetValue<string>();if(id!=null&&name!=null&&id.Length<=128)labels[id]=name.Substring(0,Math.Min(64,name.Length));}}catch(Exception e) when(e is IOException||e is InvalidDataException||e is InvalidOperationException||e is JsonException||e is ArgumentException){warnings.Add("DisplayInfo unavailable; showing Core IDs.");}}
        var decoration=config?["decoration"] as JsonObject;
        double scale=decoration?["l2d_correct"]?.GetValue<double>()??2;if(!double.IsFinite(scale)||scale<=0||scale>8)throw new InvalidDataException("Invalid model scale.");
        var size=Pair(decoration?["window_size"],1024,1024);if(size[0]!.GetValue<double>()<64||size[1]!.GetValue<double>()<64)throw new InvalidDataException("Invalid reference canvas.");
        var authorLayout=new JsonObject();if(model["Layout"] is JsonObject layout)foreach(var item in layout){if(!new[]{"width","height","x","y","center_x","center_y","top","bottom","left","right"}.Contains(item.Key))continue;double value=item.Value!.GetValue<double>();if(!double.IsFinite(value)||Math.Abs(value)>8192||new[]{"width","height"}.Contains(item.Key)&&value<=0)throw new InvalidDataException("Invalid author layout.");authorLayout[item.Key]=value;}
        p.Manifest=new JsonObject{["name"]=source.IsZip?Path.GetFileNameWithoutExtension(source.SourcePath):Path.GetFileNameWithoutExtension(entry),["moc"]=moc,["mocHash"]=mocHash,["watermarkPreference"]=watermarks?[p.ModelKey]?.DeepClone(),["textures"]=textureUrls,["physics"]=Optional("Physics"),["pose"]=Optional("Pose"),["profile"]=profile,["adapterOverride"]=localAdapter?.DeepClone(),["labels"]=labels,["groups"]=model["Groups"]?.DeepClone(),["hands"]=hands,["handStyles"]=styles,["handStyle"]=selectedStyle,["motions"]=motions,["warnings"]=warnings,["authorLayout"]=authorLayout,["layout"]=new JsonObject{["size"]=size,["offset"]=Pair(decoration?["l2d_offset"],0,0),["handOffset"]=Pair(config?["standard"]?["hand_offset"]??decoration?["hand_offset"],0,0),["scale"]=scale/2,["flip"]=decoration?["l2d_horizontal_flip"]?.GetValue<bool>()??false,["autoFrame"]=decoration?["l2d_auto_frame"]?.GetValue<bool>()??true}};
        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);hash.AppendData(Encoding.UTF8.GetBytes(p.Manifest.ToJsonString().Replace(p.Token,"MODEL")));foreach(var asset in p.Assets.Values){hash.AppendData(BitConverter.GetBytes(asset.Data.Length));hash.AppendData(asset.Data);}p.Manifest["signature"]=Convert.ToHexString(hash.GetHashAndReset());return p;
    }
    static JsonArray Pair(JsonNode? node,double a,double b){if(node==null)return new(a,b);if(node is not JsonArray arr||arr.Count!=2)throw new InvalidDataException("Expected layout pair.");double x=arr[0]!.GetValue<double>(),y=arr[1]!.GetValue<double>();if(!double.IsFinite(x)||!double.IsFinite(y)||Math.Abs(x)>8192||Math.Abs(y)>8192)throw new InvalidDataException("Invalid layout values.");return new(x,y);}
}
