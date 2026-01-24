# Force Restart Cloudflared - Must Run as Administrator
# This will kill the cloudflared process and restart the service

Write-Host "=== Force Restart Cloudflared Tunnel ===" -ForegroundColor Cyan
Write-Host ""

# Check if admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ ERROR: Must run as Administrator" -ForegroundColor Red
    Write-Host ""
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "✅ Running as Administrator" -ForegroundColor Green
Write-Host ""

# Step 1: Kill cloudflared processes
Write-Host "[1/4] Killing existing cloudflared processes..." -ForegroundColor Yellow
$cfProcs = Get-Process | Where-Object {$_.ProcessName -like '*cloudflared*'}
if ($cfProcs) {
    $cfProcs | ForEach-Object {
        Write-Host "  Killing PID $($_.Id)" -ForegroundColor Gray
        Stop-Process -Id $_.Id -Force
    }
    Start-Sleep -Seconds 2
    Write-Host "  ✅ Processes killed" -ForegroundColor Green
} else {
    Write-Host "  No processes found" -ForegroundColor Gray
}

# Step 2: Stop the service
Write-Host "[2/4] Stopping cloudflared service..." -ForegroundColor Yellow
try {
    Stop-Service -Name cloudflared -Force -ErrorAction Stop
    Start-Sleep -Seconds 2
    Write-Host "  ✅ Service stopped" -ForegroundColor Green
} catch {
    Write-Host "  ⚠️  Service stop failed: $_" -ForegroundColor Yellow
}

# Step 3: Start the service with fresh config
Write-Host "[3/4] Starting cloudflared service..." -ForegroundColor Yellow
try {
    Start-Service -Name cloudflared -ErrorAction Stop
    Start-Sleep -Seconds 5
    Write-Host "  ✅ Service started" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Service start failed: $_" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Step 4: Verify it's connected to port 3001
Write-Host "[4/4] Verifying tunnel connection..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$cfProc = Get-Process | Where-Object {$_.ProcessName -like '*cloudflared*'} | Select-Object -First 1
if ($cfProc) {
    Write-Host "  Cloudflared PID: $($cfProc.Id)" -ForegroundColor Gray
    
    $connections = Get-NetTCPConnection | Where-Object {$_.OwningProcess -eq $cfProc.Id}
    Write-Host "  Connections:" -ForegroundColor Gray
    $connections | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State | Format-Table
    
    # Check if connected to port 3001
    $port3001 = $connections | Where-Object {$_.RemotePort -eq 3001}
    if ($port3001) {
        Write-Host "  ✅ SUCCESS! Connected to port 3001" -ForegroundColor Green
    } else {
        $port3000 = $connections | Where-Object {$_.RemotePort -eq 3000}
        if ($port3000) {
            Write-Host "  ❌ ERROR: Still connected to port 3000!" -ForegroundColor Red
            Write-Host "  The config file may not have been saved correctly." -ForegroundColor Yellow
            Write-Host ""
            Write-Host "  Current config:" -ForegroundColor Yellow
            Get-Content C:\Users\bmilh\.cloudflared\config.yml
        } else {
            Write-Host "  ⚠️  Not connected to backend yet (may take up to 30 seconds)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  ❌ No cloudflared process running!" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host "1. Wait 30 seconds for tunnel to fully establish" -ForegroundColor Yellow
Write-Host "2. Test: Invoke-WebRequest -Uri 'https://api.milhizerfamilyphotos.org/health'" -ForegroundColor Yellow
Write-Host "3. Open: https://photos.milhizerfamilyphotos.org" -ForegroundColor Yellow
Write-Host ""

Read-Host "Press Enter to exit"
