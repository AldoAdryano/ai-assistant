const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { default: PQueue } = require('p-queue');

const TERMUX_PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
const TERMUX_BIN = path.join(TERMUX_PREFIX, 'bin');

function childEnv() {
  const pathParts = [
    TERMUX_BIN,
    '/data/data/com.termux/files/usr/bin',
    process.env.PATH || '',
  ].filter(Boolean);
  return { ...process.env, PATH: pathParts.join(path.delimiter) };
}

/** Prefer `command -v` (Termux) over `which` (sering tidak ada). */
function resolveOnPath(cmd) {
  try {
    const out = execFileSync('sh', ['-c', `command -v ${cmd} 2>/dev/null`], {
      encoding: 'utf8',
      env: childEnv(),
      timeout: 5000,
    }).trim();
    return out || null;
  } catch (_) {
    return null;
  }
}

function probeRuns(bin, args = ['-version']) {
  if (!bin) return false;
  try {
    if (!fs.existsSync(bin)) return false;
  } catch (_) {
    return false;
  }
  try {
    execFileSync(bin, args, {
      encoding: 'utf8',
      timeout: 12000,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch (err) {
    // Beberapa build cetak versi ke stderr tapi exit 0; kalau exit non-zero tapi ada "ffmpeg version" / "Version:" anggap OK
    const msg = `${err.stdout || ''}${err.stderr || ''}${err.message || ''}`;
    if (/ffmpeg version|ImageMagick|Version:/i.test(msg)) return true;
    return false;
  }
}

function firstWorking(candidates, args = ['-version']) {
  for (const c of candidates) {
    if (!c) continue;
    if (probeRuns(c, args)) return c;
  }
  return null;
}

function resolveFfmpegPath() {
  return firstWorking([
    process.env.FFMPEG_PATH,
    path.join(TERMUX_BIN, 'ffmpeg'),
    '/data/data/com.termux/files/usr/bin/ffmpeg',
    resolveOnPath('ffmpeg'),
    (() => {
      try {
        return require('ffmpeg-static');
      } catch (_) {
        return null;
      }
    })(),
  ]);
}

function resolveMagickPath() {
  return firstWorking([
    process.env.MAGICK_PATH,
    path.join(TERMUX_BIN, 'magick'),
    path.join(TERMUX_BIN, 'convert'),
    '/data/data/com.termux/files/usr/bin/magick',
    '/data/data/com.termux/files/usr/bin/convert',
    resolveOnPath('magick'),
    resolveOnPath('convert'),
  ], ['-version']);
}

const ffmpegPath = resolveFfmpegPath();
const magickPath = resolveMagickPath();

if (ffmpegPath) {
  process.env.PATH = path.dirname(ffmpegPath) + path.delimiter + (process.env.PATH || '');
  console.log(`[media] Using ffmpeg: ${ffmpegPath}`);
} else {
  console.log('[media] ffmpeg tidak terdeteksi/jalan dari Node (cek: ffmpeg -version di shell)');
}

if (magickPath) {
  console.log(`[media] Using ImageMagick: ${magickPath}`);
}

if (!ffmpegPath && !magickPath) {
  throw new Error(
    'Tidak ada converter stiker. Di Termux: pkg upgrade && pkg reinstall libc++ libplacebo ffmpeg imagemagick — atau set FFMPEG_PATH=/data/data/com.termux/files/usr/bin/ffmpeg di .env'
  );
}

/** Optional: wa-sticker-formatter needs sharp (tidak ada binary android-armv7). */
let Sticker = null;
let StickerTypes = null;
try {
  const fmt = require('wa-sticker-formatter');
  Sticker = fmt.Sticker;
  StickerTypes = fmt.StickerTypes;
  console.log('[media] wa-sticker-formatter OK');
} catch (err) {
  console.log('[media] wa-sticker-formatter/sharp tidak tersedia → webp mentah OK');
  console.log('[media]   ', String(err.message || err).split('\n')[0]);
}

const isTermux = Boolean(process.env.TERMUX_VERSION || (process.env.PREFIX || '').includes('com.termux'));
const concurrency = Number(process.env.STICKER_CONCURRENCY || (isTermux ? 1 : 2));
const queue = new PQueue({ concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 1 });
const allowVideoSticker = process.env.STICKER_VIDEO !== '0' && process.env.STICKER_VIDEO !== 'false';

function escapeDrawtext(caption) {
  return String(caption)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

function runExec(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, env: childEnv() }, (err, _stdout, stderr) => {
      if (err) {
        const detail = (stderr || err.message || '').toString().slice(-400);
        reject(new Error(`${path.basename(bin)} failed: ${detail}`));
        return;
      }
      resolve();
    });
  });
}

