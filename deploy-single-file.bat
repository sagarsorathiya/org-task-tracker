@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Usage:
REM deploy-single-file.bat [zipPath] [targetDir] [serviceName]
REM Example:
REM deploy-single-file.bat D:\\drop\\org-task-tracker-production.zip C:\\apps\\org-task-tracker OrgTaskTracker

set "ZIP_PATH=%~1"
if "%ZIP_PATH%"=="" set "ZIP_PATH=%~dp0deploy\org-task-tracker-production.zip"

set "TARGET_DIR=%~2"
if "%TARGET_DIR%"=="" set "TARGET_DIR=C:\apps\org-task-tracker"

set "SERVICE_NAME=%~3"
if "%SERVICE_NAME%"=="" set "SERVICE_NAME=OrgTaskTracker"

echo [INFO] ZIP_PATH=%ZIP_PATH%
echo [INFO] TARGET_DIR=%TARGET_DIR%
echo [INFO] SERVICE_NAME=%SERVICE_NAME%

if not exist "%ZIP_PATH%" (
  echo [ERROR] ZIP file not found: %ZIP_PATH%
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found in PATH.
  exit /b 1
)

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%i"
set "TEMP_DIR=%TEMP%\org-task-tracker-deploy-%TS%"
set "BACKUP_DIR=%TARGET_DIR%_backup_%TS%"

if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"
if errorlevel 1 (
  echo [ERROR] Failed to create temp directory.
  exit /b 1
)

echo [INFO] Extracting ZIP to temp directory...
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP_PATH%' -DestinationPath '%TEMP_DIR%' -Force"
if errorlevel 1 (
  echo [ERROR] ZIP extraction failed.
  rd /s /q "%TEMP_DIR%" >nul 2>nul
  exit /b 1
)

sc query "%SERVICE_NAME%" >nul 2>nul
if not errorlevel 1 (
  echo [INFO] Stopping service %SERVICE_NAME%...
  net stop "%SERVICE_NAME%" >nul 2>nul
)

if exist "%TARGET_DIR%" (
  echo [INFO] Creating backup: %BACKUP_DIR%
  robocopy "%TARGET_DIR%" "%BACKUP_DIR%" /MIR /NFL /NDL /NJH /NJS /NP >nul
)

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo [INFO] Deploying files to target directory...
robocopy "%TEMP_DIR%" "%TARGET_DIR%" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo [ERROR] File copy failed.
  rd /s /q "%TEMP_DIR%" >nul 2>nul
  exit /b 1
)

cd /d "%TARGET_DIR%"
if errorlevel 1 (
  echo [ERROR] Cannot access target directory.
  rd /s /q "%TEMP_DIR%" >nul 2>nul
  exit /b 1
)

if not exist ".env.local" (
  if exist ".env.example" (
    echo [WARN] .env.local not found. Creating from .env.example. Update secrets before go-live.
    copy /Y ".env.example" ".env.local" >nul
  ) else (
    echo [WARN] .env.local and .env.example are both missing.
  )
)

echo [INFO] Installing dependencies...
call npm ci
if errorlevel 1 (
  echo [ERROR] npm ci failed.
  rd /s /q "%TEMP_DIR%" >nul 2>nul
  exit /b 1
)

echo [INFO] Building application...
call npm run build
if errorlevel 1 (
  echo [ERROR] npm run build failed.
  rd /s /q "%TEMP_DIR%" >nul 2>nul
  exit /b 1
)

sc query "%SERVICE_NAME%" >nul 2>nul
if not errorlevel 1 (
  echo [INFO] Starting service %SERVICE_NAME%...
  net start "%SERVICE_NAME%"
  if errorlevel 1 (
    echo [ERROR] Failed to start service %SERVICE_NAME%.
    rd /s /q "%TEMP_DIR%" >nul 2>nul
    exit /b 1
  )
) else (
  echo [INFO] Service not found. Starting app in foreground...
  start "OrgTaskTracker" cmd /c "cd /d %TARGET_DIR% && npm start"
)

rd /s /q "%TEMP_DIR%" >nul 2>nul
echo [SUCCESS] Deployment completed.
exit /b 0
