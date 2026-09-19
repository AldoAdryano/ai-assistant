const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

// 1. Create a dummy JPEG image
const dummyPath = path.join(os.tmpdir(), `dummy_${Date.now()}.jpg`);
const outPath = path.join(os.tmpdir(), `out_${Date.now()}.mp4`);

execFile(ffmpegPath, [
  '-f', 'lavfi', '-i', 'color=c=red:s=800x600', '-frames:v', '1', '-y', dummyPath
], (err) => {
  if (err) return console.error(err);
  
  // 2. Add text using ffmpeg exactly like video, but output as JPEG
  const outJpgPath = path.join(os.tmpdir(), `out_${Date.now()}.jpg`);
  const caption = "Macet";
  const escaped = caption.replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
  let vf = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';
  vf += `,drawtext=text='${escaped}':fontsize=36:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-th-30:font='Impact'`;
  
  execFile(ffmpegPath, [
    '-i', dummyPath,
    '-vf', vf,
    '-frames:v', '1',
    '-y', outJpgPath
  ], (err2) => {
    if (err2) return console.error(err2);
    const buf = fs.readFileSync(outJpgPath);
    console.log(`Successfully generated ffmpeg image with text! ${buf.length} bytes`);
  });
});
