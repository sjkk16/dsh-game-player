using GamePlayer.Desktop;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text;
try {
    int count=0;
    void Check(bool value,string name){if(!value)throw new Exception(name);Console.WriteLine("PASS "+name);count++;}
    if (OperatingSystem.IsWindows()) { Native.InitializeDpi(); Check(Native.AreDpiAwarenessContextsEqual(Native.GetThreadDpiAwarenessContext(), new IntPtr(-4)), "Framework-hosted native UI preserves PerMonitorV2 without the apphost manifest"); }
    CursorChecks.Run(Check);
    void Reject(Action action,string name){bool caught=false;try{action();}catch(InvalidDataException){caught=true;}Check(caught,name);}
    string root=Path.Combine(Path.GetTempPath(),"game-player-model-tests-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
    try {
        byte[] png=Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRYQAAAAASUVORK5CYII=");
        File.WriteAllBytes(Path.Combine(root,"texture.png"),png);File.WriteAllBytes(Path.Combine(root,"pet.moc3"),Encoding.ASCII.GetBytes("MOC3xxxx"));
        string manifest=Path.Combine(root,"pet.model3.json");
        string good="{\"Version\":3,\"FileReferences\":{\"Moc\":\"pet.moc3\",\"Textures\":[\"texture.png\"],\"Expressions\":[{\"File\":\"missing.exp3.json\"}],\"Motions\":{\"Idle\":[{\"File\":\"missing.motion3.json\",\"Sound\":\"secret.mp3\"}]}}}";
        File.WriteAllText(manifest,good,new UTF8Encoding(true));
        var p=ModelPackage.Load(root);Check(p.Assets.Count==2,"BOM accepted; optional motions, expressions and audio not imported");
        Check(!p.Manifest.ToJsonString().Contains(root),"No absolute paths exposed to renderer");
        string motionPath=Path.Combine(root,"wave.motion3.json");
        File.WriteAllText(motionPath,"{\"Version\":3,\"Meta\":{\"Duration\":1},\"Curves\":[]}");
        File.WriteAllText(manifest,good.Replace("missing.motion3.json","wave.motion3.json"));
        var withMotion=ModelPackage.Load(root);Check(withMotion.Assets.Count==3,"Declared local motion JSON is admitted without its audio");
        Check(withMotion.Manifest["motions"]![0]!["url"]!=null,"Motion catalog has a private asset URL");
        var again=ModelPackage.Load(root);Check(withMotion.Token!=again.Token&&withMotion.Manifest["signature"]!.GetValue<string>()==again.Manifest["signature"]!.GetValue<string>(),"Catalog signature survives renderer restarts");
        File.AppendAllText(motionPath," ");var changed=ModelPackage.Load(root);Check(changed.Manifest["signature"]!.GetValue<string>()!=again.Manifest["signature"]!.GetValue<string>(),"Motion resource changes invalidate the signature");
        File.WriteAllText(manifest,good.Replace("missing.motion3.json","../escape.motion3.json"));
        var unsafeMotion=ModelPackage.Load(root);Check(unsafeMotion.Assets.Count==2&&unsafeMotion.Manifest["motions"]![0]!["error"]!=null,"Unsafe optional motion is disabled without rejecting the base model");
        File.WriteAllText(manifest,good);
        Reject(()=>ModelPackage.SafePath(root,"../escape.png"),"Parent traversal rejected");
        Reject(()=>ModelPackage.SafePath(root,"https://example.com/a.png"),"Network references rejected");
        Reject(()=>ModelPackage.SafePath(root,"texture.png:stream"),"Alternate stream rejected");
        Reject(()=>ModelPackage.SafePath(root,"%2e%2e/escape.png"),"Encoded paths rejected");
        File.WriteAllText(manifest,good.Replace("texture.png","../escape.png"));Reject(()=>ModelPackage.Load(root),"Manifest resource traversal rejected");
        File.WriteAllText(manifest,good);File.WriteAllText(Path.Combine(root,"another.model3.json"),good);Reject(()=>ModelPackage.Load(root),"Ambiguous folder requires explicit model selection");File.Delete(Path.Combine(root,"another.model3.json"));
        File.WriteAllBytes(Path.Combine(root,"texture.png"),new byte[24]);Reject(()=>ModelPackage.Load(root),"Invalid PNG rejected");File.WriteAllBytes(Path.Combine(root,"texture.png"),png);
        var huge=png.ToArray();huge[16]=127;File.WriteAllBytes(Path.Combine(root,"texture.png"),huge);Reject(()=>ModelPackage.Load(root),"Oversized texture rejected");File.WriteAllBytes(Path.Combine(root,"texture.png"),png);
        string settingsFile=Path.Combine(root,"settings.json");File.WriteAllText(settingsFile,"{\"version\":2,\"view\":\"bongo\",\"widthDip\":680,\"opacity\":0.85,\"x\":-100,\"y\":5}");
        var s=OverlaySettings.Load(settingsFile);Check(s.View=="model"&&s.WidthDip==420&&s.X==-100&&s.Opacity==.85,"Legacy white-cat settings migrate without losing location/opacity");s.Save(settingsFile);
        Check(!File.ReadAllText(settingsFile).Contains("held"),"Settings contain no input state");
        string profile=Path.Combine(root,"adapter.json");File.WriteAllText(profile,"{\"version\":1,\"bindings\":{\"keyboard\":\"CustomPaw\"}}");
        p=ModelPackage.Load(root,profile);Check(p.Manifest["profile"]!["bindings"]!["keyboard"]!.GetValue<string>()=="CustomPaw","Adapter parameter mapping accepted");
        File.WriteAllText(profile,"{\"version\":1,\"bindings\":{\"execute\":\"evil\"}}");Reject(()=>ModelPackage.Load(root,profile),"Unknown adapter action rejected");
        ArchiveChecks.Run(Check,Reject,root,png);
    } finally {
        // Exact self-created temporary root, verified before recursive cleanup.
        if(Path.GetFullPath(root).StartsWith(Path.GetFullPath(Path.GetTempPath()),StringComparison.OrdinalIgnoreCase)&&Path.GetFileName(root).StartsWith("game-player-model-tests-"))Directory.Delete(root,true);
    }
    var start = new RendererStartupGate(); var now = DateTime.UtcNow;
    long ticket = start.Begin(now); start.Advance(ticket, "runtime");
    Check(start.Pending && start.CanContinue(ticket) && !start.Expired(now.AddSeconds(24)), "Renderer startup has its own 25-second budget");
    Check(start.Expired(now.AddSeconds(26)), "Renderer startup expires independently of model loading");
    start.Cancel(); Check(!start.CanContinue(ticket) && !start.Pending, "Timeout/cancel rejects a late renderer continuation");
    long next = start.Begin(now); start.Advance(ticket, "page"); Check(start.Stage == "storage" && start.CanContinue(next), "Old startup ticket cannot update the replacement stage");
    start.Advance(next, "page"); start.Complete(); Check(!start.Pending && !start.Expired(now.AddHours(1)), "web-ready ends the startup budget before model validation");
    var valid = Environment.GetEnvironmentVariable("DSH_PROBE_VALID_LINK"); var broken = Environment.GetEnvironmentVariable("DSH_PROBE_BROKEN_LINK");
    var expected = Environment.GetEnvironmentVariable("DSH_PROBE_LINK_TARGET");
    if(valid != null && broken != null && expected != null) {
        string physical = DesktopStorage.EnsureDirectory(valid);
        Check(string.Equals(physical, expected, StringComparison.OrdinalIgnoreCase), "Valid data junction resolves to its physical target");
        bool rejected = false; try { DesktopStorage.EnsureDirectory(broken); } catch(IOException) { rejected = true; }
        Check(rejected && !Directory.Exists(Path.Combine(Path.GetDirectoryName(broken)!, "missing-target")), "Broken junction is rejected without recreating an unknown target");
        var cache = DesktopStorage.PrepareCache(valid);
        Check(cache.Root.StartsWith(expected + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && File.GetAttributes(cache.Directory).HasFlag(FileAttributes.Directory), "Private cache is created within the resolved data directory");
        Check(Directory.GetFiles(cache.Directory).Length == 0, "Cache write probe is removed before launching WebView2");
        Directory.Delete(cache.Directory);
        string blocked = Path.Combine(expected, "not-a-directory"); File.WriteAllText(blocked, "block");
        rejected = false; try { DesktopStorage.PrepareCache(blocked); } catch(IOException) { rejected = true; }
        Check(rejected, "File/storage collision fails before WebView2 initialization");
        rejected = false; try { DesktopStorage.PrepareCache(Path.Combine(blocked, "child")); } catch(IOException) { rejected = true; }
        Check(rejected, "Inaccessible cache parent fails before creating a renderer");
    }
    if(args.Length>0){var model=ModelPackage.Load(args[0]);Check(model.Assets.Count>2,"Supplied Deepseek package admitted read-only");Console.WriteLine(model.Manifest.ToJsonString(new JsonSerializerOptions{WriteIndented=true}));}
    Console.WriteLine($"{count} package/settings checks passed. This is NOT a Core load or render test.");return 0;
} catch(Exception e){Console.Error.WriteLine(e);return 1;}
