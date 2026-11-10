param(
  [switch]$NoOpen,
  [ValidateRange(1, 65535)][int]$Port = 4317
)

$ErrorActionPreference = 'Stop'
$appDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'Start-Task.ps1') -TaskName 'notes-runtime' | Out-Null
$serverFile = Join-Path $appDirectory 'src\server.mjs'
$runtimeDirectory = Join-Path $appDirectory 'runtime'
$address = "http://127.0.0.1:$Port"
$launcherLock = $null

function Get-AppHealth {
  param([string]$TargetAddress = $address)
  try {
    $health = Invoke-RestMethod -Uri "$TargetAddress/api/health" -TimeoutSec 1
    if ($health.ok -eq $true -and $health.app -eq 'local-learning-notes' -and
        [System.IO.Path]::GetFullPath([string]$health.root) -eq $appDirectory) { return $health }
  } catch { }
  return $null
}

function Test-ListeningPort {
  $probe = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $probe.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(300)) { return $false }
    $probe.EndConnect($pending)
    return $true
  } catch { return $false }
  finally { $probe.Dispose() }
}

try {
  New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
  $lockPath = Join-Path $runtimeDirectory 'launcher.lock'
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    try {
      $launcherLock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      break
    } catch [System.IO.IOException] { Start-Sleep -Milliseconds 200 }
  }
  if ($null -eq $launcherLock) { throw 'Another launcher is working. Please try again shortly.' }

  $recordPath = Join-Path $runtimeDirectory 'process.json'
  if (Test-Path -LiteralPath $recordPath -PathType Leaf) {
    $matchingExistingAddress = $null
    try {
      $existingRecord = Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $existingPort = [int]$existingRecord.port
      if ([string]$existingRecord.appRoot -eq $appDirectory -and [string]$existingRecord.serverPath -eq $serverFile -and
          $existingPort -ge 1 -and $existingPort -le 65535) {
        $existingAddress = "http://127.0.0.1:$existingPort"
        if ($null -ne (Get-AppHealth -TargetAddress $existingAddress)) {
          $matchingExistingAddress = $existingAddress
        }
      }
    } catch { }
    if ($null -ne $matchingExistingAddress) {
      Write-Host "Learning notebook is already running: $matchingExistingAddress"
      if (-not $NoOpen) { Start-Process -FilePath $matchingExistingAddress }
      exit 0
    }
  }

  if ($null -ne (Get-AppHealth)) {
    Write-Host "Learning notebook is already running: $address"
    if (-not $NoOpen) { Start-Process -FilePath $address }
    exit 0
  }
  if (Test-ListeningPort) { throw "Port $Port belongs to another service. Use launch.ps1 -Port <another-port> or stop that service yourself." }

  $nodeCandidates = @()
  $pathCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -ne $pathCommand) { $nodeCandidates += $pathCommand.Source }
  if ($env:NOTES_NODE) { $nodeCandidates += $env:NOTES_NODE }
  $nodeBinary = $null
  foreach ($candidate in ($nodeCandidates | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    try {
      $nodeVersion = [string](& $candidate --version)
      if ($LASTEXITCODE -eq 0 -and $nodeVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22) {
        $nodeBinary = [System.IO.Path]::GetFullPath($candidate)
        break
      }
    } catch { }
  }
  if ($null -eq $nodeBinary) { throw 'Node.js 22 or newer was not found. Install a supported Node.js LTS release; Node.js 24 is recommended. No files were downloaded.' }

  $stdoutPath = Join-Path $runtimeDirectory 'server-output.log'
  $stderrPath = Join-Path $runtimeDirectory 'server-error.log'
  $previousPort = $env:PORT
  try {
    $env:PORT = [string]$Port
    $serviceProcess = Start-Process -FilePath $nodeBinary -ArgumentList ('"' + $serverFile + '"') -WorkingDirectory $appDirectory -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  } finally { $env:PORT = $previousPort }

  $startedAt = $serviceProcess.StartTime.ToUniversalTime().ToString('o')
  $record = @{ pid = $serviceProcess.Id; nodePath = $nodeBinary; serverPath = $serverFile; appRoot = $appDirectory; port = $Port; startedAt = $startedAt }
  $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'process.json') -Encoding UTF8
  [string]$serviceProcess.Id | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'server.pid') -Encoding ASCII
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $serviceProcess.Refresh()
    if ($serviceProcess.HasExited) { throw "The notebook could not start. Read $stderrPath" }
    if ($null -ne (Get-AppHealth)) { $ready = $true; break }
    Start-Sleep -Milliseconds 200
  }
  if (-not $ready) { throw "The notebook did not respond. Read $stderrPath and use stop.ps1 if this launcher left a process running." }

  Write-Host "Learning notebook is running: $address"
  Write-Host "Data: $(Join-Path $appDirectory 'data\notebook.json')"
  if (-not $NoOpen) { Start-Process -FilePath $address }
  exit 0
} catch {
  Write-Host "Launch failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if ($null -ne $launcherLock) { $launcherLock.Dispose() }
}
