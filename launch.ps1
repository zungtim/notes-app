param([switch]$NoOpen,[ValidateRange(1,65535)][int]$Port=4317)
# Compatibility entry for the existing Windows shortcut.
& (Join-Path $PSScriptRoot 'scripts\launch.ps1') @PSBoundParameters
exit $LASTEXITCODE
