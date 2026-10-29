# install.ps1 — 把 dsh-delete-chat 挂进 DSH desktop profile
#
#   .\install.ps1              安装 / 重装（幂等，会顺手清掉旧名字的挂载）
#   .\install.ps1 -Uninstall   卸载（删挂载行 + 删目录，恢复配置备份）
#
# 重启 DSH 后生效。

[CmdletBinding()]
param(
  [switch]$Uninstall,
  [string]$Profile = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop')
)

$ErrorActionPreference = 'Stop'
$name = 'dsh-delete-chat'
$source = $PSScriptRoot
$target = Join-Path $Profile "node_modules\$name"
$patchFile = Join-Path $Profile 'cordis.patch.yml'

# 改名前后的身份都要能清理：包名 + 挂载行 id
$identities = @('dsh-delete-chat', 'dsh-session-delete')
$entryIds = @('delete-chat', 'session-delete')

$marker = "# --- $name (managed by install.ps1) ---"
$block = @"
$marker
- insert:
    - id: delete-chat
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

# 去掉本插件（含改名前那套名字）写入的挂载块，返回剩余文本
function Strip-Block([string]$text) {
  $names = ($identities | ForEach-Object { [regex]::Escape($_) }) -join '|'
  $ids = ($entryIds | ForEach-Object { [regex]::Escape($_) }) -join '|'

  foreach ($identity in $identities) {
    $escaped = [regex]::Escape($identity)
    # 带 marker 的完整块
    $text = [regex]::Replace($text,
      "(?ms)^# --- $escaped \(managed by install\.ps1\) ---\r?\n.*?^# --- end $escaped ---\r?\n?",
      '')
  }
  # 没有 marker 的手写行（两种缩进写法都吃掉）
  $text = [regex]::Replace($text,
    "(?ms)^- insert:\r?\n\s+- id: (?:$ids)\r?\n\s+name: '(?:$names)'\r?\n?",
    '')
  return $text
}

# 删掉旧名字留下的包目录，否则 loader 还会看见它
function Remove-LegacyDirs {
  foreach ($identity in $identities) {
    if ($identity -eq $name) { continue }
    $legacy = Join-Path $Profile "node_modules\$identity"
    if (Test-Path $legacy) {
      Remove-Item $legacy -Recurse -Force
      Write-Host "已移除旧包目录：$legacy" -ForegroundColor Yellow
    }
  }
}

if ($Uninstall) {
  $text = Read-Patch
  Write-Patch (Strip-Block $text)
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Remove-LegacyDirs
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
  if (Test-Path $from) { Copy-Item $from -Destination $target -Recurse -Force }
}

Remove-LegacyDirs

$text = Strip-Block (Read-Patch)
if (-not $text.EndsWith("`n")) { $text += "`n" }
Write-Patch ($text + "`n" + $block + "`n")

Write-Host "已安装到 $target" -ForegroundColor Green
Write-Host "已写入挂载行：$patchFile" -ForegroundColor Green
Write-Host "重启 DSH 后，会话行「⋯」菜单里会出现「删除会话」。" -ForegroundColor Cyan
