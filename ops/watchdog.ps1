$ErrorActionPreference = "Stop"

$BackendServiceName = "MilhizerPhotoBackend"
$TunnelServiceName  = "cloudflared"

$LocalHealthUrl  = "http://127.0.0.1:3000/health"
$PublicHealthUrl = "https://api.milhizerfamilyphotos.org/health"

$LogPath = "C:\Users\bmilh\photo-backend\logs\watchdog.log"

function Write-Log {
  param([string]$Message)
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  Add-Content -Path $LogPath -Value "[$ts] $Message"
}

function Get-ServicePid {
  param([string]$Name)

  try {
    $out = & sc.exe queryex $Name 2>$null
    foreach ($line in $out) {
      if ($line -match "PID\s*:\s*(\d+)") {
        return [int]$Matches[1]
      }
    }
  } catch { }
  return 0
}

function Wait-ForServiceStableState {
  param(
    [string]$Name,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    try {
      $svc = Get-Service -Name $Name -ErrorAction Stop
    } catch {
      return $null
    }

    if ($svc.Status -in @("Running", "Stopped")) {
      return $svc
    }

    Start-Sleep -Seconds 3
  }

  try {
    return (Get-Service -Name $Name -ErrorAction Stop)
  } catch {
    return $null
  }
}

function Ensure-ServiceRunning {
  param(
    [string]$Name,
    [switch]$AllowForceKillIfStopPending
  )

  $svc = $null
  try {
    $svc = Get-Service -Name $Name -ErrorAction Stop
  } catch {
    Write-Log "ERROR: Service '$Name' not found. $_"
    return $false
  }

  if ($svc.Status -in @("StopPending", "StartPending", "ContinuePending", "PausePending")) {
    Write-Log "WARN: Service '$Name' is $($svc.Status). Waiting to stabilize..."
    $svc = Wait-ForServiceStableState -Name $Name -TimeoutSeconds 45

    if ($null -eq $svc) {
      Write-Log "ERROR: Service '$Name' disappeared while waiting."
      return $false
    }

    if ($AllowForceKillIfStopPending -and $svc.Status -eq "StopPending") {
      $pid = Get-ServicePid -Name $Name
      if ($pid -gt 0) {
        Write-Log "WARN: Service '$Name' stuck in StopPending. Killing PID $pid..."
        try {
          taskkill /PID $pid /F | Out-Null
          Start-Sleep -Seconds 2
          $svc = Wait-ForServiceStableState -Name $Name -TimeoutSeconds 15
        } catch {
          Write-Log "ERROR: Failed to kill PID $pid for '$Name'. $_"
          return $false
        }
      } else {
        Write-Log "ERROR: '$Name' stuck in StopPending but PID could not be determined."
        return $false
      }
    }
  }

  if ($svc.Status -ne "Running") {
    Write-Log "WARN: Service '$Name' is $($svc.Status). Attempting start..."
    try {
      Start-Service -Name $Name -ErrorAction Stop
      Write-Log "OK: Start-Service '$Name' issued."
      return $true
    } catch {
      Write-Log "ERROR: Failed to start '$Name'. $_"
      return $false
    }
  }

  return $true
}

function Test-HealthJsonOk {
  param([string]$Url, [int]$TimeoutSec = 6)

  try {
    $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    if ($resp.StatusCode -ne 200) { return $false }

    $json = $resp.Content | ConvertFrom-Json
    return ($null -ne $json -and $json.status -eq "ok")
  } catch {
    return $false
  }
}

if (-not (Test-Path $LogPath)) {
  New-Item -ItemType File -Force -Path $LogPath | Out-Null
}

# 1) Ensure backend service is running
$backendSvcRunning = Ensure-ServiceRunning -Name $BackendServiceName

# 2) Check local backend health; restart backend if unhealthy
$localHealthy = $false
if ($backendSvcRunning) {
  $localHealthy = Test-HealthJsonOk -Url $LocalHealthUrl -TimeoutSec 5
}

if (-not $localHealthy) {
  Write-Log "FAIL: Local backend health failed. Restarting '$BackendServiceName'..."
  try {
    Restart-Service -Name $BackendServiceName -Force -ErrorAction Stop
    Start-Sleep -Seconds 2
    $localHealthyAfter = Test-HealthJsonOk -Url $LocalHealthUrl -TimeoutSec 5
    if ($localHealthyAfter) {
      Write-Log "OK: Local backend recovered after restart."
      $localHealthy = $true
    } else {
      Write-Log "ERROR: Local backend still unhealthy after restart."
    }
  } catch {
    Write-Log "ERROR: Restart-Service failed for '$BackendServiceName'. $_"
  }
} else {
  Write-Log "OK: Local backend healthy."
}

# 3) Ensure tunnel service is running (allow StopPending recovery only for cloudflared)
$tunnelSvcRunning = Ensure-ServiceRunning -Name $TunnelServiceName -AllowForceKillIfStopPending

# 4) Public probe: only run if local is healthy and tunnel service is running
if ($localHealthy -and $tunnelSvcRunning) {
  $publicOk1 = Test-HealthJsonOk -Url $PublicHealthUrl -TimeoutSec 8
  if (-not $publicOk1) {
    Start-Sleep -Seconds 3
    $publicOk2 = Test-HealthJsonOk -Url $PublicHealthUrl -TimeoutSec 8

    if (-not $publicOk2) {
      Write-Log "FAIL: Public health failed twice. Restarting '$TunnelServiceName'..."
      try {
        Restart-Service -Name $TunnelServiceName -Force -ErrorAction Stop
        Write-Log "OK: Restart-Service '$TunnelServiceName' issued."
      } catch {
        Write-Log "ERROR: Restart-Service failed for '$TunnelServiceName'. $_"
      }
    } else {
      Write-Log "OK: Public health recovered on retry."
    }
  } else {
    Write-Log "OK: Public health OK."
  }
} else {
  if (-not $tunnelSvcRunning) {
    Write-Log "WARN: Tunnel service not running; attempted recovery above."
  }
  if (-not $localHealthy) {
    Write-Log "WARN: Skipping public probe because local backend is unhealthy."
  }
}
