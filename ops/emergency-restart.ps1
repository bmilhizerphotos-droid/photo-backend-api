# Emergency Backend Restart

Write-Host "=== EMERGENCY BACKEND RESTART ===" -ForegroundColor Red
Write-Host ""

# 1. Kill ALL node processes
Write-Host "[1/4] Killing all Node.js processes..." -ForegroundColor Yellow
Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  Killing PID $($_.Id)" -ForegroundColor Gray
    Stop-Process -Id $_.Id -Force
}
Start-Sleep -Seconds 2

# 2. Verify npm packages are installed
Write-Host "[2/4] Checking npm packages..." -ForegroundColor Yellow
cd C:\Users\bmilh\photo-backend

if (-not (Test-Path "node_modules\sqlite")) {
    Write-Host "  Installing missing packages..." -ForegroundColor Yellow
    npm install
}

# 3. Start backend
Write-Host "[3/4] Starting backend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd C:\Users\bmilh\photo-backend; `$host.UI.RawUI.WindowTitle = 'Photo Backend (Port 3001)'; node server.js"

Write-Host "  Waiting for startup..." -ForegroundColor Gray
Start-Sleep -Seconds 5

# 4. Test
Write-Host "[4/4] Testing backend..." -ForegroundColor Yellow
try {
    $test = Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "  ✅ Backend is responding! Status: $($test.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Backend not responding: $_" -ForegroundColor Red
    Write-Host "  Check the backend window for errors!" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done! Now refresh your browser: Ctrl+Shift+R" -ForegroundColor Cyan
Read-Host "Press Enter to exit"
