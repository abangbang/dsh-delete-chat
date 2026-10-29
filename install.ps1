# install.ps1 — mount dsh-delete-chat into a DSH profile.
#
#   .\install.ps1                     # install / reinstall (idempotent)
#   .\install.ps1 -Uninstall          # unmount and delete the package copy
#   .\install.ps1 -DryRun             # show the patch diff, write nothing
#   .\install.ps1 -ProfileDir <dir>   # another profile
#
# Thin wrapper: the installer is Node, so Windows, macOS and Linux run the same
# implementation (scripts/install.mjs). This file only translates switches.
# Restart DSH afterwards.

[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$DryRun,
  [Alias('Profile')][string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop')
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$installer = Join-Path $here 'scripts\install.mjs'
if (-not (Test-Path $installer)) { throw "missing $installer" }

$nodeArgs = @($installer, '--profile', $ProfileDir)
if ($Uninstall) { $nodeArgs += '--uninstall' }
if ($DryRun) { $nodeArgs += '--dry-run' }

& node @nodeArgs
exit $LASTEXITCODE
