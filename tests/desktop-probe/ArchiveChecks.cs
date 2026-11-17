using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;
using GamePlayer.Desktop;
internal static class ArchiveChecks {
 public static void Run(Action<bool,string> check,Action<Action,string> reject,string root,byte[] png){
  string dir=Path.Combine(root,"archives");Directory.CreateDirectory(dir);
  byte[] moc=Encoding.ASCII.GetBytes("MOC3xxxx");
  string model="{\"Version\":3,\"FileReferences\":{\"Moc\":\"pet.moc3\",\"Textures\":[\"texture.png\"]}}";
  Dictionary<string,byte[]> Plain()=>new(){["pet.model3.json"]=Encoding.UTF8.GetBytes(model),["pet.moc3"]=moc,["texture.png"]=png};
  string Zip(string name,Dictionary<string,byte[]> entries,Action<ZipArchive>? extra=null){string file=Path.Combine(dir,name);using(var archive=new ZipArchive(File.Create(file),ZipArchiveMode.Create)){foreach(var item in entries){var entry=archive.CreateEntry(item.Key,CompressionLevel.NoCompression);using var output=entry.Open();output.Write(item.Value);}extra?.Invoke(archive);}return file;}
  string good=Zip("good.zip",Plain());var loaded=ModelPackage.Load(good);
  check(loaded.Assets.Count==2&&loaded.ModelPath==good,"ZIP loads only declared model bytes without extraction");
  check(!loaded.Manifest.ToJsonString().Contains(dir),"ZIP exposes opaque asset URLs, not filesystem/archive paths");
  check(ModelDiscovery.Discover(good).Single().error==null,"ZIP discovery validates one candidate before a renderer exists");
  check(loaded.SourceProof.Count==1,"A ZIP has one atomic resource stamp");
  check(!Directory.EnumerateDirectories(dir).Any(),"Runtime ZIP loading creates no extracted model directory");
  check(ModelSource.Crc(Encoding.ASCII.GetBytes("123456789"))==0xCBF43926,"CRC32 matches the canonical test vector");
  foreach(string bad in new[]{"../escape.json","/absolute.json","C:/drive.json","encoded%2f.json","a/../alias.json"}){var data=Plain();data[bad]=new byte[]{1};string file=Zip("unsafe-"+Guid.NewGuid()+".zip",data);reject(()=>ModelPackage.Load(file),"ZIP rejects unsafe member: "+bad);}
  string duplicate=Zip("duplicate.zip",Plain(),z=>{z.CreateEntry("texture.PNG");});reject(()=>ModelPackage.Load(duplicate),"Case-insensitive ZIP name collisions are rejected");
  string linked=Zip("linked.zip",Plain(),z=>{var e=z.CreateEntry("link.json");e.ExternalAttributes=unchecked((int)0xA1FF0000);using var s=e.Open();s.WriteByte(1);});reject(()=>ModelPackage.Load(linked),"ZIP symlink entries are rejected, including unused files");
  byte[] bytes=File.ReadAllBytes(good);int first=30+BitConverter.ToUInt16(bytes,26)+BitConverter.ToUInt16(bytes,28);bytes[first]^=1;string corrupt=Path.Combine(dir,"crc.zip");File.WriteAllBytes(corrupt,bytes);reject(()=>ModelPackage.Load(corrupt),"Required resource CRC corruption is rejected");
  bytes=File.ReadAllBytes(good);for(int i=0;i<bytes.Length-46;i++)if(BitConverter.ToUInt32(bytes,i)==0x02014b50){bytes[i+8]|=1;break;}string encrypted=Path.Combine(dir,"encrypted.zip");File.WriteAllBytes(encrypted,bytes);reject(()=>ModelPackage.Load(encrypted),"Encrypted ZIP flags are rejected before reading payloads");
  var multi=Plain();multi["another.model3.json"]=Encoding.UTF8.GetBytes(model);string multiple=Zip("multiple.zip",multi);check(ModelDiscovery.Discover(multiple).Count(x=>x.error==null)==2,"Generic ZIP enumerates multiple valid candidates");reject(()=>ModelPackage.Load(multiple),"Generic multi-model ZIP never chooses the first candidate");check(ModelPackage.Load(multiple,modelEntry:"another.model3.json").ModelEntry=="another.model3.json","An explicit current model entry can be loaded");reject(()=>ModelPackage.Load(multiple,modelEntry:"../escape.model3.json"),"Explicit model entry cannot escape its ZIP");
  var standard=new Dictionary<string,byte[]>();string a="包/A/";
  standard[a+"config.json"]=Encoding.UTF8.GetBytes("{\"mode\":1,\"standard\":{\"l2d\":true,\"hand\":"+new JsonArray(Enumerable.Range(0,90).Select(i=>(JsonNode)new JsonArray(i)).ToArray()).ToJsonString()+"},\"decoration\":{\"window_size\":[1400,1400],\"hand_offset\":[2,3]}}");
  foreach(var item in Plain())standard[a+"img/standard/cat_model/"+item.Key]=item.Value;
  standard[a+"config.json"]=Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(standard[a+"config.json"]).Replace("{\"mode\":1","{/* author comment, never code */\"mode\":1"));
  standard[a+"img/cat.model3.json"]=Encoding.UTF8.GetBytes("invalid backup JSON");
  standard[a+"img/keyboard/cat_model/demo.model3.json"]=Encoding.UTF8.GetBytes("invalid keyboard demonstration");
  for(int i=0;i<90;i++){standard[a+"img/standard/hand/"+i+".png"]=png;standard["包/Z-无按键显示/img/standard/hand/"+i+".png"]=png;standard["包/Z-有按键显示/img/standard/hand/"+i+".png"]=png;}
  string cat=Zip("standard.zip",standard);var candidates=ModelDiscovery.Discover(cat);check(candidates.Count==1&&candidates[0].entry.Contains("/standard/"),"Standard main model is recognized while broken backup/demo manifests are ignored");
  var model90=ModelPackage.Load(cat);check(model90.Manifest["hands"]!.AsArray().Count==90&&model90.Assets.Count==92,"Ninety author hand groups are admitted without the former 64-group limit");
  check(model90.Manifest["handStyles"]!.AsArray().Count==3,"Original/no-label/label author styles are discovered inside the same package");
  var labels=ModelPackage.Load(cat,localAdapter:new JsonObject{["handStyle"]="labels"});check(labels.Manifest["handStyle"]!.GetValue<string>()=="labels","Only the requested hand style is admitted");check(labels.Assets.Count==92,"Unselected style images are indexed but never loaded");
  check(model90.Manifest["layout"]!["handOffset"]![0]!.GetValue<double>()==2,"Decoration hand offsets are supported without overriding legacy standard offsets");
  string extracted=Path.Combine(dir,"directory-fixture");Directory.CreateDirectory(extracted);
  foreach(var item in standard){string target=Path.GetFullPath(Path.Combine(extracted,item.Key));if(!target.StartsWith(Path.GetFullPath(extracted)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Unsafe QA fixture path");Directory.CreateDirectory(Path.GetDirectoryName(target)!);File.WriteAllBytes(target,item.Value);}
  var directoryModel=ModelPackage.Load(extracted);string selected=Path.Combine(extracted,a,"img/standard/cat_model/pet.model3.json");var fileModel=ModelPackage.Load(selected);
  check(directoryModel.ModelKey==fileModel.ModelKey,"File/folder imports of the same physical model share one identity");check(fileModel.Manifest["hands"]!.AsArray().Count==90,"Direct standard model files retain package config and hand groups");
  standard.Remove(a+"img/standard/hand/89.png");string missing=Zip("missing-hand.zip",standard);var fallback=ModelPackage.Load(missing);check(fallback.Manifest["hands"]![89]!["image"]==null,"Missing hand image preserves its group and reports fallback instead of failing the base model");
  var tooMany=new JsonArray(Enumerable.Range(0,129).Select(i=>(JsonNode)new JsonArray(i)).ToArray());standard[a+"config.json"]=Encoding.UTF8.GetBytes("{\"mode\":1,\"standard\":{\"l2d\":true,\"hand\":"+tooMany.ToJsonString()+"}}");string huge=Zip("too-many-hands.zip",standard);reject(()=>ModelPackage.Load(huge),"More than 128 hand groups are rejected");
  check(ModelPackage.MaxAssets==256&&ModelPackage.MaxPixels==48L*1024*1024&&ModelPackage.MaxTotalBytes==160L*1024*1024,"Asset count expands without relaxing model texture or total byte budgets");
  check(ModelSource.MaxZipBytes==256L*1024*1024&&ModelSource.MaxExpandedBytes==512L*1024*1024,"Compressed and expanded ZIP budgets remain explicit");
 }
}
