import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const stickers = ['marah', 'senang', 'ngambek', 'sedih', 'default'];
const outDir = path.join(process.cwd(), 'whatsapp-bridge', 'stickers');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function createStickers() {
  for (const name of stickers) {
    const svg = `
      <svg width="512" height="512">
        <rect width="100%" height="100%" fill="#cccccc" />
        <text x="50%" y="50%" font-family="Arial" font-size="48" fill="black" text-anchor="middle" dominant-baseline="middle">${name}</text>
      </svg>
    `;

    await sharp(Buffer.from(svg))
      .webp()
      .toFile(path.join(outDir, `${name}.webp`));
    console.log(`Created ${name}.webp`);
  }
}

createStickers().catch(console.error);