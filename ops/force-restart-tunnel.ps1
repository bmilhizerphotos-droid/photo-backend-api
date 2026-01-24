# Force restart cloudflared and clear all caches

Write-Host "=== Forcing Cloudflared Restart ===" -ForegroundColor Cyan

# Stop service
Write-Host "Stopping cloudflared service..." -ForegroundColor Yellow
Stop-Service cloudflared -Force
Start-Sleep -Seconds 3

# Kill any remaining processes
Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# Start service
Write-Host "Starting cloudflared service..." -ForegroundColor Yellow
Start-Service cloudflared
Start-Sleep -Seconds 5

# Test
Write-Host "`nTesting connection..." -ForegroundColor Cyan
try {
    $test = Invoke-WebRequest -Uri "https://api.milhizerfamilyphotos.org/health" -UseBasicParsing -TimeoutSec 10
    Write-Host "✅ PUBLIC API: $($test.StatusCode) OK" -ForegroundColor Green
} catch {
    Write-Host "❌ PUBLIC API: FAILED" -ForegroundColor Red
}

Write-Host "`n✅ Done! Wait 30 seconds, then refresh your browser" -ForegroundColor Green
Write-Host "If still not working, purge Cloudflare cache at:" -ForegroundColor Yellow
Write-Host "https://dash.cloudflare.com → Caching → Purge Everything" -ForegroundColor Cyan
Read-Host "`nPress Enter to exit"
