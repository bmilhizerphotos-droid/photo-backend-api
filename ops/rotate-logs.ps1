$ErrorActionPreference = "Stop"

$LogsDir  = "C:\Users\bmilh\photo-backend\logs"
$MaxBytes = 20MB
$KeepDays = 14

function Write-HostLine($msg) {
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  Write-Host "[$ts] $msg"
}

if (-not (Test-Path $LogsDir)) {
  New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
}

# 1) Delete old logs (keep last N days)
$cutoff = (Get-Date).AddDays(-$KeepDays)

Get-ChildItem -Path $LogsDir -File -Force |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object {
    Write-HostLine "Deleting old log: $($_.FullName)"
    Remove-Item -Force $_.FullName
  }

# 2) Truncate large active logs (keep recent tail)
$targets = @(
  (Join-Path $LogsDir "watchdog.log"),
  (Join-Path $LogsDir "backend.out.log"),
  (Join-Path $LogsDir "backend.err.log")
)

foreach ($p in $targets) {
  if (-not (Test-Path $p)) { continue }

  $fi = Get-Item $p -Force
  if ($fi.Length -le $MaxBytes) { continue }

  Write-HostLine "Truncating large log: $p ($($fi.Length) bytes)"

  # Keep last 20000 lines to preserve recent context
  $tail = Get-Content -Path $p -Tail 20000 -ErrorAction SilentlyContinue
  Set-Content -Path $p -Value $tail -Encoding utf8
}
