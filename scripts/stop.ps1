$ErrorActionPreference = 'Stop'
$appDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serverFile = Join-Path $appDirectory 'src\server.mjs'
$runtimeDirectory = Join-Path $appDirectory 'runtime'
$recordFile = Join-Path $runtimeDirectory 'process.json'
$launcherLock = $null

try {
  if (-not (Test-Path -LiteralPath $recordFile -PathType Leaf)) {
    Write-Host 'No launcher-owned process is recorded. If you started the app in a terminal, stop it there with Ctrl+C.'
    exit 0
  }
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    try {
      $launcherLock = [System.IO.File]::Open((Join-Path $runtimeDirectory 'launcher.lock'), [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      break
    } catch [System.IO.IOException] { Start-Sleep -Milliseconds 200 }
  }
  if ($null -eq $launcherLock) { throw 'Another launcher is working. Please try again shortly.' }
  $record = Get-Content -LiteralPath $recordFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([string]$record.appRoot -ne $appDirectory -or [string]$record.serverPath -ne $serverFile) { throw 'The process record belongs to a different app. No process was stopped.' }
  $recordedProcessId = [int]$record.pid
  if ($recordedProcessId -le 0) { throw 'Invalid process ID. No process was stopped.' }
  $processDetails = Get-CimInstance Win32_Process -Filter "ProcessId = $recordedProcessId"
  if ($null -eq $processDetails) {
    Write-Host 'The recorded notebook process has already stopped.'
    exit 0
  }
  $commandPattern = '(?i)(?:^|\s)"?' + [regex]::Escape($serverFile) + '"?(?:\s|$)'
  if ($processDetails.Name -ne 'node.exe' -or [string]$processDetails.ExecutablePath -ne [string]$record.nodePath -or
      [string]$processDetails.CommandLine -notmatch $commandPattern) { throw 'PID ownership could not be confirmed. No process was stopped.' }
  $runningProcess = Get-Process -Id $recordedProcessId -ErrorAction Stop
  if ($record.startedAt -is [DateTime]) {
    $expectedStart = $record.startedAt.ToUniversalTime()
  } else {
    $expectedStart = [DateTime]::Parse([string]$record.startedAt, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  }
  if ([Math]::Abs(($runningProcess.StartTime.ToUniversalTime() - $expectedStart).TotalMilliseconds) -gt 100) { throw 'This PID has been reused. No process was stopped.' }
  Stop-Process -Id $recordedProcessId -Force -ErrorAction Stop
  $stopped = $false
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    if ($null -eq (Get-CimInstance Win32_Process -Filter "ProcessId = $recordedProcessId")) { $stopped = $true; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $stopped) { throw 'The process has not exited. No further stop was attempted.' }
  Write-Host 'Learning notebook stopped. Your notes remain in data\notebook.json.'
  exit 0
} catch {
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'stop-error.log') -Encoding UTF8
  Write-Host "Stop failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if ($null -ne $launcherLock) { $launcherLock.Dispose() }
}
