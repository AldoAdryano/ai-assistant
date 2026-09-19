const {execSync} = require('child_process');
try {
  execSync(require('ffmpeg-static') + ' -f lavfi -i color=c=black:s=128x128 -vf "drawtext=text=\'Test\':font=\'Impact\':fontcolor=white" -frames:v 1 -y test_font.jpg');
  console.log('success');
} catch(e) {
  console.log('Failed:', e.stderr ? e.stderr.toString() : e.message);
}
