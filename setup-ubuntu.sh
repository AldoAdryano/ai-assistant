#!/usr/bin/env bash
# Setup proyek personal-ai-whatsapp di Ubuntu 20.04+ (dari paket migrasi-ubuntu.zip).
set -u

cd "$(dirname "$0")"
echo "== Migrasi proyek ke Ubuntu =="

# 1. Prasyarat
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "Butuh git & curl. Jalankan dulu:"
  echo "  sudo apt update && sudo apt install -y git curl"
  exit 1
fi

# 2. Node.js 22 via nvm (Ubuntu 20.04 default Node 10 -> terlalu tua)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
if [ -z "$NODE_MAJOR" ]; then NODE_MAJOR=0; fi
if [ "$NODE_MAJOR" -lt 22 ]; then
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "Memasang nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    . "$NVM_DIR/nvm.sh"
  fi
  nvm install 22
  nvm use 22
fi
echo "Node: $(node -v)  npm: $(npm -v)"

# 3. Dependensi (binary sharp/ffmpeg-static dibangun ulang untuk Linux)
echo "==> npm install (root)"
if ! npm install; then echo "Gagal: npm install root"; exit 1; fi
echo "==> npm install (whatsapp-bridge)"
if ! (cd whatsapp-bridge && npm install); then echo "Gagal: npm install bridge"; exit 1; fi

# 4. Verifikasi (kegagalan tidak menghentikan langkah manual)
# workerd (dipakai vitest & wrangler dev) butuh glibc >= 2.35; Ubuntu 20.04 = 2.31.
# Jika host tak mampu menjalankan workerd, verifikasi dialihkan ke container node:22.
echo "==> typecheck"
npm run typecheck; TC=$?
echo "==> test"
if node -e "process.exit(0)" 2>/dev/null \
  && node_modules/@cloudflare/workerd-linux-64/bin/workerd --version >/dev/null 2>&1; then
  npm test; TEST=$?
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Host (glibc 2.31) tidak menjalankan workerd -> test via Docker node:22"
  bash test-docker.sh; TEST=$?
else
  echo "workerd tidak jalan di host dan Docker tidak bisa diakses."
  echo "  - Docker belum ada : sudo apt install -y docker.io"
  echo "  - Belum dapat grup : sudo usermod -aG docker \$USER (lalu log in ulang)"
  echo "Setelah itu jalankan: bash test-docker.sh"
  TEST=1
fi

cat <<EOF

=== Langkah manual selanjutnya ===
1. Login Cloudflare:
     npx wrangler login
     npx wrangler whoami
2. Pastikan secret sudah ada (sudah tersimpan di server, TIDAK perlu diisi ulang):
     npx wrangler secret list
3. Jalankan worker:
     npm run deploy    (deploy dari Ubuntu — perintah ini tidak butuh workerd lokal)
   Uji lokal (wrangler dev) butuh workerd, jalankan via Docker:
     docker run --rm -it -v "\$PWD":/app -w /app -p 8787:8787 node:22-bookworm npm run dev
4. Bridge WhatsApp:
     cd whatsapp-bridge && node index.js
   Session disalin dari Windows; kalau WhatsApp menolak, scan QR di terminal.

Ringkasan verifikasi: typecheck exit=$TC, test exit=$TEST
EOF
exit 0
