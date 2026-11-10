param(
  [ValidatePattern('^[a-z0-9][a-z0-9-]{0,63}$')][string]$TaskName = 'notes-task',
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]{0,180}$')][string]$ResumeTask
)

$ErrorActionPreference = 'Stop'
$taskAppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskWorkspaceRoot = Join-Path $taskAppRoot '_workspace'
function Assert-NotesWorkspacePath {
  param([string]$Target)
  $resolved = [IO.Path]::GetFullPath($Target)
  if (-not $resolved.StartsWith($taskWorkspaceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Task path must stay inside this app _workspace directory.'
  }
  $taskRelative = $resolved.Substring($taskAppRoot.Length + 1)
  $taskCurrent = $taskAppRoot
  foreach ($taskSegment in ($taskRelative -split '[\\/]')) {
    $taskCurrent = Join-Path $taskCurrent $taskSegment
    if (-not (Test-Path -LiteralPath $taskCurrent)) { break }
    $taskItem = Get-Item -LiteralPath $taskCurrent -Force
    if (($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Task symlinks and junctions are not allowed.' }
    if (-not $taskItem.PSIsContainer) { throw 'Task path contains a non-directory.' }
  }
  return $resolved
}

$taskBase = Join-Path $taskWorkspaceRoot 'tasks'
if ($env:NOTES_WORKSPACE_ROOT) { Assert-NotesWorkspacePath $env:NOTES_WORKSPACE_ROOT | Out-Null }
if ($ResumeTask) {
  $taskDirectory = Assert-NotesWorkspacePath (Join-Path $taskBase $ResumeTask)
  if (-not (Test-Path -LiteralPath $taskDirectory -PathType Container)) { throw 'The task to resume does not exist.' }
} else {
  # Named PowerShell tasks always share one resume base; JS helpers may nest under NOTES_WORKSPACE_ROOT.
  $taskRunName = '{0}-{1}-{2}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $TaskName, [Guid]::NewGuid().ToString('N').Substring(0, 8)
  $taskDirectory = Assert-NotesWorkspacePath (Join-Path $taskBase $taskRunName)
}
foreach ($taskPart in @('', 'tmp', 'cache', 'logs', 'artifacts')) {
  $taskTarget = if ($taskPart) { Join-Path $taskDirectory $taskPart } else { $taskDirectory }
  Assert-NotesWorkspacePath $taskTarget | Out-Null
  New-Item -ItemType Directory -Path $taskTarget -Force | Out-Null
}
$taskCache = Join-Path $taskDirectory 'cache'
$taskEnvironment = @{
  TEMP = (Join-Path $taskDirectory 'tmp'); TMP = (Join-Path $taskDirectory 'tmp'); TMPDIR = (Join-Path $taskDirectory 'tmp')
  XDG_CACHE_HOME = $taskCache; npm_config_cache = (Join-Path $taskCache 'npm'); NODE_COMPILE_CACHE = (Join-Path $taskCache 'node')
  PYTHONPYCACHEPREFIX = (Join-Path $taskCache 'python'); PIP_CACHE_DIR = (Join-Path $taskCache 'pip')
  MPLCONFIGDIR = (Join-Path $taskCache 'matplotlib'); JUPYTER_RUNTIME_DIR = (Join-Path $taskCache 'jupyter'); NUMBA_CACHE_DIR = (Join-Path $taskCache 'numba')
  PLAYWRIGHT_BROWSERS_PATH = (Join-Path $taskCache 'playwright'); NOTES_WORKSPACE_ROOT = $taskDirectory
  NOTES_TEST_ARTIFACTS = (Join-Path $taskDirectory 'artifacts'); CODEX_TASK_WORKDIR = $taskDirectory; CODEX_TASK_OUTPUT_ROOT = (Join-Path $taskAppRoot '成果产出')
}
foreach ($taskEnvName in $taskEnvironment.Keys) {
  if ($taskEnvName -ne 'CODEX_TASK_OUTPUT_ROOT') {
    Assert-NotesWorkspacePath $taskEnvironment[$taskEnvName] | Out-Null
    New-Item -ItemType Directory -Path $taskEnvironment[$taskEnvName] -Force | Out-Null
  }
  [Environment]::SetEnvironmentVariable($taskEnvName, $taskEnvironment[$taskEnvName], 'Process')
}
Set-Location -LiteralPath $taskDirectory
[pscustomobject]@{ TaskDirectory = $taskDirectory; CacheDirectory = $taskCache; AppRoot = $taskAppRoot }
