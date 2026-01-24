# Complete Backend Restart - Run as Administrator
# This stops ALL backend processes and starts fresh

Write-Host "=== Complete Backend Restart ===" -ForegroundColor Cyan
Write-Host ""

# Kill ALL node processes
Write-Host "[1/5] Stopping ALL Node.js processes..." -ForegroundColor Yellow
$nodeProcesses = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    $nodeProcesses | ForEach-Object {
        Write-Host "  Killing PID $($_.Id) - $($_.Path)" -ForegroundColor Gray
        Stop-Process -Id $_.Id -Force
    }
    Start-Sleep -Seconds 3
    Write-Host "  ✅ All Node processes stopped" -ForegroundColor Green
} else {
    Write-Host "  No Node processes running" -ForegroundColor Gray
}

# Clear port 3001
Write-Host "[2/5] Ensuring port 3001 is free..." -ForegroundColor Yellow
$port = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($port) {
    $pid = $port.OwningProcess
    Write-Host "  Port 3001 in use by PID $pid. Killing..." -ForegroundColor Red
    Stop-Process -Id $pid -Force
    Start-Sleep -Seconds 2
}
Write-Host "  ✅ Port 3001 is free" -ForegroundColor Green

# Navigate to backend directory
Write-Host "[3/5] Navigating to backend directory..." -ForegroundColor Yellow
$backendPath = "C:\Users\bmilh\photo-backend"
Set-Location $backendPath
Write-Host "  Current directory: $(Get-Location)" -ForegroundColor Gray

# Start fresh backend
Write-Host "[4/5] Starting backend with LATEST code..." -ForegroundColor Yellow
Write-Host "  Command: node server.js" -ForegroundColor Gray

# Start in new window with clear title
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$backendPath'; `$host.UI.RawUI.WindowTitle = 'Photo Backend Server (Port 3001)'; node server.js"
)

Write-Host "  ✅ Backend starting..." -ForegroundColor Green
Start-Sleep -Seconds 3

# Verify backend
Write-Host "[5/5] Verifying backend..." -ForegroundColor Yellow

# Check if port is listening
$listening = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    Write-Host "  ✅ Port 3001 is now listening" -ForegroundColor Green
} else {
    Write-Host "  ❌ Port 3001 is NOT listening" -ForegroundColor Red
    Write-Host "  Check the backend window for errors!" -ForegroundColor Yellow
}

# Test health endpoint
Start-Sleep -Seconds 2
try {
    $health = Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -TimeoutSec 3
    Write-Host "  ✅ Health check: OK ($($health.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Health check failed: $_" -ForegroundColor Red
}

# Test API endpoint WITHOUT auth (should fail with 401)
Write-Host ""
Write-Host "Testing authentication..." -ForegroundColor Yellow
try {
    $apiTest = Invoke-WebRequest -Uri "http://localhost:3001/api/photos?limit=1" -UseBasicParsing -TimeoutSec 3
    Write-Host "  ❌ WARNING: API responded without authentication! Status: $($apiTest.StatusCode)" -ForegroundColor Red
    Write-Host "  This means the old code is still running!" -ForegroundColor Red
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 401) {
        Write-Host "  ✅ Authentication is working! Got 401 Unauthorized (expected)" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Got status code: $statusCode" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Backend restart complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Verify authentication is working (should show 401 above)"
Write-Host "2. Now restart cloudflared:"
Write-Host "   C:\Users\bmilh\photo-backend\ops\restart-cloudflared.ps1"
Write-Host "3. Wait 30 seconds"
Write-Host "4. Try https://photos.milhizerfamilyphotos.org"
Write-Host ""

Read-Host "Press Enter to exit"
