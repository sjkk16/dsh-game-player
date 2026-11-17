# Offline native compilation and UI rendering. No screenshots, focus or input.
param([string]$OutputDirectory=(Join-Path $PSScriptRoot '..\.qa'))
$ErrorActionPreference='Stop'
$source=Join-Path $PSScriptRoot '..\src'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
Add-Type -Path @((Join-Path $source 'native-platform.cs'),(Join-Path $source 'native.cs'),(Join-Path $source 'window-native.cs'),(Join-Path $source 'ledger-target.cs'),(Join-Path $source 'input-observation.cs'))
'Native input C# compilation passed'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Web.Extensions
Add-Type -Path (Join-Path $source 'overlay-window.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions
'Overlay C# compilation passed'

# Force a blocked stdout writer and prove telemetry producers remain bounded.
Add-Type -TypeDefinition @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
public static class OverlayQueueProbe {
    sealed class Sink : TextWriter {
        public readonly ManualResetEvent Entered=new ManualResetEvent(false), Release=new ManualResetEvent(false);
        public readonly List<string> Lines=new List<string>();
        public override Encoding Encoding { get { return Encoding.UTF8; } }
        public override void WriteLine(string text) { Entered.Set(); Release.WaitOne(); lock(Lines)Lines.Add(text); }
        public bool HasLast() { lock(Lines)return Lines.Exists(s=>s.Contains("\"n\":9999")); }
    }
    public static void Run(Type output) {
        var saved=Console.Out;var sink=new Sink();
        MethodInfo start=output.GetMethod("Start"), send=output.GetMethod("Event"), reply=output.GetMethod("Reply"), stop=output.GetMethod("Stop");
        try {
            Console.SetOut(sink);start.Invoke(null,null);send.Invoke(null,new object[]{"{\"n\":0}"});
            if(!sink.Entered.WaitOne(2000))throw new Exception("Writer never entered sink.");
            for(int i=1;i<10000;i++)send.Invoke(null,new object[]{"{\"n\":"+i+"}"});
            var q=(ICollection)output.GetField("events",BindingFlags.NonPublic|BindingFlags.Static).GetValue(null);
            if(q.Count>128)throw new Exception("Observer queue is not bounded.");
            sink.Release.Set();
            for(int i=0;i<200&&!sink.HasLast();i++)Thread.Sleep(10);
            if(!sink.HasLast())throw new Exception("Latest observation was lost.");
            reply.Invoke(null,new object[]{"{\"reply\":true}"});
            var json=new JavaScriptSerializer();bool resync=false;
            lock(sink.Lines)foreach(var line in sink.Lines){json.DeserializeObject(line);if(line.Contains("\"resync\":true"))resync=true;}
            if(!resync)throw new Exception("Overflow did not mark resynchronization.");
        } finally { sink.Release.Set();stop.Invoke(null,null);Console.SetOut(saved); }
    }
}
'@ -ReferencedAssemblies System.Web.Extensions
[OverlayQueueProbe]::Run([GamePlayerOutput])
'Bounded observer queue and serialized NDJSON writer passed under backpressure'

$layout=Join-Path $source 'overlay-layout.json'
$state=@{mode='simulation';status='ready';keys=@('w','lshift','space');buttons=@('left');pulses=@();moveMs=180;wheelMs=180;wheelDirection=1;textMs=0;hint=''}
[GamePlayerOverlay]::Render($layout,(Join-Path $OutputDirectory 'overlay-simulation.png'),($state|ConvertTo-Json -Compress))
$state.mode='real';$state.keys=@('ctrl','ralt','num7');$state.buttons=@('right');$state.wheelDirection=-1
[GamePlayerOverlay]::Render($layout,(Join-Path $OutputDirectory 'overlay-real.png'),($state|ConvertTo-Json -Compress))
$state.status='unknown'
[GamePlayerOverlay]::Render($layout,(Join-Path $OutputDirectory 'overlay-warning.png'),($state|ConvertTo-Json -Compress))
'Offline panel renders passed (not desktop captures)'

# ---------------------------------------------------------------------------
# Appearance matrix: three themes, three key-count presets and a user image.
# These renders go through the same DrawPanel as the live panel, so a wrong
# palette, canvas or image path is visible here without a desktop capture.
# ---------------------------------------------------------------------------
$real=@{mode='real';status='ready';keys=@('ctrl','a','num7');buttons=@('left');pulses=@();moveMs=0;wheelMs=0;wheelDirection=0;textMs=0;hint=''}
$realJson=$real|ConvertTo-Json -Compress
$palette=@{background='#111722';text='#E6EDF6';muted='#8795A9';keyFill='#1F2937';keyEdge='#39475A';accent='#49DFBE';accentSim='#FFB753'}
$lightPalette=@{background='#F2F5FA';text='#1B2430';muted='#5B6B80';keyFill='#FFFFFF';keyEdge='#C8D2E0';accent='#0B62C4';accentSim='#B45F00'}
$contrastPalette=@{background='#000000';text='#FFFFFF';muted='#D0D8E4';keyFill='#101014';keyEdge='#E0E6F0';accent='#D6FF66';accentSim='#FFD400'}
$rosePalette=$palette.Clone();$rosePalette.accent='#FF7A9A'
$light=@{theme='light';accent='sky';layout='full';skin='builtin';colors=$lightPalette}|ConvertTo-Json -Compress -Depth 4
$contrast=@{theme='contrast';accent='lime';layout='full';skin='builtin';colors=$contrastPalette}|ConvertTo-Json -Compress -Depth 4
$tkl=@{theme='dark';accent='teal';layout='tkl';skin='builtin';colors=$palette}|ConvertTo-Json -Compress -Depth 4
$compact=@{theme='dark';accent='teal';layout='compact';skin='builtin';colors=$palette}|ConvertTo-Json -Compress -Depth 4

# A synthetic keyboard image proves the skin path without shipping any asset.
$skinImage=Join-Path $OutputDirectory 'keyboard-skin-test.png'
Add-Type -AssemblyName System.Drawing
$canvas=New-Object System.Drawing.Bitmap 1040,364
$paint=[System.Drawing.Graphics]::FromImage($canvas)
$paint.Clear([System.Drawing.Color]::FromArgb(255,0,255))
$paint.Dispose();$canvas.Save($skinImage,[System.Drawing.Imaging.ImageFormat]::Png);$canvas.Dispose()
$custom=@{theme='dark';accent='rose';layout='full';skin='custom';skinPath=$skinImage;colors=$rosePalette}|ConvertTo-Json -Compress -Depth 4

[GamePlayerOverlay]::Render($layout,(Join-Path $OutputDirectory 'overlay-theme-light.png'),$realJson,$light)
[GamePlayerOverlay]::Render($layout,(Join-Path $OutputDirectory 'overlay-theme-contrast.png'),$realJson,$contrast)
[GamePlayerOverlay]::Render($layout,(Join-Path $OutputDirectory 'overlay-layout-tkl.png'),$realJson,$tkl)
[GamePlayerOverlay]::Render($layout,(Join-Path $OutputDirectory 'overlay-layout-compact.png'),$realJson,$compact)
[GamePlayerOverlay]::Render($layout,(Join-Path $OutputDirectory 'overlay-skin-custom.png'),$realJson,$custom)

function Corner([string]$path) {
    $bitmap=[System.Drawing.Bitmap]::FromFile($path)
    try { return $bitmap.GetPixel(2,2) } finally { $bitmap.Dispose() }
}
function SizeOf([string]$path) {
    $bitmap=[System.Drawing.Bitmap]::FromFile($path)
    try { return "$($bitmap.Width)x$($bitmap.Height)" } finally { $bitmap.Dispose() }
}
function Assert-True([bool]$condition,[string]$message) {
    if(-not $condition) { throw "Appearance render check failed: $message" }
}

$dark=Corner (Join-Path $OutputDirectory 'overlay-real.png')
$lightPixel=Corner (Join-Path $OutputDirectory 'overlay-theme-light.png')
$contrastPixel=Corner (Join-Path $OutputDirectory 'overlay-theme-contrast.png')
# Sample the image area away from the header band and from any drawn highlight.
$skinBitmap=[System.Drawing.Bitmap]::FromFile((Join-Path $OutputDirectory 'overlay-skin-custom.png'))
try { $skinPixel=$skinBitmap.GetPixel(500,250) } finally { $skinBitmap.Dispose() }
Assert-True ($dark.ToArgb() -eq ([System.Drawing.Color]::FromArgb(17,23,34)).ToArgb()) 'the default panel keeps the dark background'
Assert-True ($lightPixel.GetBrightness() -gt 0.8) 'the light theme paints a light background'
Assert-True ($contrastPixel.GetBrightness() -lt 0.05) 'the high-contrast theme paints black'
Assert-True ($lightPixel.ToArgb() -ne $dark.ToArgb()) 'themes must differ at the same pixel'
# Magenta under the 36% legibility scrim: red and blue stay high, green stays low.
Assert-True ($skinPixel.R -gt 120 -and $skinPixel.B -gt 120 -and $skinPixel.G -lt 90) 'the custom keyboard image is drawn'
Assert-True ((SizeOf (Join-Path $OutputDirectory 'overlay-real.png')) -eq '1040x364') 'full-size canvas is unchanged'
Assert-True ((SizeOf (Join-Path $OutputDirectory 'overlay-layout-tkl.png')) -eq '880x364') 'the 87-key preset removes the number pad'
# The 65-key preset keeps the arrow cluster, so it is only shorter, not narrower.
Assert-True ((SizeOf (Join-Path $OutputDirectory 'overlay-layout-compact.png')) -eq '880x318') 'the 65-key preset removes the function row and number pad'
'Offline appearance renders passed (three themes, three key counts, custom image)'
