# A separate STA display process. This file cannot send keyboard/mouse input.
param([int]$ParentPid, [string]$SettingsPath, [string]$RenderPath='', [string]$RenderState='{}', [string]$Style='')
$ErrorActionPreference='Stop'
$utf8=New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding=$utf8
[Console]::OutputEncoding=$utf8
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Web.Extensions
Add-Type -Path (Join-Path $PSScriptRoot 'overlay-window.cs') -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions
$layout=Join-Path $PSScriptRoot 'overlay-layout.json'
if($RenderPath) { [GamePlayerOverlay]::Render($layout,$RenderPath,$RenderState,$Style) }
else { [GamePlayerOverlay]::Run($layout,$SettingsPath,$ParentPid) }
