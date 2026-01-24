# Complete Cloudflare Tunnel Reset

Write-Host "=== COMPLETE TUNNEL RESET ===" -ForegroundColor Red

# 1. Stop service
Write-Host "[1/5] Stopping cloudflared service..." -ForegroundColor Yellow
Stop-Service cloudflared -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# 2. Kill processes
Write-Host "[2/5] Killing cloudflared processes..." -ForegroundColor Yellow
Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# 3. Start service
Write-Host "[3/5] Starting cloudflared service..." -ForegroundColor Yellow
Start-Service cloudflared
Start-Sleep -Seconds 10

# 4. Test
Write-Host "[4/5] Testing tunnel..." -ForegroundColor Yellow
$retries = 0
$maxRetries = 6
$success = $false

while ($retries -lt $maxRetries -and -not $success) {
    try {
        $test = Invoke-WebRequest -Uri "https://api.milhizerfamilyphotos.org/health" -UseBasicParsing -TimeoutSec 5
        Write-Host "✅ Tunnel working! Status: $($test.StatusCode)" -ForegroundColor Green
        $success = $true
    } catch {
        $retries++
        Write-Host "  Retry $retries/$maxRetries..." -ForegroundColor Gray
        Start-Sleep -Seconds 5
    }
}

if (-not $success) {
    Write-Host "❌ Tunnel failed to connect after $maxRetries retries" -ForegroundColor Red
    exit 1
}

# 5. Test /image route
Write-Host "[5/5] Testing /image route..." -ForegroundColor Yellow
try {
    Invoke-WebRequest -Uri "https://api.milhizerfamilyphotos.org/image/1?token=test" -UseBasicParsing -TimeoutSec 10 | Out-Null
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 403) {
        Write-Host "✅ /image route working! (403 = needs auth)" -ForegroundColor Green
    } else {
        Write-Host "⚠️  /image returns: $status" -ForegroundColor Yellow
    }
}

Write-Host "`n✅ Done! Now:" -ForegroundColor Cyan
Write-Host "1. Wait 30 seconds" -ForegroundColor White
Write-Host "2. Go to Cloudflare Dashboard and PURGE CACHE" -ForegroundColor White
Write-Host "3. Refresh browser and test" -ForegroundColor White

Read-Host "`nPress Enter to exit"
