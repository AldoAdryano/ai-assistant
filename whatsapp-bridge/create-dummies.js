const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const stickers = ['marah', 'senang', 'ngambek', 'sedih', 'default'];
const dir = path.join(__dirname, 'stickers');

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

async function makeStickers() {
  for (const name of stickers) {
    const file = path.join(dir, `${name}.webp`);
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: Math.floor(Math.random()*255), g: Math.floor(Math.random()*255), b: Math.floor(Math.random()*255), alpha: 1 }
      }
    })
    .composite([{
      input: Buffer.from(`<svg width="512" height="512"><text x="50%" y="50%" text-anchor="middle" font-size="64" fill="white">${name}</text></svg>`),
      top: 0,
      left: 0
    }])
    .webp()
    .toFile(file);
    console.log(`Created ${file}`);
  }
}

makeStickers().catch(console.error);
