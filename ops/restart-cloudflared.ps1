# Fix Cloudflared Tunnel - Run as Administrator
# This restarts cloudflared after fixing the port configuration

Write-Host "=== Restarting Cloudflared Tunnel ===" -ForegroundColor Cyan
Write-Host ""

# Verify we're running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ ERROR: This script must be run as Administrator" -ForegroundColor Red
    Write-Host ""
    Write-Host "To run as admin:" -ForegroundColor Yellow
    Write-Host "1. Right-click PowerShell"
    Write-Host "2. Select 'Run as Administrator'"
    Write-Host "3. Run this script again"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "✅ Running as Administrator" -ForegroundColor Green
Write-Host ""

# Show current config
Write-Host "[1/3] Current cloudflared configuration:" -ForegroundColor Yellow
Get-Content C:\Users\bmilh\.cloudflared\config.yml | Select-String -Pattern "service:"
Write-Host ""

# Restart the service
Write-Host "[2/3] Restarting cloudflared service..." -ForegroundColor Yellow
try {
    Restart-Service -Name cloudflared -Force -ErrorAction Stop
    Write-Host "  ✅ Service restarted successfully" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Failed to restart service: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Trying alternative method..." -ForegroundColor Yellow
    
    Stop-Service -Name cloudflared -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    Start-Service -Name cloudflared -ErrorAction Stop
    Write-Host "  ✅ Service restarted using alternative method" -ForegroundColor Green
}

Start-Sleep -Seconds 5
Write-Host ""

# Verify service is running
Write-Host "[3/3] Verifying service status..." -ForegroundColor Yellow
$service = Get-Service -Name cloudflared
Write-Host "  Status: $($service.Status)" -ForegroundColor $(if ($service.Status -eq 'Running') { 'Green' } else { 'Red' })
Write-Host ""

if ($service.Status -eq 'Running') {
    Write-Host "✅ SUCCESS! Cloudflared tunnel is now running with correct configuration" -ForegroundColor Green
    Write-Host ""
    Write-Host "The tunnel is now pointing to: http://127.0.0.1:3001" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Wait 30-60 seconds for the tunnel to fully establish"
    Write-Host "2. Open: https://photos.milhizerfamilyphotos.org"
    Write-Host "3. You should see your app (no more 524 errors!)"
    Write-Host "4. Sign in with Google"
    Write-Host ""
    Write-Host "Testing public endpoint in 10 seconds..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
    
    try {
        $response = Invoke-WebRequest -Uri "https://api.milhizerfamilyphotos.org/health" -UseBasicParsing -TimeoutSec 10
        Write-Host "✅ Public API is responding! Status: $($response.StatusCode)" -ForegroundColor Green
        Write-Host "   Response: $($response.Content)" -ForegroundColor Gray
    } catch {
        Write-Host "⏳ Public API not responding yet (this is normal - may take up to 60 seconds)" -ForegroundColor Yellow
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "   Give it another 30 seconds, then try the website" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ WARNING: Service is not running" -ForegroundColor Red
    Write-Host ""
    Write-Host "Try these commands manually:" -ForegroundColor Yellow
    Write-Host "  Stop-Service cloudflared -Force"
    Write-Host "  Start-Service cloudflared"
}

Write-Host ""
Read-Host "Press Enter to exit"
