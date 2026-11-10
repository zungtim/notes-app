# Compatibility entry for the existing Windows shortcut.
& (Join-Path $PSScriptRoot 'scripts\stop.ps1')
exit $LASTEXITCODE
