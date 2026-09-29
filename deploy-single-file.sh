#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./deploy-single-file.sh [zip_path] [target_dir] [service_name]
# Example:
# ./deploy-single-file.sh ./deploy/org-task-tracker-production.zip /opt/org-task-tracker org-task-tracker

ZIP_PATH="${1:-./deploy/org-task-tracker-production.zip}"
TARGET_DIR="${2:-/opt/org-task-tracker}"
SERVICE_NAME="${3:-org-task-tracker}"

echo "[INFO] ZIP_PATH=${ZIP_PATH}"
echo "[INFO] TARGET_DIR=${TARGET_DIR}"
echo "[INFO] SERVICE_NAME=${SERVICE_NAME}"

if [[ ! -f "${ZIP_PATH}" ]]; then
  echo "[ERROR] ZIP file not found: ${ZIP_PATH}"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found in PATH."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm not found in PATH."
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "[ERROR] unzip not installed."
  exit 1
fi

TS="$(date +%Y%m%d_%H%M%S)"
TEMP_DIR="/tmp/org-task-tracker-deploy-${TS}"
BACKUP_DIR="${TARGET_DIR}_backup_${TS}"

mkdir -p "${TEMP_DIR}"

echo "[INFO] Extracting ZIP to temp directory..."
unzip -oq "${ZIP_PATH}" -d "${TEMP_DIR}"

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
  echo "[INFO] Stopping service ${SERVICE_NAME}..."
  sudo systemctl stop "${SERVICE_NAME}" || true
fi

if [[ -d "${TARGET_DIR}" ]]; then
  echo "[INFO] Creating backup: ${BACKUP_DIR}"
  cp -a "${TARGET_DIR}" "${BACKUP_DIR}"
fi

mkdir -p "${TARGET_DIR}"

if command -v rsync >/dev/null 2>&1; then
  echo "[INFO] Deploying files with rsync..."
  rsync -a --delete "${TEMP_DIR}/" "${TARGET_DIR}/"
else
  echo "[INFO] rsync not found, using cp fallback..."
  rm -rf "${TARGET_DIR:?}/"*
  cp -a "${TEMP_DIR}/." "${TARGET_DIR}/"
fi

cd "${TARGET_DIR}"

if [[ ! -f ".env.local" && -f ".env.example" ]]; then
  echo "[WARN] .env.local not found. Creating from .env.example. Update secrets before go-live."
  cp .env.example .env.local
fi

echo "[INFO] Installing dependencies..."
npm ci

echo "[INFO] Building application..."
npm run build

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
  echo "[INFO] Starting service ${SERVICE_NAME}..."
  sudo systemctl start "${SERVICE_NAME}"
  sudo systemctl status "${SERVICE_NAME}" --no-pager -l | head -n 20 || true
else
  echo "[INFO] Service ${SERVICE_NAME} not found. Starting app in foreground..."
  npm start
fi

rm -rf "${TEMP_DIR}"
echo "[SUCCESS] Deployment completed."
