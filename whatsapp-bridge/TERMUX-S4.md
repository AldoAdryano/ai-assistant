# Setup Youyou Bridge di Samsung S4 (LineageOS + Termux)

## Full mode (stiker tanpa sharp)

Sharp tidak support `android-armv7`. Stiker pakai:
- **ffmpeg → webp** (ideal), atau
- **ImageMagick** fallback kalau ffmpeg Termux rusak (error `libplacebo` / `CANNOT LINK`)

### Update file saja (jangan copy folder penuh)
Dari laptop, salin ke HP lalu ke `~/Youyou/whatsapp-bridge/`:
```
src/media.js
src/whatsapp.js
src/access-policy.js
src/public-stiker.js
scripts/termux-full-install.sh
package-termux-full.json
```

### Publik `/stiker` (siapa saja, DM atau grup)
- Caption media: `/stiker` atau `/stiker bodo amat` (teks setelah perintah = caption di stiker)
- Atau **reply** foto/video/stiker lalu ketik `/stiker` / `/stiker caption`
- Balasan: **hanya stiker** (tanpa chat Youyou)
- Full Youyou di grup: hanya owner, dengan **@** nomor bridge atau **reply** ke pesan Youyou
- Full Youyou DM: hanya nomor di `ALLOWED_WHATSAPP_NUMBER`

### `/get` — buka pesan sekali lihat (owner only)
1. Reply ke foto/video/VN **sekali lihat**
2. Ketik `/get`
3. Youyou kirim ulang media **biasa** (bukan sekali lihat) di chat/grup yang sama

Owner di `.env` harus PN + LID (keduanya):
```
ALLOWED_WHATSAPP_NUMBER=6288983776936,238035878838303@lid
```

Setelah update, startup **harus** muncul:
```
[boot] owners=6288983776936@s.whatsapp.net,238035878838303@lid ...
[identity] bot=... botLid=...@lid owners=...
```
Kalau masih `ownerLid=-` → file lama; salin ulang `src/` dari laptop.

### Pesan "Menunggu pesan ini…" / log Bad MAC
Ini **sesi enkripsi linked device** yang bentrok (bukan bug stiker/Worker).

Perbaikan ringan: pastikan `src/whatsapp.js` terbaru (ada `getMessage` untuk retry).

Kalau tetap parah, **re-link**:
```bash
cd ~/Youyou/whatsapp-bridge
# Ctrl+C dulu
# Di HP utama: WhatsApp → Perangkat tertaut → hapus S4/Termux
rm -rf auth_info_baileys
npm start
# Scan QR lagi; biarkan HP online sebentar
```

Jangan jalankan 2 bridge dengan sesi yang sama sekaligus.
Lalu di Termux:
```bash
cd ~/Youyou/whatsapp-bridge
node -e "require('./src/media'); console.log('OK')"
# Harus: Using ffmpeg: ... / Using ImageMagick: ...
LIGHT_MODE=0 termux-wake-lock npm start
```

Pastikan `.env` punya `LIGHT_MODE=0`.

### Kalau ffmpeg error libplacebo (yang Anda alami)
Jalankan manual dulu:

```bash
pkg upgrade -y
pkg reinstall -y libc++ libplacebo ffmpeg
ffmpeg -version
```

Kalau masih Aborted:

```bash
pkg install -y imagemagick
magick -version || convert -version
```

Lalu salin file terbaru dari laptop dan:

```bash
cd ~/Youyou/whatsapp-bridge
bash scripts/termux-full-install.sh
npm start
```

`npm install ffmpeg-static` **tidak** membantu di Android armv7.

Video stiker hanya kalau `ffmpeg -version` sukses, lalu `STICKER_VIDEO=1`.

Kembali light: `bash scripts/termux-light-install.sh`
