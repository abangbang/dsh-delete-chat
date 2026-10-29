# install.ps1 — 把 dsh-session-delete 挂进 DSH desktop profile
#
#   .\install.ps1              安装 / 重装（幂等）
#   .\install.ps1 -Uninstall   卸载（删挂载行 + 删目录，恢复配置备份）
#
# 重启 DSH 后生效。

[CmdletBinding()]
param(
  [switch]$Uninstall,
  [string]$Profile = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop')
)

$ErrorActionPreference = 'Stop'
$name = 'dsh-session-delete'
$source = $PSScriptRoot
$target = Join-Path $Profile "node_modules\$name"
$patchFile = Join-Path $Profile 'cordis.patch.yml'

$marker = "# --- $name (managed by install.ps1) ---"
$block = @"
$marker
- insert:
    - id: session-delete
      name: '$name'
# --- end $name ---
"@

if (-not (Test-Path $patchFile)) { throw "找不到 profile 配置：$patchFile" }

function Read-Patch { Get-Content $patchFile -Raw }

function Write-Patch([string]$text) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item $patchFile "$patchFile.bak-$stamp" -Force
  Set-Content -Path $patchFile -Value $text -Encoding utf8 -NoNewline
}

# 去掉本插件此前写入的块（含上一次的 marker 形式），返回剩余文本
function Strip-Block([string]$text) {
  $pattern = "(?ms)^# --- $name \(managed by install\.ps1\) ---\r?\n.*?^# --- end $name ---\r?\n?"
  $stripped = [regex]::Replace($text, $pattern, '')
  # 兼容没有 end 标记的旧写法
  $stripped = [regex]::Replace($stripped, "(?ms)^- insert:\r?\n\s+- id: session-delete\r?\n\s+name: '$name'\r?\n?", '')
  return $stripped
}

if ($Uninstall) {
  $text = Read-Patch
  Write-Patch (Strip-Block $text)
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Write-Host "已卸载 $name。重启 DSH 后菜单项消失。" -ForegroundColor Green
  return
}

# ── 安装 ────────────────────────────────────────────────────────────────────
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Path $target -Force | Out-Null

foreach ($file in @('package.json', 'cordis.patch.yml', 'icon.svg', 'README.md')) {
  $from = Join-Path $source $file
  if (Test-Path $from) { Copy-Item $from (Join-Path $target $file) -Force }
}
foreach ($dir in @('lib', 'bin', 'test')) {
  $from = Join-Path $source $dir
  if (Test-Path $from) { Copy-Item $from (Join-Path $target $dir) -Recurse -Force }
}

$text = Strip-Block (Read-Patch)
if (-not $text.EndsWith("`n")) { $text += "`n" }
Write-Patch ($text + "`n" + $block + "`n")

Write-Host "已安装到 $target" -ForegroundColor Green
Write-Host "已写入挂载行：$patchFile" -ForegroundColor Green
Write-Host "重启 DSH 后，会话行「⋯」菜单里会出现「删除会话」。" -ForegroundColor Cyan
