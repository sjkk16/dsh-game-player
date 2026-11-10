# Worker and independent release watchdog. stdout is exclusively UTF-8 NDJSON.
param(
    [string]$Session = '', [int]$ParentPid = 0,
    [switch]$Watchdog, [switch]$Recording, [string]$RecordingLog = '', [switch]$ObserveInput
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
Add-Type -AssemblyName System.Drawing
Add-Type -Path @((Join-Path $PSScriptRoot 'native.cs'), (Join-Path $PSScriptRoot 'window-native.cs'), (Join-Path $PSScriptRoot 'ledger-target.cs'), (Join-Path $PSScriptRoot 'input-observation.cs'))
if ($Session -eq '') { $Session = 'Local\game-player-' + [guid]::NewGuid().ToString('N') }
[InputSession]::Initialize($Session, $ParentPid, $Watchdog.IsPresent, $Recording.IsPresent, $RecordingLog, $ObserveInput.IsPresent)
$script:RequestId = $null
$script:ExecutingInput = $false
$script:PreviousFrames = @{}
$keyMap = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'key-map.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$script:KeyTable = @{}
$script:KeyNames = @{}
foreach ($property in $keyMap.keys.PSObject.Properties) {
    $script:KeyTable[$property.Name] = [int]$property.Value
    $script:KeyNames[[int]$property.Value] = $property.Name
}
$script:Aliases = @{}
foreach ($property in $keyMap.aliases.PSObject.Properties) { $script:Aliases[$property.Name] = $property.Value }
$script:ExtendedKeys = @(0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x28,0x2C,0x2D,0x2E,0x5B,0x5C,0x5D,0x6F,0x90,0xA3,0xA5)
$script:Buttons = @{
    left = @{ code=0; down=2; up=4 }; right = @{ code=1; down=8; up=16 }; middle = @{ code=2; down=32; up=64 }
}
function Held-State {
    return @{
        heldKeys = @([InputSession]::Held(1) | ForEach-Object { $script:KeyNames[[int]$_] })
        heldButtons = @([InputSession]::Held(2) | ForEach-Object { @('left','right','middle')[[int]$_] })
        state = [InputSession]::State()
    }
}
function Release-All([int]$ownerId = 0) {
    $released = [InputSession]::Cancel($ownerId)
    $value = Held-State
    $value['released'] = $released
    $value['ok'] = $true
    return $value
}
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

    # 64x36 grayscale fingerprint of the frame; returns the mean absolute
    # difference against the previous frame as a 0..1 fraction.
    $w = 64; $h = 36
    $current = New-Object 'double[]' ($w * $h)
    for ($y = 0; $y -lt $h; $y++) {
        for ($x = 0; $x -lt $w; $x++) {
            $sx = [int]($x * $bitmap.Width / $w)
            $sy = [int]($y * $bitmap.Height / $h)
            if ($sx -ge $bitmap.Width) { $sx = $bitmap.Width - 1 }
            if ($sy -ge $bitmap.Height) { $sy = $bitmap.Height - 1 }
            $c = $bitmap.GetPixel($sx, $sy)
            $current[$y * $w + $x] = ($c.R * 0.299 + $c.G * 0.587 + $c.B * 0.114)
        }
    }
    $variance = 0.0
    $mean = 0.0
    foreach ($v in $current) { $mean += $v }
    $mean = $mean / $current.Length
    foreach ($v in $current) { $variance += ($v - $mean) * ($v - $mean) }
    $variance = $variance / $current.Length
    $score = -1.0
    if ($null -ne $previous) {
        $total = 0.0
        for ($i = 0; $i -lt $current.Length; $i++) {
            $total += [Math]::Abs($current[$i] - $previous[$i])
        }
        $score = [Math]::Round(($total / ($current.Length * 255.0)), 4)
    }
    $script:PreviousFrames[$consumer] = @{ geometry = $geometry; frame = $current }
    return @{ score = $score; variance = [Math]::Round($variance, 2) }
}

