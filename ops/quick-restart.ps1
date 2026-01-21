# Quick Restart Script - Run as Administrator
# This will restart your photo backend after npm install

Write-Host "=== Photo Backend Quick Restart ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Kill any existing node processes running the backend
Write-Host "[1/4] Stopping existing backend processes..." -ForegroundColor Yellow
$backendProcesses = Get-Process | Where-Object { 
    $_.ProcessName -eq 'node' -and 
    $_.Path -like '*photo-backend*' 
}

if ($backendProcesses) {
    $backendProcesses | ForEach-Object {
        Write-Host "  Killing process $($_.Id)" -ForegroundColor Gray
        Stop-Process -Id $_.Id -Force
    }
    Start-Sleep -Seconds 2
} else {
    Write-Host "  No backend processes found running" -ForegroundColor Gray
}

# Step 2: Check if port 3001 is still in use
Write-Host "[2/4] Checking port 3001..." -ForegroundColor Yellow
$port3001 = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($port3001) {
    $pid = $port3001.OwningProcess
    Write-Host "  Port 3001 is in use by PID $pid. Killing..." -ForegroundColor Red
    Stop-Process -Id $pid -Force
    Start-Sleep -Seconds 2
} else {
    Write-Host "  Port 3001 is free" -ForegroundColor Green
}

# Step 3: Start the backend
Write-Host "[3/4] Starting backend server..." -ForegroundColor Yellow
$backendPath = "C:\Users\bmilh\photo-backend"
Set-Location $backendPath

# Start in a new window so you can see logs
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backendPath'; node server.js"

Write-Host "  Backend starting in new window..." -ForegroundColor Green

# Step 4: Wait and verify
Write-Host "[4/4] Waiting for backend to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$healthCheck = try {
    Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -TimeoutSec 3 | Select-Object -ExpandProperty StatusCode
} catch {
    0
}

if ($healthCheck -eq 200) {
    Write-Host ""
    Write-Host "✅ SUCCESS! Backend is running and healthy" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Wait 30 seconds for tunnel to sync"
    Write-Host "2. Open: https://photos.milhizerfamilyphotos.org"
    Write-Host "3. Clear browser cache (Ctrl+Shift+Delete) if needed"
    Write-Host "4. Try signing in with Google"
} else {
    Write-Host ""
    Write-Host "❌ WARNING: Backend health check failed" -ForegroundColor Red
    Write-Host "Check the new PowerShell window for errors"
    Write-Host ""
    Write-Host "Common fixes:"
    Write-Host "- Make sure dependencies are installed: npm install"
    Write-Host "- Check backend.err.log for errors"
    Write-Host "- Verify firebase-service-account.json exists"
}

Write-Host ""
Write-Host "Backend logs location:" -ForegroundColor Gray
Write-Host "  $backendPath\logs\" -ForegroundColor Gray
Write-Host ""

Read-Host "Press Enter to exit"
