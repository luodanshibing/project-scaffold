# Project Scaffold（项目脚手架）一键部署
#
# 用法（二选一）：
#   双击 tools\deploy.bat
#   或：powershell -NoProfile -ExecutionPolicy Bypass -File tools\deploy.ps1 -Vault 'E:\Dnotes'
param(
  [string]$Vault = 'E:\Dnotes',
  [switch]$SkipScaffold
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$src = $projectRoot
$dst = Join-Path $Vault '.obsidian\plugins\project-scaffold'

if (-not (Test-Path $Vault)) { throw "库路径不存在：$Vault" }
if (-not (Test-Path $src)) { throw "找不到插件源码目录：$src" }

Write-Host "[1/3] 复制插件到 $dst"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
foreach ($f in @('main.js', 'manifest.json', 'styles.css')) {
  $from = Join-Path $src $f
  if (-not (Test-Path $from)) { throw "缺少文件：$from" }
  Copy-Item $from (Join-Path $dst $f) -Force
  Write-Host "      $f"
}

if (-not $SkipScaffold) {
  $scaffold = Join-Path $Vault '1 Obsidian\项目脚手架'
  Write-Host "[2/3] 补齐脚手架模板目录 $scaffold"
  $layers = [ordered]@{
    '工作' = @('01 管理', '02 文档', '03 需求', '04 研发\01 系统', '04 研发\02 机械', '04 研发\03 电气', '04 研发\04 软件', '05 生产', '06 交付')
    '生活' = @('01 设计标准', '02 设计参考', '03 设计图纸', '04 加工图纸')
    '学习' = @()
  }
  foreach ($k in $layers.Keys) {
    New-Item -ItemType Directory -Force -Path (Join-Path $scaffold $k) | Out-Null
    foreach ($l in $layers[$k]) {
      New-Item -ItemType Directory -Force -Path (Join-Path (Join-Path $scaffold $k) $l) | Out-Null
    }
    Write-Host "      $k"
  }
} else {
  Write-Host "[2/3] 已跳过脚手架目录（-SkipScaffold）"
}

$count = (Get-ChildItem $dst -File | Measure-Object).Count
Write-Host "[3/3] 完成：$dst 内有 $count 个文件"
Write-Host ''
Write-Host '接下来（在 Obsidian 里做一次即可）：'
Write-Host '  1) Ctrl+P → 运行「重新加载应用而不保存」（或重启 Obsidian）'
Write-Host '  2) 设置 → 第三方插件 → 找到 Project Scaffold → 启用'
Write-Host '  3) 命令面板里会出现三条命令：新建项目 / 新建项目文档 / 初始化脚手架'
