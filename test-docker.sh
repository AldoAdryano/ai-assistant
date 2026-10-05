#!/usr/bin/env bash
# Jalankan typecheck + test di container node:22 (Debian bookworm, glibc 2.36)
# agar binary workerd bisa jalan — host Ubuntu 20.04 hanya punya glibc 2.31.
set -u

cd "$(dirname "$0")"
IMAGE="node:22-bookworm"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker tidak ditemukan. Install dulu: sudo apt install -y docker.io" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon tidak bisa diakses user ini." >&2
  echo "Jalankan: sudo usermod -aG docker \$USER   lalu log out/in." >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "node_modules belum ada — jalankan npm install dulu." >&2
  exit 1
fi

echo "== Verifikasi via Docker ($IMAGE) =="
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e npm_config_cache=/tmp/.npm \
  -v "$PWD":/app \
  -w /app \
  "$IMAGE" \
  bash -c "npm run typecheck && npm test"