function Capture-Frame($request) {
    if ($Watchdog) { throw 'Release watchdog cannot capture frames.' }
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
        $scale = [Math]::Min(1.0, $maxWidth / $bounds.w)
        $outWidth = [int][Math]::Round($bounds.w * $scale)
        $outHeight = [Math]::Max(1, [int][Math]::Round($bounds.h * $scale))
        $geometry = "$monitor/$($request.windowId)/$($bounds.x)/$($bounds.y)/$($bounds.w)/$($bounds.h)"
        $change = Get-ChangeScore $full $consumer $geometry
        $output = New-Object System.Drawing.Bitmap $outWidth, $outHeight
        $graphics = [System.Drawing.Graphics]::FromImage($output)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($full,0,0,$outWidth,$outHeight)
        $graphics.Dispose(); $graphics = $null
        $stream = New-Object System.IO.MemoryStream
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $format = [string](Default-Field $request.format 'jpeg')
        if ($format -notin @('jpeg','png')) { throw 'format must be jpeg or png.' }
        if ($format -eq 'png') { $output.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png) }
        else {
            $parameters = New-Object System.Drawing.Imaging.EncoderParameters 1
            $parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([int64]$quality)
            $output.Save($stream,$codec,$parameters)
        }
        $bytes = $stream.ToArray()
        $cursor = [GamePlayerNative]::Cursor()
        return @{
            ok=$true; data=[Convert]::ToBase64String($bytes); bytes=$bytes.Length
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
function Validate-Actions($request) {
    if ($request.actions -isnot [array] -or $request.actions.Count -eq 0 -or $request.actions.Count -gt 12) { throw 'Supply an actions array containing 1 to 12 actions.' }
    $maxHold = Int-Field (Default-Field $request.maxHoldMs 3000) 'maxHoldMs' 10 60000
    $timeout = Int-Field (Default-Field $request.timeoutMs 15000) 'timeoutMs' 1000 120000
    $bounds = Get-MonitorBounds 'virtual'
    $repeat=Int-Field (Default-Field $request.repeat 1) 'repeat' 1 20
    if($request.actions.Count*$repeat -gt 120){throw 'At most 120 repeated steps.'}
    $standalone=($repeat -gt 1 -or $request.standalone -eq $true)
    $held=@{}; $budget = 0
    foreach ($a in $request.actions) {
        if ($null -eq $a -or $a -is [array] -or $a -is [string]) { throw 'Each action must be an object.' }
        $kind = [string]$a.kind
        if ($kind -notin @('move','click','down','up','scroll','key','keydown','keyup','hold','type','drag','wait')) { throw "Unsupported action '$kind'." }
        if ($kind -in @('move','drag') -or ($kind -eq 'click' -and ($null -ne $a.x -or $null -ne $a.y))) {
            [void](Int-Field $a.x 'x' $bounds.x ($bounds.x+$bounds.w-1)); [void](Int-Field $a.y 'y' $bounds.y ($bounds.y+$bounds.h-1))
        }
        if ($kind -eq 'drag') {
            [void](Int-Field $a.fromX 'fromX' $bounds.x ($bounds.x+$bounds.w-1)); [void](Int-Field $a.fromY 'fromY' $bounds.y ($bounds.y+$bounds.h-1))
        }
        if ($kind -in @('click','down','up','drag')) {
            $button = [string](Default-Field $a.button 'left')
            if (-not $script:Buttons.ContainsKey($button)) { throw 'button must be left, right, or middle.' }
        }
        $cost = 100
        switch ($kind) {
            'wait' { $cost=100+(Int-Field $a.durationMs 'durationMs' 0 60000) }
            'click' { $count = Int-Field (Default-Field $a.count 1) 'count' 1 5; $cost=100+$count*88 }
            'drag' { $steps = Int-Field (Default-Field $a.steps 12) 'steps' 2 60; $cost=140+$steps*18 }
            'scroll' { $amount=Int-Field (Default-Field $a.amount 120) 'amount' -12000 12000; if($amount -eq 0) {throw 'amount must not be zero.'} }
            'hold' { $duration=Int-Field (Default-Field $a.holdMs 200) 'holdMs' 10 $maxHold; $cost=$duration+100 }
            'key' { $cost=130 }
            'type' {
                if ($a.text -isnot [string] -or $a.text.Length -eq 0 -or $a.text.Length -gt 2000) { throw 'text must contain 1 to 2000 UTF-16 code units.' }
                if ($a.text -match '[\x00-\x1f\x7f]') { throw 'text must not contain control characters.' }
                for($i=0;$i -lt $a.text.Length;$i++) {
                    $ch=$a.text[$i]
                    if([char]::IsHighSurrogate($ch)) { if($i+1 -ge $a.text.Length -or -not [char]::IsLowSurrogate($a.text[$i+1])) { throw 'Unpaired Unicode surrogate.' }; $i++ }
                    elseif([char]::IsLowSurrogate($ch)) { throw 'Unpaired Unicode surrogate.' }
                }
                $cost=100+$a.text.Length*8
            }
        }
        if ($kind -in @('key','keydown','keyup','hold')) {
            if ($a.keys -isnot [array] -or $a.keys.Count -eq 0 -or $a.keys.Count -gt 4) { throw 'keys must be one flat chord of 1 to 4 canonical names.' }
            $seen=@{}
            foreach ($name in $a.keys) {
                if ($name -isnot [string] -or -not $script:KeyTable.ContainsKey($name) -or $seen.ContainsKey($name)) { throw "Unsupported or duplicate canonical key '$name'." }
                $seen[$name]=$true
            }
        }
        if($standalone){
            $ids=@(); if($kind -in @('keydown','keyup')){$ids=@($a.keys | ForEach-Object {"key:$_"})}elseif($kind -in @('down','up')){$ids=@("button:$button")}
            foreach($id in $ids){
                if($kind -in @('down','keydown')){if(-not $held.ContainsKey($id)){$held[$id]=$budget}}
                elseif(-not $held.ContainsKey($id)){throw 'Standalone release has no matching down.'}else{$held.Remove($id)}
            }
            foreach($started in $held.Values){if($budget+$cost-$started -gt $maxHold){throw 'Standalone held-input budget exceeds maxHoldMs.'}}
        }
        $budget += $cost
    }
    if($standalone -and $held.Count -ne 0){throw 'Standalone sequence leaves held input.'}
    $budget *= $repeat
    if ($budget -gt $timeout-1000) { throw 'Batch execution budget exceeds timeout minus 1000 ms cleanup margin.' }
    return [int]$maxHold
}
function Press-Key([string]$name) {
    $vk=$script:KeyTable[$name]; $flags=0
    if($script:ExtendedKeys -contains $vk) { $flags=1 }
    return [InputSession]::KeyDown($vk,[uint32]$flags)
}
function Release-Key([string]$name) { [InputSession]::KeyUp($script:KeyTable[$name]) }
function Press-Button([string]$button) {
    $b=$script:Buttons[$button]
    return [InputSession]::ButtonDown($b.code,[uint32]$b.down,[uint32]$b.up)
}
function Release-Button([string]$button) { [InputSession]::ButtonUp($script:Buttons[$button].code) }
function Invoke-Input($request) {
    if($Watchdog) { throw 'Release watchdog cannot execute input actions.' }
    $maxHold=Validate-Actions $request
    $ownerId=Int-Field $request.ownerId 'ownerId' 1 2147483647
    if(-not [GamePlayerNative]::DesktopInteractive()) { throw 'Interactive desktop unavailable.' }
    [GamePlayerNative]::EnsureDpi()
    $releaseOnly = @($request.actions | Where-Object { $_.kind -notin @('up','keyup') }).Count -eq 0
    if($releaseOnly){
        foreach($a in $request.actions){if($a.kind -eq 'keyup'){foreach($name in $a.keys){[InputSession]::ReleaseKey([int]$ownerId,$script:KeyTable[$name])}}else{[InputSession]::ReleaseButton([int]$ownerId,$script:Buttons[(Default-Field $a.button 'left')].code)}}
        $value=Held-State; $value['ok']=$true; $p=[GamePlayerNative]::Cursor();$value['cursor']=@{x=$p.X;y=$p.Y}; return $value
    }
    if($null -eq $request.window){
        if(-not $Recording){throw 'A bound target window is required.'}
        $target=[InputSession]::MockWindow()
    }else{
        $target=[GamePlayerWindow]::Get([string]$request.window.windowId)
        foreach($field in @('x','y','width','height')){if($request.window.client.$field -ne $target.client.$field){throw 'Target geometry changed before injection.'}}
    }
    foreach($a in $request.actions){
        foreach($pair in @(@('x','y'),@('fromX','fromY'))){if($null -ne $a.($pair[0])){[GamePlayerWindow]::Point($target,[int]$a.($pair[0]),[int]$a.($pair[1]))}}
        if($a.kind -in @('down','scroll') -or ($a.kind -eq 'click' -and $null -eq $a.x)){$p=[GamePlayerNative]::Cursor();[GamePlayerWindow]::Point($target,$p.X,$p.Y)}
    }
    $repeat=[int](Default-Field $request.repeat 1)
    [InputSession]::Begin([int]$ownerId,$maxHold,$target,($repeat -gt 1 -or $request.standalone -eq $true))
    $script:ExecutingInput=$true
    $all=@();for($round=0;$round -lt $repeat;$round++){$all+= $request.actions}
    foreach($a in $all) {
        $button=[string](Default-Field $a.button 'left')
        switch($a.kind) {
            'wait' { [InputSession]::Delay([int]$a.durationMs) }
            'move' { [InputSession]::Move([int]$a.x,[int]$a.y) }
            'scroll' { [InputSession]::Mouse(0x0800,[int](Default-Field $a.amount 120),0,0) }
            'down' { [void](Press-Button $button) }
            'up' { Release-Button $button }
            'click' {
                if($null -ne $a.x) { [InputSession]::Move([int]$a.x,[int]$a.y) }
                for($i=0;$i -lt (Default-Field $a.count 1);$i++) {
                    $added=Press-Button $button
                    try { [InputSession]::Delay(28) } finally { if($added) { Release-Button $button } }
                    if($i -lt (Default-Field $a.count 1)-1) { [InputSession]::Delay(60) }
                }
            }
            'keydown' { foreach($name in $a.keys) { [void](Press-Key $name) } }
            'keyup' { for($i=$a.keys.Count-1;$i -ge 0;$i--) { Release-Key $a.keys[$i] } }
            { $_ -in @('key','hold') } {
                $added=@()
                try {
                    foreach($name in $a.keys) { if(Press-Key $name) { $added+= $name } }
                    $duration=30; if($a.kind -eq 'hold') { $duration=Default-Field $a.holdMs 200 }
                    [InputSession]::Delay([int]$duration)
                } finally { for($i=$added.Count-1;$i -ge 0;$i--) { Release-Key $added[$i] } }
            }
            'type' { foreach($ch in $a.text.ToCharArray()) { [InputSession]::UnicodeChar([uint16][char]$ch); [InputSession]::Delay(8) } }
            'drag' {
                [InputSession]::Move([int]$a.fromX,[int]$a.fromY)
                [InputSession]::Delay(40); $added=Press-Button $button
                try {
                    $steps=[int](Default-Field $a.steps 12)
                    for($i=1;$i -le $steps;$i++) {
                        $t=$i/$steps
                        [InputSession]::Move([int][Math]::Round($a.fromX+($a.x-$a.fromX)*$t),[int][Math]::Round($a.fromY+($a.y-$a.fromY)*$t))
                        [InputSession]::Delay(18)
                    }
                } finally { if($added) { Release-Button $button } }
            }
        }
    }
    [InputSession]::End()
    $script:ExecutingInput=$false
    $result=Held-State; $cursor=[GamePlayerNative]::Cursor()
    $result['ok']=$true; $result['cursor']=@{x=$cursor.X;y=$cursor.Y}
    return $result
}
function Invoke-Probe {
    $primary=Get-MonitorBounds 'primary'; $virtual=Get-MonitorBounds 'virtual'; $cursor=[GamePlayerNative]::Cursor()
    $result=Held-State
    $result['protocolVersion']=4
    $result['ok']=$true; $result['interactive']=[GamePlayerNative]::DesktopInteractive()
    $result['foreground']=[GamePlayerNative]::ForegroundTitle(); $result['recording']=$Recording.IsPresent
    $result['primary']=@{x=$primary.x;y=$primary.y;width=$primary.w;height=$primary.h}
    $result['virtual']=@{x=$virtual.x;y=$virtual.y;width=$virtual.w;height=$virtual.h}
    $result['cursor']=@{x=$cursor.X;y=$cursor.Y}; $result['nativeSize']=[Runtime.InteropServices.Marshal]::SizeOf([type][GamePlayerNative+INPUT])
    return $result
}
function Write-Response($response) {
    $response['id']=$script:RequestId
    [GamePlayerOutput]::Reply(($response | ConvertTo-Json -Depth 10 -Compress))
}
try {
    while(-not [InputSession]::MonitorStopped()) {
        $read=[Console]::In.ReadLineAsync()
        while(-not $read.Wait(100) -and -not [InputSession]::MonitorStopped()) {}
        if(-not $read.IsCompleted) { break }
        $line=$read.Result; if($null -eq $line) { break }; if($line.Trim() -eq '') { continue }
        $script:RequestId=$null; $script:ExecutingInput=$false
        try {
            $request=$line | ConvertFrom-Json
            $script:RequestId=$request.id
            switch([string]$request.op) {
                'probe' { Write-Response (Invoke-Probe) }
                'windows' { Write-Response @{ok=$true;windows=@([GamePlayerWindow]::List())} }
                'window' { Write-Response @{ok=$true;window=[GamePlayerWindow]::Get([string]$request.windowId)} }
                'frame' { Write-Response (Capture-Frame $request) }
                'input' { Write-Response (Invoke-Input $request) }
                { $_ -in @('release','cancel') } { Write-Response (Release-All ([int](Default-Field $request.ownerId 0))) }
                'forget' { $script:PreviousFrames.Remove([string]$request.consumerId); Write-Response @{ok=$true} }
                'test_config' {
                    if(-not $Recording) { throw 'Test controls require the recording backend.' }
                    if($null -ne $request.clock) { [InputSession]::TestClock([long]$request.clock) }
                    if($null -ne $request.failAt -or $null -ne $request.failUps) { [InputSession]::TestFailure([int](Default-Field $request.failAt -1),[bool]$request.failUps) }
                    if($null -ne $request.windowState){
                        $w=$request.windowState
                        [InputSession]::TestWindow([bool](Default-Field $w.focused $true),[bool](Default-Field $w.valid $true),[bool](Default-Field $w.minimized $false),[int](Default-Field $w.x -1920),[int](Default-Field $w.y -80),[int](Default-Field $w.width 4480),[int](Default-Field $w.height 1520),[bool](Default-Field $w.occluded $false),[int](Default-Field $w.pid 1),[long](Default-Field $w.processStart 1))
                    }
                    [InputSession]::Tick(); Write-Response (Invoke-Probe)
                }
                'test_block' {
                    if(-not $Recording) { throw 'Test controls require the recording backend.' }
                    $duration=Int-Field $request.delayMs 'delayMs' 1 30000
                    Start-Sleep -Milliseconds ([int]$duration)
                    Write-Response @{ok=$true}
                }
                'shutdown' { Write-Response (Release-All); break }
                default { throw "Unsupported operation '$($request.op)'." }
            }
            if($request.op -eq 'shutdown') { break }
        } catch {
            $message=$_.Exception.Message; $released=$null
            if($script:ExecutingInput) { $released=[InputSession]::Cancel(0); $script:ExecutingInput=$false }
            if($request.op -eq 'input' -and [InputSession]::State() -eq 2){$released=$false}
            Write-Response @{ok=$false;error=$message;code='HELPER_ERROR';released=$released}
        }
    }
} finally {
    # A watchdog that cannot release stays alive retrying; it is never silently
    # discarded with a nonempty ledger. Whole-tree/system termination is outside
    # this guarantee. Recording failure tests explicitly clear their injected fault.
    $released=[InputSession]::Cancel(0)
    if($Watchdog) { while(-not $released) { Start-Sleep -Milliseconds 100; $released=[InputSession]::Cancel(0) } }
    [InputSession]::Dispose()
}

