const sharp = require('sharp');
const fs = require('fs');
async function test() {
  const buf = await sharp({
    create: { width: 300, height: 300, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
  }).jpeg().toBuffer();
  
  const cap = 'Macet';
  const fontSize = 30;
  const svg = Buffer.from(`<svg width="300" height="300"><style>.t{fill:white;font-size:${fontSize}px;font-family:Impact,Arial Black,sans-serif;paint-order:stroke;stroke:black;stroke-width:3px}</style><text x="50%" y="280" text-anchor="middle" class="t">${cap}</text></svg>`);
  
  try {
    const res = await sharp(buf).composite([{ input: svg, top: 0, left: 0 }]).jpeg().toBuffer();
    fs.writeFileSync('test_cap_sharp.jpg', res);
    console.log('success');
  } catch (err) {
    console.error('Sharp error:', err);
  }
}
test();
