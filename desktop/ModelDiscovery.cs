#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
namespace GamePlayer.Desktop;
public sealed record ModelCandidate(string sourcePath,string entry,string name,string? error,string fingerprint,string modelKey);
public static class ModelDiscovery {
    public static string DirectoryOf(string name){int i=name.LastIndexOf('/');return i<0?"":name.Substring(0,i);}
    public static string Identity(ModelSource source,string entry) {
        string value=source.IsZip?source.SourcePath.ToLowerInvariant()+"\0"+entry.ToLowerInvariant():Path.GetFullPath(Path.Combine(source.Root,entry.Replace('/',Path.DirectorySeparatorChar))).ToLowerInvariant();
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    }
    public static List<ModelCandidate> Discover(string selection) {
        using var source=ModelSource.Open(selection);var result=From(source);
        if(!source.IsZip&&source.SelectedFile==null) {
            foreach(var zip in source.Names.Where(x=>x.EndsWith(".zip",StringComparison.OrdinalIgnoreCase))) {
                if(result.Count>=64)throw new InvalidDataException("Too many model candidates.");
                string file=ModelPackage.SafePath(source.Root,zip);
                try { using var nested=ModelSource.Open(file);result.AddRange(From(nested)); }
                catch(Exception e) when(e is IOException||e is InvalidDataException||e is InvalidOperationException||e is System.Text.Json.JsonException||e is UnauthorizedAccessException) {
                    result.Add(new(file,"",Path.GetFileNameWithoutExtension(file),e.Message.Substring(0,Math.Min(e.Message.Length,160)),"",""));
                }
            }
        }
        if(result.Count>64)throw new InvalidDataException("Too many model candidates.");return result;
    }
    public static List<ModelCandidate> From(ModelSource source) {
        var models=source.Names.Where(x=>x.EndsWith(".model3.json",StringComparison.OrdinalIgnoreCase)).ToList();
        if(source.SelectedFile!=null)models=new(){source.SelectedFile};
        else {
            var standardRoots=new List<string>();
            foreach(var config in source.Names.Where(x=>x.Equals("config.json",StringComparison.OrdinalIgnoreCase)||x.EndsWith("/config.json",StringComparison.OrdinalIgnoreCase))) {
                try {var c=source.Json(config,true);if(c["mode"]?.GetValue<int>()==1&&c["standard"]?["l2d"]?.GetValue<bool>()==true)standardRoots.Add(DirectoryOf(config));}catch(Exception e) when(e is IOException||e is InvalidDataException||e is InvalidOperationException||e is System.Text.Json.JsonException) { }
            }
            models=models.Where(m=>!standardRoots.Any(r=>Within(m,r)&&!m.StartsWith(Prefix(r)+"img/standard/cat_model/",StringComparison.OrdinalIgnoreCase))).ToList();
        }
        if(models.Count>64)throw new InvalidDataException("Too many model candidates.");var result=new List<ModelCandidate>();
        foreach(string entry in models) {
            string? error=null;string fingerprint="";
            try {
                var bytes=source.Read(entry,1024*1024);var model=source.Json(entry);var refs=model["FileReferences"] as JsonObject??throw new InvalidDataException("Missing model references.");
                if(model["Version"]?.GetValue<int>()!=3)throw new InvalidDataException("Unsupported model manifest version.");
                string dir=DirectoryOf(entry),moc=source.Resolve(dir,refs["Moc"]!.GetValue<string>());
                if(!moc.EndsWith(".moc3",StringComparison.OrdinalIgnoreCase)||!source.Exists(moc))throw new InvalidDataException("Required MOC3 resource is missing.");
                var textures=refs["Textures"] as JsonArray??throw new InvalidDataException("Missing textures.");
                if(textures.Count<1||textures.Count>8)throw new InvalidDataException("Expected 1–8 textures.");
                foreach(var tex in textures){string t=source.Resolve(dir,tex!.GetValue<string>());if(!t.EndsWith(".png",StringComparison.OrdinalIgnoreCase)||!source.Exists(t))throw new InvalidDataException("Required PNG texture is missing.");}
                var f=new FileInfo(source.IsZip?source.SourcePath:ModelPackage.SafePath(source.Root,entry));
                fingerprint=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Convert.ToHexString(SHA256.HashData(bytes))+":"+f.Length+":"+f.LastWriteTimeUtc.Ticks)));
            } catch(Exception e) when(e is IOException||e is InvalidDataException||e is InvalidOperationException||e is System.Text.Json.JsonException||e is ArgumentException||e is NullReferenceException) { error=e.Message.Substring(0,Math.Min(e.Message.Length,160)); }
            string label=source.IsZip?Path.GetFileNameWithoutExtension(source.SourcePath):Path.GetFileNameWithoutExtension(entry);
            result.Add(new(source.SourcePath,entry,label,error,fingerprint,Identity(source,entry)));
        }
        return result;
    }
    public static string Prefix(string dir)=>string.IsNullOrEmpty(dir)?"":dir+"/";
    public static bool Within(string file,string dir)=>string.IsNullOrEmpty(dir)||file.StartsWith(dir+"/",StringComparison.OrdinalIgnoreCase);
    public static string? StandardRoot(ModelSource source,string entry) {
        string current=DirectoryOf(entry);
        for(int i=0;i<4;i++) {
            string config=Prefix(current)+"config.json";
            if(source.Exists(config)) {
                try {var c=source.Json(config,true);if(c["mode"]?.GetValue<int>()==1&&c["standard"]?["l2d"]?.GetValue<bool>()==true&&entry.StartsWith(Prefix(current)+"img/standard/cat_model/",StringComparison.OrdinalIgnoreCase))return current;}catch(Exception e) when(e is IOException||e is InvalidDataException||e is InvalidOperationException||e is System.Text.Json.JsonException) { }
            }
            if(current=="")break;current=DirectoryOf(current);
        }
        return null;
    }
}
