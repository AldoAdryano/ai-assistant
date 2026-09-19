const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const ffmpegPath = require('ffmpeg-static');
process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + process.env.PATH;

async function testPipeline() {
  // 1. Generate a dummy 3-second MP4 video
  const rawMp4Path = path.join(os.tmpdir(), `raw_${Date.now()}.mp4`);
  await new Promise((res, rej) => {
    execFile(ffmpegPath, [
      '-f', 'lavfi', '-i', 'testsrc=duration=3:size=1280x720:rate=30',
      '-c:v', 'libx264', '-y', rawMp4Path
    ], (err) => err ? rej(err) : res());
  });

  const rawMp4 = fs.readFileSync(rawMp4Path);
  console.log(`Raw MP4 size: ${rawMp4.length} bytes`);

  // 2. Our new preprocess step: scale to 512x512, pad, 10fps, trim to 5s, overlay caption
  const processedMp4Path = path.join(os.tmpdir(), `processed_${Date.now()}.mp4`);
  fs.writeFileSync(rawMp4Path, rawMp4);

  const caption = "Macet";
  const escaped = caption.replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
  const vf = `scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=10,drawtext=text='${escaped}':fontsize=36:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-th-30:font='Impact'`;

  await new Promise((res, rej) => {
    execFile(ffmpegPath, [
      '-i', rawMp4Path,
      '-vf', vf,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '30',
      '-t', '5',
      '-an',
      '-y', processedMp4Path
    ], (err) => err ? rej(err) : res());
  });

  const processedMp4 = fs.readFileSync(processedMp4Path);
  console.log(`Processed MP4 size: ${processedMp4.length} bytes`);

  // 3. Pass to wa-sticker-formatter
  const sticker = new Sticker(processedMp4, {
    pack: 'Youyou AI', 
    author: 'Tuan Muda Aldo', 
    type: StickerTypes.FULL, 
    quality: 30
  });

  const finalWebp = await sticker.build();
  console.log(`Final animated sticker size: ${finalWebp.length} bytes ✅`);
  fs.writeFileSync('test_pipeline.webp', finalWebp);
}

testPipeline().catch(console.error);
