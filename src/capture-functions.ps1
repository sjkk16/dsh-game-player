function Int-Field($value, [string]$label, [long]$minimum, [long]$maximum) {
    if ($null -eq $value -or $value -is [bool] -or $value -is [string] -or $value -is [array]) { throw "$label must be a finite integer." }
    $n = [double]$value
    if ([double]::IsNaN($n) -or [double]::IsInfinity($n) -or $n -ne [Math]::Truncate($n) -or $n -lt $minimum -or $n -gt $maximum) { throw "$label must be a finite integer between $minimum and $maximum." }
    return [long]$n
}
function Default-Field($value, $fallback) { if ($null -eq $value) { return $fallback }; return $value }
function Get-MonitorBounds([string]$monitor) {
    if ($monitor -eq 'virtual') {
        return @{ x=[GamePlayerNative]::Metrics(76); y=[GamePlayerNative]::Metrics(77); w=[GamePlayerNative]::Metrics(78); h=[GamePlayerNative]::Metrics(79) }
    }
    if ($monitor -ne 'primary') { throw "monitor must be primary or virtual." }
    return @{ x=0; y=0; w=[GamePlayerNative]::Metrics(0); h=[GamePlayerNative]::Metrics(1) }
}
function Get-ChangeScore($bitmap, [string]$consumer, [string]$geometry) {
    $previous = $null
    $entry = $script:PreviousFrames[$consumer]
    if ($null -ne $entry -and $entry.geometry -eq $geometry) { $previous = $entry.frame }
    if ($script:PreviousFrames.Count -ge 128 -and -not $script:PreviousFrames.ContainsKey($consumer)) { $script:PreviousFrames.Clear() }

    $result = [GamePlayerCapture]::Fingerprint($bitmap, $previous)
    $script:PreviousFrames[$consumer] = @{ geometry = $geometry; frame = $result.samples }
    return @{ score = $result.score; variance = $result.variance }

}

