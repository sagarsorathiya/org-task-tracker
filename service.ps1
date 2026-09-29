param(
    [Parameter(Position=0)]
    [ValidateSet('install','uninstall','start','stop','restart','status')]
    [string]$Action = 'install'
)

$ServiceName  = 'OrgTaskTracker'
$DisplayName  = 'Org Task Tracker'
$AppDir       = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$_nodeCmd     = Get-Command node -ErrorAction SilentlyContinue
$NodeExe      = if ($_nodeCmd) { $_nodeCmd.Source } else { $null }
$_nssmCmd     = Get-Command nssm -ErrorAction SilentlyContinue
$NssmExe      = if ($_nssmCmd) { $_nssmCmd.Source } else { $null }

function Require-Admin {
    if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]'Administrator')) {
        Write-Host "[ERROR] Run this script as Administrator." -ForegroundColor Red
        exit 1
    }
}

function Find-Nssm {
    if ($NssmExe) { return $NssmExe }
    $candidates = @(
        "$AppDir\tools\nssm.exe",
        "C:\Windows\System32\nssm.exe",
        "C:\tools\nssm.exe",
        "C:\nssm\nssm.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    Write-Host "[ERROR] nssm.exe not found." -ForegroundColor Red
    Write-Host "  Download from https://nssm.cc/download and place in $AppDir\tools\nssm.exe" -ForegroundColor Yellow
    exit 1
}

switch ($Action) {

    'install' {
        Require-Admin
        $nssm = Find-Nssm
        if (-not $NodeExe) { Write-Host "[ERROR] node.exe not found in PATH." -ForegroundColor Red; exit 1 }

        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($svc) {
            Write-Host "[INFO] Service '$ServiceName' already exists. Use 'restart' or 'uninstall' first." -ForegroundColor Yellow
            exit 0
        }

        $LogDir = Join-Path $AppDir 'logs'
        New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

        # Install dependencies if node_modules is missing
        $NodeModules = Join-Path $AppDir 'node_modules'
        if (-not (Test-Path $NodeModules)) {
            Write-Host "Installing dependencies (npm install --omit=dev)..." -ForegroundColor Cyan
            $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
            if (-not $npmCmd) { Write-Host "[ERROR] npm not found in PATH." -ForegroundColor Red; exit 1 }
            Push-Location $AppDir
            & $npmCmd.Source install --omit=dev
            Pop-Location
            if ($LASTEXITCODE -ne 0) { Write-Host "[ERROR] npm install failed." -ForegroundColor Red; exit 1 }
            Write-Host "Dependencies installed." -ForegroundColor Green
        }

        $ServerJs = Join-Path $AppDir 'server.js'
        if (-not (Test-Path $ServerJs)) { Write-Host "[ERROR] server.js not found in $AppDir" -ForegroundColor Red; exit 1 }

        Write-Host "Installing service '$ServiceName'..." -ForegroundColor Cyan
        & $nssm install $ServiceName $NodeExe
        & $nssm set $ServiceName AppDirectory $AppDir
        & $nssm set $ServiceName AppParameters "`"$ServerJs`""
        & $nssm set $ServiceName DisplayName $DisplayName
        & $nssm set $ServiceName Description "Organization Activity Tracker - Node.js app"
        & $nssm set $ServiceName Start SERVICE_AUTO_START
        & $nssm set $ServiceName AppStdout (Join-Path $LogDir 'stdout.log')
        & $nssm set $ServiceName AppStderr (Join-Path $LogDir 'stderr.log')
        & $nssm set $ServiceName AppRotateFiles 1
        & $nssm set $ServiceName AppRotateOnline 1
        & $nssm set $ServiceName AppRotateBytes 10485760
        & $nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production"

        Write-Host "Starting service..." -ForegroundColor Cyan
        & $nssm start $ServiceName

        Write-Host ""
        Write-Host "Service '$ServiceName' installed and started." -ForegroundColor Green
        Write-Host "  Logs : $LogDir" -ForegroundColor Gray
        Write-Host "  Stop : npm run service:stop" -ForegroundColor Gray
        Write-Host "  Restart: npm run service:restart" -ForegroundColor Gray
        break
    }

    'uninstall' {
        Require-Admin
        $nssm = Find-Nssm
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $svc) { Write-Host "[INFO] Service '$ServiceName' not found." -ForegroundColor Yellow; exit 0 }

        Write-Host "Stopping and removing service '$ServiceName'..." -ForegroundColor Cyan
        & $nssm stop $ServiceName
        & $nssm remove $ServiceName confirm
        Write-Host "Service removed." -ForegroundColor Green
        break
    }

    'start' {
        Require-Admin
        $nssm = Find-Nssm
        Write-Host "Starting '$ServiceName'..." -ForegroundColor Cyan
        & $nssm start $ServiceName
        break
    }

    'stop' {
        Require-Admin
        $nssm = Find-Nssm
        Write-Host "Stopping '$ServiceName'..." -ForegroundColor Cyan
        & $nssm stop $ServiceName
        break
    }

    'restart' {
        Require-Admin
        $nssm = Find-Nssm
        Write-Host "Restarting '$ServiceName'..." -ForegroundColor Cyan
        & $nssm restart $ServiceName
        break
    }

    'status' {
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($svc) {
            Write-Host "Service '$ServiceName': $($svc.Status)" -ForegroundColor Cyan
        } else {
            Write-Host "Service '$ServiceName': Not installed" -ForegroundColor Yellow
        }
        break
    }
}