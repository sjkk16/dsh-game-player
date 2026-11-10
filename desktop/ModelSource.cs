#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
namespace GamePlayer.Desktop;
// A virtual, bounded package: ZIP bytes never become filesystem paths or executable content.
public sealed class ModelSource : IDisposable {
    public const long MaxZipBytes=256L*1024*1024, MaxExpandedBytes=512L*1024*1024;
    public string SourcePath { get; }
    public string Root { get; }
    public bool IsZip => archive!=null;
    public string? SelectedFile { get; }
    readonly FileStream? stream;
    readonly ZipArchive? archive;
    readonly Dictionary<string,ZipArchiveEntry> zipped=new(StringComparer.OrdinalIgnoreCase);
    public List<string> Names { get; }=new();
    ModelSource(string selection) {
        SourcePath=Path.GetFullPath(selection);RejectLinks(SourcePath);
        if(SourcePath.EndsWith(".zip",StringComparison.OrdinalIgnoreCase)) {
            Root="";stream=new FileStream(SourcePath,FileMode.Open,FileAccess.Read,FileShare.Read);
            try {
                if(stream.Length<22||stream.Length>MaxZipBytes)throw new InvalidDataException("ZIP size exceeds 256 MiB or is invalid.");
                archive=new ZipArchive(stream,ZipArchiveMode.Read,true);
                ValidateRecords(stream,archive);
                if(archive.Entries.Count>4096)throw new InvalidDataException("ZIP exceeds 4096 entries.");
                long expanded=0;var all=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach(var e in archive.Entries) {
                    var name=Normalize(e.FullName.TrimEnd('/'),false);
                    if(!all.Add(name))throw new InvalidDataException("ZIP contains conflicting names.");
                    int mode=(e.ExternalAttributes>>16)&0xF000;
                    if(mode==0xA000||(e.ExternalAttributes&0x400)!=0)throw new InvalidDataException("Linked ZIP resources are not allowed.");
                    if(e.Length<0||e.Length>MaxExpandedBytes||expanded>MaxExpandedBytes-e.Length)throw new InvalidDataException("ZIP expands beyond 512 MiB.");
                    expanded+=e.Length;
                    if(e.FullName.EndsWith('/'))continue;
                    zipped.Add(name,e);Names.Add(name);
                }
            } catch { archive?.Dispose();stream.Dispose();throw; }
        } else {
            bool directory=Directory.Exists(SourcePath);
            Root=directory?SourcePath:Path.GetDirectoryName(SourcePath)!;
            // A direct standard model file needs its own config and hand images, not its siblings' resources.
            if(!directory) {
                if(!SourcePath.EndsWith(".model3.json",StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Select .model3.json, ZIP, or a model folder.");
                string marker=Path.Combine("img","standard","cat_model");
                if(Root.EndsWith(marker,StringComparison.OrdinalIgnoreCase)) {
                    string candidate=Directory.GetParent(Directory.GetParent(Directory.GetParent(Root)!.FullName)!.FullName)!.FullName;
                    string config=Path.Combine(candidate,"config.json");
                    if(File.Exists(config))Root=candidate;
                }
                SelectedFile=Path.GetRelativePath(Root,SourcePath).Replace('\\','/');
            }
            var dirs=new Queue<(string,int)>();dirs.Enqueue((Root,0));int entries=0;
            while(dirs.Count>0) {
                var (dir,depth)=dirs.Dequeue();
                foreach(var file in Directory.EnumerateFileSystemEntries(dir)) {
                    if(++entries>2048)throw new InvalidDataException("Too many model directory entries.");
                    var attr=File.GetAttributes(file);if((attr&FileAttributes.ReparsePoint)!=0)continue;
                    if((attr&FileAttributes.Directory)!=0){if(depth<8)dirs.Enqueue((file,depth+1));}
                    else Names.Add(Path.GetRelativePath(Root,file).Replace('\\','/'));
                }
            }
        }
        Names.Sort(StringComparer.OrdinalIgnoreCase);
    }
    public static ModelSource Open(string path)=>new(path);
    public static void RejectLinks(string path) {
        for(string? p=Path.GetFullPath(path);p!=null;p=Path.GetDirectoryName(p))
            if((File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException("Linked model resources are not allowed.");
    }
    public static string Normalize(string relative,bool allowParent=true) {
        if(string.IsNullOrWhiteSpace(relative)||relative.Length>4096||relative[0]=='/'||relative[0]=='\\'||relative.IndexOfAny(new[]{':','%','?','#','\0'})>=0)throw new InvalidDataException("Invalid local resource path.");
        var parts=new List<string>();
        foreach(var part in relative.Replace('\\','/').Split('/')) {
            if(part==""||part==".")continue;
            if(part=="..") {if(!allowParent||parts.Count==0)throw new InvalidDataException("Resource escapes selected model directory.");parts.RemoveAt(parts.Count-1);}
            else {if(part.Length>255)throw new InvalidDataException("Resource name too long.");parts.Add(part);}
        }
        if(parts.Count==0||parts.Count>16)throw new InvalidDataException("Invalid resource depth.");return string.Join('/',parts);
    }
    public string Resolve(string directory,string relative) {
        // Validate the reference separately before combining, so an absolute reference cannot be hidden.
        if(string.IsNullOrWhiteSpace(relative)||relative[0]=='/'||relative[0]=='\\'||relative.IndexOfAny(new[]{':','%','?','#','\0'})>=0)throw new InvalidDataException("External resource rejected.");
        return Normalize(string.IsNullOrEmpty(directory)?relative:directory+"/"+relative);
    }
    public bool Exists(string name) {
        name=Normalize(name);if(IsZip)return zipped.ContainsKey(name);string file=Path.Combine(Root,name);if(!File.Exists(file))return false;ModelPackage.SafePath(Root,name);return true;
    }
    public byte[] Read(string name,long limit=ModelPackage.MaxAssetBytes) {
        name=Normalize(name);long size;Stream input;
        if(IsZip) {
            if(!zipped.TryGetValue(name,out var e))throw new FileNotFoundException("Local ZIP resource missing: "+name);
            size=e.Length;if(size<=0||size>limit)throw new InvalidDataException("Resource size budget exceeded.");input=e.Open();
            using(input){var bytes=ReadExactly(input,(int)size);if(Crc(bytes)!=e.Crc32)throw new InvalidDataException("ZIP resource CRC mismatch: "+name);return bytes;}
        }
        var file=ModelPackage.SafePath(Root,name);using var handle=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read);
        size=handle.Length;if(size<=0||size>limit)throw new InvalidDataException("Resource size budget exceeded.");return ReadExactly(handle,(int)size);
    }
    static byte[] ReadExactly(Stream input,int size){var b=new byte[size];input.ReadExactly(b);if(input.ReadByte()!=-1)throw new InvalidDataException("Resource changed or has invalid length.");return b;}
    public JsonObject Json(string name,bool compatibleConfig=false) {
        var data=Read(name,1024*1024);using var r=new StreamReader(new MemoryStream(data),Encoding.UTF8,true);
        return JsonNode.Parse(r.ReadToEnd(),documentOptions:new JsonDocumentOptions{MaxDepth=32,CommentHandling=compatibleConfig?JsonCommentHandling.Skip:JsonCommentHandling.Disallow,AllowTrailingCommas=compatibleConfig}) as JsonObject??throw new InvalidDataException("Expected JSON object.");
    }
    public static uint Crc(byte[] bytes) {uint c=uint.MaxValue;foreach(byte b in bytes)c=crc[(c^b)&255]^(c>>8);return ~c;}
    static readonly uint[] crc=BuildCrc();
    static uint[] BuildCrc(){var a=new uint[256];for(uint i=0;i<256;i++){uint c=i;for(int j=0;j<8;j++)c=(c&1)!=0?0xEDB88320^(c>>1):c>>1;a[i]=c;}return a;}
    static void ValidateRecords(FileStream s,ZipArchive z) {
        using var r=new BinaryReader(s,Encoding.UTF8,true);
        int tailSize=(int)Math.Min(65557,s.Length);s.Position=s.Length-tailSize;byte[] tail=r.ReadBytes(tailSize);int at=-1;
        for(int i=tail.Length-22;i>=0;i--)if(BitConverter.ToUInt32(tail,i)==0x06054b50&&i+22+BitConverter.ToUInt16(tail,i+20)==tail.Length){at=i;break;}
        if(at<0)throw new InvalidDataException("Invalid ZIP end record.");
        long end=s.Length-tailSize+at;ushort count=BitConverter.ToUInt16(tail,at+10);
        if(BitConverter.ToUInt16(tail,at+4)!=0||BitConverter.ToUInt16(tail,at+6)!=0||BitConverter.ToUInt16(tail,at+8)!=count)throw new InvalidDataException("Split ZIP archives are not supported.");
        long central=BitConverter.ToUInt32(tail,at+16), centralSize=BitConverter.ToUInt32(tail,at+12), entries=count;
        if(count==65535||central==uint.MaxValue||centralSize==uint.MaxValue) {
            if(end<20)throw new InvalidDataException("Invalid ZIP64 locator.");s.Position=end-20;
            if(r.ReadUInt32()!=0x07064b50||r.ReadUInt32()!=0)throw new InvalidDataException("Invalid ZIP64 locator.");long pos=r.ReadInt64();if(r.ReadUInt32()!=1||pos<0||pos>s.Length-56)throw new InvalidDataException("Split/invalid ZIP64 archive.");s.Position=pos;
            if(r.ReadUInt32()!=0x06064b50||r.ReadInt64()<44)throw new InvalidDataException("Invalid ZIP64 record.");r.ReadUInt16();r.ReadUInt16();if(r.ReadUInt32()!=0||r.ReadUInt32()!=0)throw new InvalidDataException("Split ZIP64 archive.");long disk=r.ReadInt64();entries=r.ReadInt64();centralSize=r.ReadInt64();central=r.ReadInt64();if(disk!=entries)throw new InvalidDataException("Split ZIP64 archive.");
        }
        if(entries<0||entries>4096||entries!=z.Entries.Count||central<0||centralSize<0||central>s.Length-centralSize)throw new InvalidDataException("Invalid/budget-exceeding ZIP directory.");
        s.Position=central;
        for(int i=0;i<entries;i++) {
            if(s.Position>central+centralSize-46||r.ReadUInt32()!=0x02014b50)throw new InvalidDataException("Invalid ZIP directory entry.");
            r.ReadUInt16();r.ReadUInt16();ushort flags=r.ReadUInt16(),method=r.ReadUInt16();r.ReadUInt16();r.ReadUInt16();uint expected=r.ReadUInt32();r.ReadUInt32();r.ReadUInt32();
            ushort name=r.ReadUInt16(),extra=r.ReadUInt16(),comment=r.ReadUInt16(),disk=r.ReadUInt16();r.ReadUInt16();r.ReadUInt32();r.ReadUInt32();
            if((flags&(1|64|8192))!=0)throw new InvalidDataException("Encrypted ZIP archives are not supported.");
            if(method!=0&&method!=8||disk!=0||expected!=z.Entries[i].Crc32)throw new InvalidDataException("Unsupported/split/corrupt ZIP entry.");
            long next=s.Position+name+extra+comment;if(next>central+centralSize)throw new InvalidDataException("Truncated ZIP entry.");s.Position=next;
        }
    }
    public void Dispose(){archive?.Dispose();stream?.Dispose();}
}