function Capture-Frame($request) {
    if ($Watchdog) { throw 'Release watchdog cannot capture frames.' }
    $clock = [Diagnostics.Stopwatch]::StartNew(); $stages = @{}; $last = 0.0
    $monitor = [string](Default-Field $request.target (Default-Field $request.monitor 'primary'))
    if ($monitor -eq 'window') {
        $target = [GamePlayerWindow]::Get([string]$request.windowId)
        [GamePlayerWindow]::Ready($target)
        $bounds = @{x=$target.client.x; y=$target.client.y; w=$target.client.width; h=$target.client.height}
    } else { $bounds = Get-MonitorBounds $monitor }
    if ($Recording -and $null -ne $request.mockBounds) {
        $b = $request.mockBounds
        $bounds = @{ x=(Int-Field $b.x 'x' -2147483648 2147483647); y=(Int-Field $b.y 'y' -2147483648 2147483647); w=(Int-Field $b.w 'w' 1 7680); h=(Int-Field $b.h 'h' 1 4320) }
    }
    if ($null -ne $request.region) {
        $r = $request.region
        $rx=Int-Field $r.x 'region.x' 0 2147483647; $ry=Int-Field $r.y 'region.y' 0 2147483647
        $rw=Int-Field $r.width 'region.width' 1 2147483647; $rh=Int-Field $r.height 'region.height' 1 2147483647
        if ($rx+$rw -gt $bounds.w -or $ry+$rh -gt $bounds.h) { throw 'Region outside capture target.' }
        $bounds=@{x=($bounds.x+$rx); y=($bounds.y+$ry); w=$rw; h=$rh}
    }
    $desktop=Get-MonitorBounds 'virtual'
    if ($bounds.x -lt $desktop.x -or $bounds.y -lt $desktop.y -or [long]$bounds.x+$bounds.w -gt [long]$desktop.x+$desktop.w -or [long]$bounds.y+$bounds.h -gt [long]$desktop.y+$desktop.h) { throw 'Capture target outside virtual desktop.' }
    $maxWidth = Int-Field (Default-Field $request.maxWidth 1280) 'maxWidth' 320 2560
    $quality = Int-Field (Default-Field $request.quality 60) 'quality' 20 95
    $consumer = [string](Default-Field $request.consumerId 'screen:default')
    if ($consumer.Length -gt 256) { throw 'consumerId is too long.' }
    $full = $null; $output = $null; $graphics = $null; $stream = $null; $parameters = $null
    try {
        $full = New-Object System.Drawing.Bitmap ([int]$bounds.w), ([int]$bounds.h)
        $graphics = [System.Drawing.Graphics]::FromImage($full)
        if ($Recording) {
            $gray = Int-Field (Default-Field $request.mockGray 64) 'mockGray' 0 255
            $graphics.Clear([System.Drawing.Color]::FromArgb([int]$gray,[int]$gray,[int]$gray))
            if($null -ne $request.mockPatch){
                $p=$request.mockPatch; $pg=Int-Field $p.gray 'patch.gray' 0 255
                $px=Int-Field $p.x 'patch.x' -2147483648 2147483647; $py=Int-Field $p.y 'patch.y' -2147483648 2147483647
                $pw=Int-Field $p.width 'patch.width' 1 7680; $ph=Int-Field $p.height 'patch.height' 1 4320
                $brush=New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb([int]$pg,[int]$pg,[int]$pg))
                try{$graphics.FillRectangle($brush,[single]($px-$bounds.x),[single]($py-$bounds.y),[single]$pw,[single]$ph)}finally{$brush.Dispose()}
            }
        } else { [GamePlayerNative]::EnsureDpi(); $graphics.CopyFromScreen([int]$bounds.x,[int]$bounds.y,0,0,$full.Size) }
        $graphics.Dispose(); $graphics = $null
        if($monitor -eq 'window') {
            $after=[GamePlayerWindow]::Get([string]$request.windowId); [GamePlayerWindow]::Ready($after)
            if($after.client.x -ne $target.client.x -or $after.client.y -ne $target.client.y -or $after.client.width -ne $target.client.width -or $after.client.height -ne $target.client.height){throw 'Window geometry changed during capture.'}
        }
        $stages.captureMs = $clock.Elapsed.TotalMilliseconds; $last = $stages.captureMs
        $scale = [Math]::Min(1.0, $maxWidth / $bounds.w)
        $outWidth = [int][Math]::Round($bounds.w * $scale)
        $outHeight = [Math]::Max(1, [int][Math]::Round($bounds.h * $scale))
        $geometry = "$monitor/$($request.windowId)/$($bounds.x)/$($bounds.y)/$($bounds.w)/$($bounds.h)"
        $change = Get-ChangeScore $full $consumer $geometry
        $stages.fingerprintMs = $clock.Elapsed.TotalMilliseconds - $last; $last = $clock.Elapsed.TotalMilliseconds
        # Omitted internal policy preserves legacy callers that always need encoded data.
        $encode = $request.skipUnchanged -ne $true -or $request.forceImage -eq $true -or $change.score -lt 0 -or $change.score -ge 0.03
        $format = [string](Default-Field $request.format 'jpeg')
        if ($format -notin @('jpeg','png')) { throw 'format must be jpeg or png.' }
        $bytes = $null; $data = $null
        if ($encode) {
            $image = $full
            if ($outWidth -ne $full.Width -or $outHeight -ne $full.Height) {
                $output = New-Object System.Drawing.Bitmap $outWidth, $outHeight
                $graphics = [System.Drawing.Graphics]::FromImage($output)
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.DrawImage($full, 0, 0, $outWidth, $outHeight)
                $graphics.Dispose(); $graphics = $null; $image = $output
            }
            $stages.resizeMs = $clock.Elapsed.TotalMilliseconds - $last; $last = $clock.Elapsed.TotalMilliseconds
            $stream = New-Object System.IO.MemoryStream
            if ($format -eq 'png') { $image.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png) }
            else {
                $parameters = New-Object System.Drawing.Imaging.EncoderParameters 1
                $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([int64]$quality)
                $image.Save($stream,[GamePlayerCapture]::Jpeg,$parameters)
            }
            $bytes = $stream.ToArray()
            $stages.encodeMs = $clock.Elapsed.TotalMilliseconds - $last; $last = $clock.Elapsed.TotalMilliseconds
            $data = [Convert]::ToBase64String($bytes)
            $stages.base64Ms = $clock.Elapsed.TotalMilliseconds - $last
        } else { $stages.resizeMs=0; $stages.encodeMs=0; $stages.base64Ms=0 }
        $cursor = [GamePlayerNative]::Cursor()
        return @{
            ok=$true; data=$data; bytes=$(if($null -eq $bytes){0}else{$bytes.Length}); timings=$stages; encoded=$encode
            width=$outWidth; height=$outHeight; mediaType=$(if($format -eq 'png'){'image/png'}else{'image/jpeg'})
            screenWidth=[int]$bounds.w; screenHeight=[int]$bounds.h; screenX=[int]$bounds.x; screenY=[int]$bounds.y
            scale=$scale; cursor=@{x=$cursor.X;y=$cursor.Y}; foreground=[GamePlayerNative]::ForegroundTitle()
            cursorInImage=@{ x=[int][Math]::Round(($cursor.X-$bounds.x)*$outWidth/$bounds.w); y=[int][Math]::Round(($cursor.Y-$bounds.y)*$outHeight/$bounds.h) }
            diff=$change.score; variance=$change.variance; black=($change.variance -lt 6)
        }
    } finally {
        foreach ($resource in @($parameters,$stream,$graphics,$output,$full)) { if ($null -ne $resource) { $resource.Dispose() } }
    }
}
