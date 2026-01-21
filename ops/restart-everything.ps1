# restart-everything.ps1
# Save at: C:\Users\bmilh\photo-backend\ops\restart-everything.ps1
# Run in PowerShell (preferably "Run as Administrator")

$ErrorActionPreference = "Stop"

# ---------------------------
# CONFIG (EDIT IF NEEDED)
# ---------------------------

$RepoRoot    = "C:\Users\bmilh\photo-backend"
$BackendDir  = "C:\Users\bmilh\photo-backend"
$FrontendDir = "C:\Users\bmilh\photo-backend\frontend"

# Backend server listens on port 3001
$BackendPort  = 3001
$FrontendPort = 5173

# Cloudflared tunnel - not used for local port binding
$TunnelPort   = 0  # Not applicable for cloudflared

$KillAllNodeExe        = $true
$KillAllCloudflaredExe = $true

$StartBackend  = $true
$StartFrontend = $true
$StartTunnel   = $false  # keep false until you paste your real command

$BackendStart  = "node server.js"
$FrontendStart = "npm run dev"
$TunnelStart   = "cloudflared tunnel run YOUR_TUNNEL_NAME"

# ---------------------------
# UTILITIES
# ---------------------------

function Write-Step($msg) {
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host ""
  Write-Host "[$ts] $msg"
}

function Pause-Here($msg) {
  Write-Host ""
  Read-Host $msg | Out-Null
}

function Get-PidsListeningOnPort([int]$Port) {
  $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $conns) { return @() }
  return $conns | Select-Object -ExpandProperty OwningProcess -Unique
}

function Stop-Pids([int[]]$Pids, [string]$Reason) {
  foreach ($procId in $Pids) {
    try {
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($p) {
        Write-Host "Stopping PID=$procId ($($p.ProcessName)) - $Reason"
        Stop-Process -Id $procId -Force -ErrorAction Stop
      }
    } catch {
      Write-Host "WARN: Could not stop PID=$procId ($Reason)."
      Write-Host "      $($_.Exception.Message)"
    }
  }
}

function Kill-ByPort([int]$Port) {
  $pids = Get-PidsListeningOnPort -Port $Port
  if ($pids.Count -eq 0) {
    Write-Host "No listener found on port $Port"
    return
  }
  Stop-Pids -Pids $pids -Reason "Listening on port $Port"
}

function Ensure-PortFree([int]$Port, [int]$Attempts = 8) {
  for ($i = 1; $i -le $Attempts; $i++) {
    $pids = Get-PidsListeningOnPort -Port $Port
    if ($pids.Count -eq 0) {
      Write-Host "Port $Port is free."
      return $true
    }

    Write-Host "Port $Port is in use by PID(s): $($pids -join ', '). Attempt $i/$Attempts"
    Stop-Pids -Pids $pids -Reason "Freeing port $Port"
    Start-Sleep -Milliseconds 300
  }

  Write-Host "Fallback: taskkill node.exe / cloudflared.exe to free port $Port (if configured)."
  if ($KillAllNodeExe)        { cmd.exe /c "taskkill /F /IM node.exe 2>nul" | Out-Null }
  if ($KillAllCloudflaredExe) { cmd.exe /c "taskkill /F /IM cloudflared.exe 2>nul" | Out-Null }

  Start-Sleep -Seconds 1
  return (Get-PidsListeningOnPort -Port $Port).Count -eq 0
}

function Start-CommandInNewWindow([string]$WorkingDir, [string]$Title, [string]$Command) {
  Write-Host "Starting: $Title"
  Write-Host "  Dir: $WorkingDir"
  Write-Host "  Cmd: $Command"
  $cmd = "cd /d `"$WorkingDir`" && title $Title && $Command"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $cmd -WorkingDirectory $WorkingDir | Out-Null
}

function Wait-ForListening([int]$Port, [int]$TimeoutSeconds = 60) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    if ((Get-PidsListeningOnPort -Port $Port).Count -gt 0) { return $true }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

# ---------------------------
# MAIN
# ---------------------------

Write-Step "Restart sequence BEGIN"

Write-Step "1) Stopping anything listening on ports: backend=$BackendPort, frontend=$FrontendPort"
Kill-ByPort -Port $BackendPort
Kill-ByPort -Port $FrontendPort
if ($TunnelPort -gt 0) {
  Kill-ByPort -Port $TunnelPort
}

Write-Step "2) Ensuring ports are actually FREE (backend is most critical)"
$okBackend = Ensure-PortFree -Port $BackendPort -Attempts 10
$okFront   = Ensure-PortFree -Port $FrontendPort -Attempts 5
# Tunnel port check skipped (not used for local binding)

if (-not $okBackend) {
  Write-Host "ERROR: Port $BackendPort is still in use after repeated attempts."
  Write-Host "Run this to see who owns it:"
  Write-Host "  netstat -ano | findstr :$BackendPort"
  Pause-Here "Press ENTER to exit."
  exit 1
}

Pause-Here "Ports cleared. Press ENTER to start backend."

if ($StartBackend) {
  Write-Step "3) Starting BACKEND (expects to listen on $BackendPort)"
  Start-CommandInNewWindow -WorkingDir $BackendDir -Title "PHOTO BACKEND" -Command $BackendStart

  Write-Step "Waiting for backend port $BackendPort to be listening..."
  if (-not (Wait-ForListening -Port $BackendPort -TimeoutSeconds 60)) {
    Write-Host "ERROR: Backend did not start listening on $BackendPort."
    Write-Host "Check the 'PHOTO BACKEND' window for the crash/error text."
    Pause-Here "Press ENTER to exit."
    exit 1
  }
  Write-Host "Backend is listening on $BackendPort."
}

Pause-Here "Press ENTER to start frontend."

if ($StartFrontend) {
  Write-Step "4) Starting FRONTEND (expects to listen on $FrontendPort)"
  Start-CommandInNewWindow -WorkingDir $FrontendDir -Title "PHOTO FRONTEND" -Command $FrontendStart

  Write-Step "Waiting for frontend port $FrontendPort to be listening..."
  if (-not (Wait-ForListening -Port $FrontendPort -TimeoutSeconds 60)) {
    Write-Host "ERROR: Frontend did not start listening on $FrontendPort."
    Write-Host "Check the 'PHOTO FRONTEND' window for the crash/error text."
    Pause-Here "Press ENTER to exit."
    exit 1
  }
  Write-Host "Frontend is listening on $FrontendPort."
}

Pause-Here "Press ENTER to start cloudflared (if enabled)."

if ($StartTunnel) {
  Write-Step "5) Starting CLOUDFLARED"
  Start-CommandInNewWindow -WorkingDir $RepoRoot -Title "CLOUDFLARED" -Command $TunnelStart
}

Write-Step "Restart sequence DONE"
Write-Host ""
Write-Host "Open these:"
Write-Host "  Frontend: http://localhost:$FrontendPort/"
Write-Host "  Backend:  http://localhost:$BackendPort/health"
Pause-Here "All done. Press ENTER to exit."
