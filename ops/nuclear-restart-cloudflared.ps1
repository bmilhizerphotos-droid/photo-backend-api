# Nuclear Restart Cloudflared - Run as Administrator
# This completely kills cloudflared and forces a clean restart

Write-Host "=== NUCLEAR RESTART CLOUDFLARED ===" -ForegroundColor Red
Write-Host ""

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "❌ Must run as Administrator!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[1/6] Stopping NSSM service..." -ForegroundColor Yellow
try {
    & "C:\Tools\nssm\win64\nssm.exe" stop cloudflared
    Start-Sleep -Seconds 3
    Write-Host "  ✅ Service stopped via NSSM" -ForegroundColor Green
} catch {
    Write-Host "  ⚠️  NSSM stop failed: $_" -ForegroundColor Yellow
}

Write-Host "[2/6] Killing all cloudflared processes..." -ForegroundColor Yellow
$killed = 0
do {
    $procs = Get-Process | Where-Object {$_.ProcessName -like '*cloudflared*'}
    if ($procs) {
        $procs | ForEach-Object {
            Write-Host "  Killing PID $($_.Id)" -ForegroundColor Gray
            Stop-Process -Id $_.Id -Force
            $killed++
        }
        Start-Sleep -Seconds 1
    }
} while ($procs)

if ($killed -gt 0) {
    Write-Host "  ✅ Killed $killed process(es)" -ForegroundColor Green
} else {
    Write-Host "  No processes to kill" -ForegroundColor Gray
}

Write-Host "[3/6] Verifying all processes are dead..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
$remaining = Get-Process | Where-Object {$_.ProcessName -like '*cloudflared*'}
if ($remaining) {
    Write-Host "  ❌ Some processes still running! Force killing..." -ForegroundColor Red
    $remaining | ForEach-Object {
        taskkill /F /PID $_.Id
    }
} else {
    Write-Host "  ✅ All processes terminated" -ForegroundColor Green
}

Write-Host "[4/6] Verifying config file..." -ForegroundColor Yellow
$config = Get-Content "C:\Users\bmilh\.cloudflared\config.yml" -Raw
if ($config -match "service: http://127.0.0.1:3001") {
    Write-Host "  ✅ Config points to port 3001" -ForegroundColor Green
} else {
    Write-Host "  ❌ Config DOES NOT point to port 3001!" -ForegroundColor Red
    Write-Host $config
    Read-Host "Fix config and press Enter to continue"
}

Write-Host "[5/6] Starting service..." -ForegroundColor Yellow
try {
    & "C:\Tools\nssm\win64\nssm.exe" start cloudflared
    Write-Host "  ✅ Service start command sent" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Failed: $_" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "  Waiting 10 seconds for startup..." -ForegroundColor Gray
Start-Sleep -Seconds 10

Write-Host "[6/6] Verifying connection..." -ForegroundColor Yellow
$cfProc = Get-Process | Where-Object {$_.ProcessName -like '*cloudflared*'} | Select-Object -First 1

if (-not $cfProc) {
    Write-Host "  ❌ No cloudflared process running!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check service status:" -ForegroundColor Yellow
    Write-Host "  & 'C:\Tools\nssm\win64\nssm.exe' status cloudflared" -ForegroundColor Gray
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "  Cloudflared PID: $($cfProc.Id)" -ForegroundColor Gray
Start-Sleep -Seconds 5

$connections = Get-NetTCPConnection | Where-Object {$_.OwningProcess -eq $cfProc.Id}
Write-Host "  Connections:" -ForegroundColor Gray
$connections | Select-Object LocalPort, RemoteAddress, RemotePort, State | Format-Table -AutoSize

$port3001 = $connections | Where-Object {$_.RemotePort -eq 3001}
$port3000 = $connections | Where-Object {$_.RemotePort -eq 3000}

if ($port3001) {
    Write-Host ""
    Write-Host "✅✅✅ SUCCESS! Connected to port 3001! ✅✅✅" -ForegroundColor Green
    Write-Host ""
    Write-Host "Tunnel should be working now. Testing public endpoint..." -ForegroundColor Cyan
    Start-Sleep -Seconds 5
    
    try {
        $test = Invoke-WebRequest -Uri "https://api.milhizerfamilyphotos.org/health" -UseBasicParsing -TimeoutSec 10
        Write-Host "✅ Public API is responding! Status: $($test.StatusCode)" -ForegroundColor Green
        Write-Host "Response: $($test.Content)" -ForegroundColor Gray
    } catch {
        Write-Host "⚠️  Public endpoint test failed (may need more time): $_" -ForegroundColor Yellow
        Write-Host "Wait another 30 seconds and try the website" -ForegroundColor Yellow
    }
    
} elseif ($port3000) {
    Write-Host ""
    Write-Host "❌❌❌ STILL CONNECTED TO PORT 3000! ❌❌❌" -ForegroundColor Red
    Write-Host ""
    Write-Host "This means cloudflared is ignoring the config file." -ForegroundColor Yellow
    Write-Host "There may be a Cloudflare dashboard setting overriding the local config." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Next step: Check Cloudflare Zero Trust dashboard" -ForegroundColor Cyan
    Write-Host "  1. Go to: https://one.dash.cloudflare.com/" -ForegroundColor Gray
    Write-Host "  2. Navigate to Networks > Tunnels" -ForegroundColor Gray
    Write-Host "  3. Find tunnel: 5db58dac-62ec-49ba-a18a-1ceb80c74974" -ForegroundColor Gray
    Write-Host "  4. Check the configured public hostname settings" -ForegroundColor Gray
    Write-Host "  5. Ensure api.milhizerfamilyphotos.org points to http://localhost:3001" -ForegroundColor Gray
    
} else {
    Write-Host ""
    Write-Host "⚠️  Not connected to backend yet" -ForegroundColor Yellow
    Write-Host "Wait 30 seconds and check again" -ForegroundColor Yellow
}

Write-Host ""
Read-Host "Press Enter to exit"
