$ErrorActionPreference = 'Stop'
$serverProject = Join-Path $PSScriptRoot '..\..\Server\TriggerPad.csproj'
$output = Join-Path $PSScriptRoot '..\build-resources\server'
$nugetConfig = Join-Path $PSScriptRoot 'NuGet.Config'
$dotnetHome = Join-Path $PSScriptRoot '..\build-resources\dotnet-home'
$cachedNugetPackages = Join-Path $env:USERPROFILE '.nuget\packages'

New-Item -ItemType Directory -Force -Path $dotnetHome | Out-Null
$env:APPDATA = $dotnetHome
$env:LOCALAPPDATA = $dotnetHome
$env:DOTNET_CLI_HOME = $dotnetHome
$env:NUGET_PACKAGES = $cachedNugetPackages

dotnet publish $serverProject -c Release -r win-x64 --self-contained true -o $output --configfile $nugetConfig --ignore-failed-sources /p:AssemblyName=TriggerPad.Server
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
