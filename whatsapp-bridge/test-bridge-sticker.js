const fs = require('fs');
const sharp = require('sharp');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');

async function buildImageSticker(buffer, caption) {
  let processedBuffer = buffer;
  
  if (caption) {
    const image = sharp(buffer);
    const meta = await image.metadata();
    const w = meta.width || 512;
    const h = meta.height || 512;
    const fontSize = Math.max(24, Math.floor(Math.min(w, h) / 8));
    const strokeW = Math.max(2, Math.floor(fontSize / 10));
    const esc = caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const svg = Buffer.from(`<svg width="${w}" height="${h}">
      <style>.t{fill:white;font-size:${fontSize}px;font-weight:bold;font-family:Impact,Arial Black,sans-serif;paint-order:stroke;stroke:black;stroke-width:${strokeW}px;stroke-linejoin:round}</style>
      <text x="50%" y="${Math.floor(h * 0.92)}" text-anchor="middle" class="t">${esc}</text>
    </svg>`);

    processedBuffer = await image
      .composite([{ input: svg, top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();
      
    fs.writeFileSync('debug_sharp_output.jpg', processedBuffer);
  }

  const sticker = new Sticker(processedBuffer, {
    pack: 'Youyou AI', 
    author: 'Tuan Muda Aldo', 
    type: StickerTypes.FULL, 
    quality: 50
  });

  const finalSticker = await sticker.build();
  fs.writeFileSync('debug_final_sticker.webp', finalSticker);
  console.log("Done");
}

async function test() {
  const buf = await sharp({
    create: { width: 1000, height: 1000, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
  }).jpeg().toBuffer();
  
  await buildImageSticker(buf, "macet");
}

test();
