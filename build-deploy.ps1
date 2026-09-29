param(
    [switch]$SkipBuild,
    [string]$OutputDir = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$AppRoot  = $PSScriptRoot
$AppName  = 'org-task-tracker'
$ZipName  = "$AppName-$(Get-Date -Format 'yyyyMMdd-HHmm').zip"
$ZipPath  = Join-Path $OutputDir $ZipName
$TempDir  = Join-Path $env:TEMP "deploy-$AppName-$(Get-Random)"

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "    [FAIL] $msg" -ForegroundColor Red; exit 1 }

# --- 1. Prerequisites ---
Write-Step "Checking prerequisites"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Fail "node.exe not found in PATH" }
Write-OK "Node $(node -v)"
if (-not (Test-Path (Join-Path $AppRoot 'package.json'))) { Write-Fail "Run from project root" }

# --- 2. Build ---
if (-not $SkipBuild) {
    Write-Step "Running npm run build"
    Push-Location $AppRoot
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Fail "npm run build failed (exit $LASTEXITCODE)" }
    Pop-Location
    Write-OK "Build complete"
} else {
    Write-Step "Skipping build (-SkipBuild flag set)"
    if (-not (Test-Path (Join-Path $AppRoot '.next'))) { Write-Fail ".next not found - run without -SkipBuild first" }
}

# --- 3. Validate build ---
Write-Step "Validating build output"
if (-not (Test-Path (Join-Path $AppRoot '.next\server'))) { Write-Fail ".next\server not found" }
if (-not (Test-Path (Join-Path $AppRoot '.next\static'))) { Write-Fail ".next\static not found" }
Write-OK ".next\server and .next\static present"

# --- 4. Stage files ---
Write-Step "Staging files to: $TempDir"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$rootFiles = @('package.json','package-lock.json','server.js','next.config.js','.env.example','service.ps1')
foreach ($file in $rootFiles) {
    $src = Join-Path $AppRoot $file
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $TempDir $file)
        Write-OK "Copied $file"
    } else {
        Write-Host "    [SKIP] $file not found" -ForegroundColor Yellow
    }
}

# --- 5. Copy .next (exclude cache) ---
Write-Step "Copying .next (excluding cache)"
$nextDest = Join-Path $TempDir '.next'
New-Item -ItemType Directory -Force -Path $nextDest | Out-Null

Get-ChildItem -Path (Join-Path $AppRoot '.next') -File | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $nextDest $_.Name)
}

Copy-Item -Recurse -Force (Join-Path $AppRoot '.next\server') (Join-Path $nextDest 'server')
Write-Host "    Copied .next\server" -ForegroundColor Gray

Copy-Item -Recurse -Force (Join-Path $AppRoot '.next\static') (Join-Path $nextDest 'static')
Write-Host "    Copied .next\static" -ForegroundColor Gray

Write-OK ".next staged (cache excluded)"

# --- 6. Copy src\db ---
Write-Step "Copying src\db"
$dbDest = Join-Path $TempDir 'src\db'
New-Item -ItemType Directory -Force -Path $dbDest | Out-Null
foreach ($sqlFile in @('schema.sql','seed.sql')) {
    $src = Join-Path $AppRoot "src\db\$sqlFile"
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $dbDest $sqlFile)
        Write-OK "Copied src\db\$sqlFile"
    }
}

# --- 7. uploads placeholder ---
$uploadsDest = Join-Path $TempDir 'uploads'
New-Item -ItemType Directory -Force -Path $uploadsDest | Out-Null
"" | Set-Content (Join-Path $uploadsDest '.gitkeep')
Write-OK "uploads\ placeholder created"

# --- 8. logs placeholder ---
$logsDest = Join-Path $TempDir 'logs'
New-Item -ItemType Directory -Force -Path $logsDest | Out-Null
"" | Set-Content (Join-Path $logsDest '.gitkeep')
Write-OK "logs\ placeholder created"

# --- 9. IIS public_iis + web.config ---
Write-Step "Creating IIS web.config"
$iisDir = Join-Path $TempDir 'public_iis'
New-Item -ItemType Directory -Force -Path $iisDir | Out-Null

$webConfigContent = '<?xml version="1.0" encoding="UTF-8"?>' + "`r`n" +
'<configuration>' + "`r`n" +
'  <system.webServer>' + "`r`n" +
'    <httpProtocol>' + "`r`n" +
'      <customHeaders>' + "`r`n" +
'        <remove name="X-Powered-By" />' + "`r`n" +
'        <add name="X-Frame-Options" value="DENY" />' + "`r`n" +
'        <add name="X-Content-Type-Options" value="nosniff" />' + "`r`n" +
'        <add name="Referrer-Policy" value="strict-origin-when-cross-origin" />' + "`r`n" +
'      </customHeaders>' + "`r`n" +
'    </httpProtocol>' + "`r`n" +
'    <security>' + "`r`n" +
'      <requestFiltering>' + "`r`n" +
'        <requestLimits maxAllowedContentLength="52428800" />' + "`r`n" +
'      </requestFiltering>' + "`r`n" +
'    </security>' + "`r`n" +
'    <rewrite>' + "`r`n" +
'      <rules>' + "`r`n" +
'        <rule name="ReverseProxyToNode" stopProcessing="true">' + "`r`n" +
'          <match url="(.*)" />' + "`r`n" +
'          <conditions>' + "`r`n" +
'            <add input="{CACHE_URL}" pattern="^(.*)" />' + "`r`n" +
'          </conditions>' + "`r`n" +
'          <action type="Rewrite" url="http://localhost:4000/{R:1}" />' + "`r`n" +
'        </rule>' + "`r`n" +
'      </rules>' + "`r`n" +
'      <outboundRules>' + "`r`n" +
'        <rule name="RewriteLocationHeader" preCondition="IsRedirect">' + "`r`n" +
'          <match serverVariable="RESPONSE_Location" pattern="^http://localhost:4000/(.*)" />' + "`r`n" +
'          <action type="Rewrite" value="/{R:1}" />' + "`r`n" +
'        </rule>' + "`r`n" +
'        <preConditions>' + "`r`n" +
'          <preCondition name="IsRedirect">' + "`r`n" +
'            <add input="{RESPONSE_STATUS}" pattern="^3" />' + "`r`n" +
'          </preCondition>' + "`r`n" +
'        </preConditions>' + "`r`n" +
'      </outboundRules>' + "`r`n" +
'    </rewrite>' + "`r`n" +
'    <webSocket enabled="false" />' + "`r`n" +
'  </system.webServer>' + "`r`n" +
'</configuration>'

$webConfigContent | Set-Content (Join-Path $iisDir 'web.config') -Encoding UTF8
Write-OK "public_iis\web.config created"

# --- 10. Create zip ---
Write-Step "Creating zip: $ZipPath"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal
Write-OK "Zip created"

$zipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "    Size: $([math]::Round($zipSize, 1)) MB" -ForegroundColor White

# --- 11. Cleanup ---
Write-Step "Cleaning up temp folder"
Remove-Item -Recurse -Force $TempDir
Write-OK "Done"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Deployment zip ready:" -ForegroundColor Cyan
Write-Host "  $ZipPath" -ForegroundColor White
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Copy the zip to the server" -ForegroundColor Gray
Write-Host "  2. Extract to C:\apps\org-task-tracker\" -ForegroundColor Gray
Write-Host "  3. Follow DEPLOYMENT.md" -ForegroundColor Gray
Write-Host ""