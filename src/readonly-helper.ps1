# Capability-separated capture/query process. No InputSession type, ledger or input hooks.
param([string]$Session='', [int]$ParentPid=0, [switch]$Recording)
$ErrorActionPreference='Stop'
$utf8=New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding=$utf8; [Console]::OutputEncoding=$utf8; $OutputEncoding=$utf8
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.dll,System.Core.dll,System.Drawing.dll -Path @((Join-Path $PSScriptRoot 'native-platform.cs'),(Join-Path $PSScriptRoot 'window-native.cs'),(Join-Path $PSScriptRoot 'capture-native.cs'))
[GamePlayerNative]::Recording=$Recording.IsPresent
if($Recording){
    [GamePlayerWindow]::RecordingWindow = { New-Object GameWindowInfo -Property @{windowId='1:1:1';title='synthetic';processStart='1';pid=1;valid=$true;focused=$true;minimized=$false;client=(New-Object ClientBounds -Property @{x=-1920;y=-80;width=4480;height=1520})} }
    [GamePlayerWindow]::RecordingOccluded = { $false }
}
$Watchdog=$false; $script:PreviousFrames=@{}
. (Join-Path $PSScriptRoot 'capture-functions.ps1')
$parent=if($ParentPid -gt 0){[Diagnostics.Process]::GetProcessById($ParentPid)}else{$null}
try {
    while($null -eq $parent -or -not $parent.HasExited){
        $read=[Console]::In.ReadLineAsync()
        while(-not $read.Wait(100) -and ($null -eq $parent -or -not $parent.HasExited)){}
        if(-not $read.IsCompleted){break}
        $line=$read.Result; if($null -eq $line){break}; if($line.Trim() -eq ''){continue}
        $id=$null
        try {
            $request=$line|ConvertFrom-Json; $id=$request.id
            switch([string]$request.op){
                'probe' { $reply=@{ok=$true;protocolVersion=1;readOnly=$true;recording=$Recording.IsPresent} }
                'windows' { $reply=@{ok=$true;windows=@([GamePlayerWindow]::List())} }
                'window' { $reply=@{ok=$true;window=[GamePlayerWindow]::Get([string]$request.windowId)} }
                'frame' { $reply=Capture-Frame $request }
                'forget' { $script:PreviousFrames.Remove([string]$request.consumerId); $reply=@{ok=$true} }
                'shutdown' { $reply=@{ok=$true} }
                default { throw 'Read-only helper rejects this operation.' }
            }
        } catch { $reply=@{ok=$false;error=$_.Exception.Message;code='READONLY_ERROR'} }
        $reply.id=$id; [Console]::Out.WriteLine(($reply|ConvertTo-Json -Depth 10 -Compress))
        if($request.op -eq 'shutdown'){break}
    }
} finally {if($null -ne $parent){$parent.Dispose()};$script:PreviousFrames.Clear()}
