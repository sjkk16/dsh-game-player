param([string]$Root)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.dll,System.Core.dll,System.Drawing.dll -Path (Join-Path $Root 'src/capture-native.cs')
$checks=0
function Check($condition,$message){if(-not $condition){throw $message};$script:checks++}
# Compare against the old interpreter's exact sampling and rounding, using generated pixels only.
foreach($size in @(@(17,13),@(64,36),@(193,107),@(1920,1080))){
 $bitmap=New-Object System.Drawing.Bitmap $size[0],$size[1]
 $graphics=[Drawing.Graphics]::FromImage($bitmap);$graphics.Clear([Drawing.Color]::FromArgb(31,97,173));$brush=New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(220,57,9));$graphics.FillRectangle($brush,3,7,($size[0]/2),($size[1]/3));$graphics.Dispose();$brush.Dispose()
 try{
  $samples=New-Object 'double[]' 2304
  for($y=0;$y -lt 36;$y++){for($x=0;$x -lt 64;$x++){$sx=[Math]::Min($bitmap.Width-1,[int]($x*$bitmap.Width/64));$sy=[Math]::Min($bitmap.Height-1,[int]($y*$bitmap.Height/36));$c=$bitmap.GetPixel($sx,$sy);$samples[$y*64+$x]=$c.R*.299+$c.G*.587+$c.B*.114}}
  $result=[GamePlayerCapture]::Fingerprint($bitmap,$null)
  for($i=0;$i -lt $samples.Length;$i++){Check ($samples[$i] -eq $result.samples[$i]) 'Fingerprint sampling changed'}
  Check ($result.score -eq -1) 'First frame must be unknown';Check (([GamePlayerCapture]::Fingerprint($bitmap,$samples)).score -eq 0) 'Unchanged frame score'
  $mean=0.0;foreach($v in $samples){$mean+=$v};$mean/=$samples.Length;$variance=0.0;foreach($v in $samples){$variance+=($v-$mean)*($v-$mean)};$variance=[Math]::Round($variance/$samples.Length,2)
  Check ($variance -eq $result.variance) 'Variance rounding changed'
 }finally{$bitmap.Dispose()}
}
@{ok=$true;checks=$checks;screenCaptured=$false;inputInjected=$false}|ConvertTo-Json -Compress
