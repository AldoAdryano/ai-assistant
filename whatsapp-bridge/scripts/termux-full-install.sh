#!/data/data/com.termux/files/usr/bin/bash
# Full mode Termux: stiker via ffmpeg dan/atau ImageMagick (tanpa sharp).
#   bash scripts/termux-full-install.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Termux FULL di: $ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node belum ada: pkg install nodejs-lts"
  exit 1
fi

echo "==> Upgrade paket (wajib — perbaiki linker ffmpeg/libplacebo)..."
pkg update -y || true
# Jangan gagal total kalau upgrade interaktif/partial
set +e
pkg upgrade -y
pkg reinstall -y libc++ libplacebo ffmpeg
FFMPEG_OK=0
if command -v ffmpeg >/dev/null 2>&1 && ffmpeg -version >/dev/null 2>&1; then
  FFMPEG_OK=1
  echo "==> ffmpeg OK: $(command -v ffmpeg)"
  ffmpeg -version | head -n 1
else
  echo "==> ffmpeg MASIH RUSAK (common di Termux lama)."
  echo "    Install ImageMagick sebagai fallback stiker FOTO..."
  pkg install -y imagemagick
fi
set -e

MAGICK_OK=0
if command -v magick >/dev/null 2>&1 && magick -version >/dev/null 2>&1; then
  MAGICK_OK=1
  echo "==> ImageMagick OK: magick"
elif command -v convert >/dev/null 2>&1 && convert -version >/dev/null 2>&1; then
  MAGICK_OK=1
  echo "==> ImageMagick OK: convert"
fi

if [ "$FFMPEG_OK" -eq 0 ] && [ "$MAGICK_OK" -eq 0 ]; then
  echo "FATAL: ffmpeg dan ImageMagick sama-sama tidak jalan."
  echo "Coba manual:"
  echo "  termux-change-repo   # pilih mirror selain Chinese Mainland"
  echo "  pkg upgrade -y"
  echo "  pkg reinstall -y libc++ libplacebo ffmpeg imagemagick"
  exit 1
fi

echo "==> package-termux-full.json (tanpa sharp)..."
cp package-termux-full.json package.json
rm -rf node_modules package-lock.json
npm install

echo "==> Uji media.js..."
node -e "require('./src/media'); console.log('media.js OK')"

if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || true
fi

if grep -q '^LIGHT_MODE=' .env 2>/dev/null; then
  sed -i 's/^LIGHT_MODE=.*/LIGHT_MODE=0/' .env
else
  echo 'LIGHT_MODE=0' >> .env
fi

grep -q '^STICKER_CONCURRENCY=' .env 2>/dev/null || echo 'STICKER_CONCURRENCY=1' >> .env
if ! grep -q '^STICKER_VIDEO=' .env 2>/dev/null; then
  echo 'STICKER_VIDEO=0' >> .env
fi

# Video butuh ffmpeg sehat
if [ "$FFMPEG_OK" -eq 0 ]; then
  if grep -q '^STICKER_VIDEO=' .env; then
    sed -i 's/^STICKER_VIDEO=.*/STICKER_VIDEO=0/' .env
  else
    echo 'STICKER_VIDEO=0' >> .env
  fi
  echo "==> STICKER_VIDEO=0 (ffmpeg rusak — stiker foto via ImageMagick saja)"
fi

echo ""
echo "Selesai. Restart:"
echo "  termux-wake-lock && npm start"
echo "Log yang diharapkan: [media] Using ffmpeg: ... DAN/ATAU [media] Using ImageMagick: ..."
echo "Bukan: fallback ke LIGHT_MODE"
echo "Tes: foto + Buatkan stiker caption macet"
