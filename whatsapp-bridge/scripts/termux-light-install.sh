#!/data/data/com.termux/files/usr/bin/bash
# Install bridge ringan untuk Termux (Galaxy S4 / HP 2GB).
# Jalankan dari folder whatsapp-bridge:
#   bash scripts/termux-light-install.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Termux light install di: $ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node belum ada. Install dulu:"
  echo "  pkg update && pkg install nodejs-lts git"
  exit 1
fi

echo "==> Node: $(node -v)"
echo "==> npm:  $(npm -v)"

# Pakai dependency ringan (tanpa sharp/ffmpeg)
cp package-light.json package.json
rm -rf node_modules package-lock.json

echo "==> npm install (light)..."
npm install --no-optional --omit=optional

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "==> .env dibuat dari .env.example — EDIT isinya!"
  else
    echo "==> Buat file .env manual (lihat TERMUX-S4.md)"
  fi
else
  if ! grep -q '^LIGHT_MODE=' .env 2>/dev/null; then
    echo 'LIGHT_MODE=1' >> .env
    echo "==> LIGHT_MODE=1 ditambahkan ke .env"
  fi
fi

echo ""
echo "Selesai. Lanjut:"
echo "  1. Edit .env (WORKER_URL, WHATSAPP_API_SECRET, ALLOWED_WHATSAPP_NUMBER, LIGHT_MODE=1)"
echo "  2. termux-wake-lock"
echo "  3. npm start"
echo "  4. Scan QR WhatsApp di Termux (atau salin folder auth_info_baileys dari laptop)"