async function imageToWebpWithMagick(inputPath, outputPath, caption) {
  // ImageMagick: resize + pad to 512, optional caption, write webp
  const args = [
    inputPath,
    '-resize', '512x512',
    '-background', 'none',
    '-gravity', 'center',
    '-extent', '512x512',
  ];
  if (caption) {
    console.log(`[DEBUG] Adding caption "${caption}" via ImageMagick...`);
    args.push(
      '-gravity', 'south',
      '-fill', 'white',
      '-stroke', 'black',
      '-strokewidth', '2',
      '-pointsize', '42',
      '-annotate', '+0+12', String(caption).slice(0, 40),
    );
  }
  // `magick` vs legacy `convert`
  if (path.basename(magickPath) === 'magick') {
    await runExec(magickPath, [...args, outputPath], 30000);
  } else {
    await runExec(magickPath, [...args, outputPath], 30000);
  }
  return fs.readFileSync(outputPath);
}

async function imageToWebpWithFfmpeg(inputPath, outputPath, caption) {
  let vf = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';
  if (caption) {
    console.log(`[DEBUG] Adding caption "${caption}" via ffmpeg drawtext...`);
    vf += `,drawtext=text='${escapeDrawtext(caption)}':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-th-16`;
  }
  await runExec(ffmpegPath, [
    '-y', '-i', inputPath, '-vf', vf, '-an', '-frames:v', '1', '-c:v', 'libwebp', '-q:v', '60', outputPath,
  ], 30000);
  return fs.readFileSync(outputPath);
}

async function videoToWebpWithFfmpeg(inputPath, outputPath, caption, maxSeconds) {
  let vf = 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=10';
  if (caption) {
    console.log(`[DEBUG] Adding caption "${caption}" via ffmpeg drawtext...`);
    vf += `,drawtext=text='${escapeDrawtext(caption)}':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-th-16`;
  }
  await runExec(ffmpegPath, [
    '-y', '-i', inputPath, '-vf', vf, '-an', '-t', String(maxSeconds || 3),
    '-loop', '0', '-c:v', 'libwebp', '-q:v', '40', outputPath,
  ], 60000);
  return fs.readFileSync(outputPath);
}

async function wrapWithFormatter(buffer, quality) {
  if (!Sticker) return buffer;
  try {
    const sticker = new Sticker(buffer, {
      pack: 'Youyou AI',
      author: 'Tuan Muda Aldo',
      type: StickerTypes.FULL,
      quality,
    });
    return await sticker.build();
  } catch (err) {
    console.warn('[media] formatter.build gagal, pakai webp mentah:', err.message);
    return buffer;
  }
}

async function buildImageSticker(buffer, caption) {
  return queue.add(async () => {
    const id = Date.now();
    const tmpIn = path.join(os.tmpdir(), `stk_img_in_${id}.jpg`);
    const tmpWebp = path.join(os.tmpdir(), `stk_img_out_${id}.webp`);
    fs.writeFileSync(tmpIn, buffer);
    try {
      let webp;
      if (ffmpegPath) {
        try {
          webp = await imageToWebpWithFfmpeg(tmpIn, tmpWebp, caption);
        } catch (err) {
          console.warn('[media] ffmpeg image gagal, coba ImageMagick:', err.message.slice(0, 120));
          if (!magickPath) throw err;
          webp = await imageToWebpWithMagick(tmpIn, tmpWebp, caption);
        }
      } else if (magickPath) {
        webp = await imageToWebpWithMagick(tmpIn, tmpWebp, caption);
      } else {
        throw new Error('Tidak ada ffmpeg/ImageMagick untuk stiker foto');
      }
      console.log(`[DEBUG] Image webp ready (${webp.length} bytes)`);
      return await wrapWithFormatter(webp, 50);
    } finally {
      try { fs.unlinkSync(tmpIn); } catch (_) {}
      try { fs.unlinkSync(tmpWebp); } catch (_) {}
    }
  });
}

async function buildVideoSticker(buffer, caption) {
  if (!allowVideoSticker) {
    throw new Error('Video sticker dimatikan (STICKER_VIDEO=0). Hemat RAM di HP.');
  }
  if (!ffmpegPath) {
    throw new Error('Stiker video butuh ffmpeg yang bisa jalan. Perbaiki: pkg upgrade && pkg reinstall ffmpeg');
  }
  return queue.add(async () => {
    const id = Date.now();
    const tmpIn = path.join(os.tmpdir(), `stk_vid_in_${id}.mp4`);
    const tmpWebp = path.join(os.tmpdir(), `stk_vid_out_${id}.webp`);
    fs.writeFileSync(tmpIn, buffer);
    try {
      const webp = await videoToWebpWithFfmpeg(tmpIn, tmpWebp, caption, 3);
      console.log(`[DEBUG] Video webp ready (${webp.length} bytes)`);
      return await wrapWithFormatter(webp, 30);
    } finally {
      try { fs.unlinkSync(tmpIn); } catch (_) {}
      try { fs.unlinkSync(tmpWebp); } catch (_) {}
    }
  });
}

module.exports = { buildImageSticker, buildVideoSticker, resolveFfmpegPath, resolveMagickPath };
