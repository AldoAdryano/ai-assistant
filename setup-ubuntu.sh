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
echo "==> typecheck"
npm run typecheck; TC=$?
echo "==> test"
npm test; TEST=$?

cat <<EOF

=== Langkah manual selanjutnya ===
1. Login Cloudflare:
     npx wrangler login
     npx wrangler whoami
2. Pastikan secret sudah ada (sudah tersimpan di server, TIDAK perlu diisi ulang):
     npx wrangler secret list
3. Jalankan worker:
     npm run dev            (uji lokal)
     atau npm run deploy    (deploy dari Ubuntu)
4. Bridge WhatsApp:
     cd whatsapp-bridge && node index.js
   Session disalin dari Windows; kalau WhatsApp menolak, scan QR di terminal.

Ringkasan verifikasi: typecheck exit=$TC, test exit=$TEST
EOF
exit 0
