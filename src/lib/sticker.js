// Modul konversi gambar/GIF/video jadi stiker WhatsApp (.webp).
//
// - imageToSticker(buffer)    -> stiker statis, dari foto/gambar biasa
// - animatedToSticker(buffer) -> stiker gerak, dari GIF atau video pendek
//
// FFmpeg dipakai via package ffmpeg-static (bundled binary),
// tidak perlu install ffmpeg manual di sistem.

const sharp = require('sharp');
const webpmux = require('node-webpmux');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

const STICKER_SIZE = 512;
const CORNER_RADIUS = 48;

// Ini batas ASLI dari WhatsApp (bukan asumsi): stiker statis maksimal
// 100KB, stiker animasi maksimal 500KB. Di atas itu, WA akan gagal
// menerima/menampilkan stikernya (persis bug yang dilaporkan). Kita
// kasih margin aman sedikit di bawah limit resminya.
const MAX_STATIC_BYTES = 95 * 1024;
const MAX_ANIMATED_BYTES = 480 * 1024;

// Beberapa "anak tangga" kualitas yang dicoba berurutan sampai
// ukurannya muat. Additional makin turun makin agresif kompresinya.
const STATIC_QUALITY_STEPS = [85, 70, 55, 40, 25, 15];
const ANIMATED_STEPS = [
  { fps: 12, duration: 5, quality: 60 },
  { fps: 10, duration: 4, quality: 45 },
  { fps: 8, duration: 3, quality: 32 },
  { fps: 8, duration: 2.5, quality: 20 },
  { fps: 6, duration: 2, quality: 12 },
];

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg keluar dengan kode ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', (err) => reject(err));
  });
}

// Menempelkan metadata pack/author (dan emoji) ke file webp, sesuai
// format yang dibaca WhatsApp supaya stiker punya nama pack di app.
async function addStickerMetadata(webpBuffer, { packName, authorName, emojis }) {
  const img = new webpmux.Image();
  await img.load(webpBuffer);

  if (img.hasAnim) {
    img.data.alph = true;
  }

  const json = {
    'sticker-pack-id': 'wa-bot-sticker-ai',
    'sticker-pack-name': packName || 'Ren Sticker',
    'sticker-pack-publisher': authorName || 'Aemeath',
    emojis: emojis && emojis.length ? emojis : [''],
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf-8');
  const exif = Buffer.concat([exifAttr, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);

  img.exif = exif;
  return img.save(null);
}

let roundedMaskSvg = null;
function getRoundedMaskSvg() {
  if (!roundedMaskSvg) {
    roundedMaskSvg = Buffer.from(
      `<svg width="${STICKER_SIZE}" height="${STICKER_SIZE}">` +
        `<rect x="0" y="0" width="${STICKER_SIZE}" height="${STICKER_SIZE}" ` +
        `rx="${CORNER_RADIUS}" ry="${CORNER_RADIUS}" fill="#fff"/></svg>`
    );
  }
  return roundedMaskSvg;
}

// Gambar statis (jpg/png/dll) -> stiker webp statis
async function imageToSticker(buffer, meta = {}) {
  let webpBuffer;
 
  for (const quality of STATIC_QUALITY_STEPS) {
    webpBuffer = await sharp(buffer)
      .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .composite([{ input: getRoundedMaskSvg(), blend: 'dest-in' }])
      .webp({ quality })
      .toBuffer();
 
    if (webpBuffer.length <= MAX_STATIC_BYTES) break;
  }
 
  if (webpBuffer.length > MAX_STATIC_BYTES) {
    throw new Error(
      `Stiker masih ${(webpBuffer.length / 1024).toFixed(0)}KB setelah dikompres maksimal (batas WhatsApp 100KB). Coba gambar yang lebih simpel/nggak terlalu detail.`
    );
  }
 
  return addStickerMetadata(webpBuffer, meta);
}

// GIF / video pendek -> stiker webp animasi
async function animatedToSticker(buffer, meta = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sticker-'));
  const inputExt = meta.inputExt || 'gif';
  const inputPath = path.join(tmpDir, `input.${inputExt}`);
  const maskPath = path.join(tmpDir, 'mask.png');
  const outputPath = path.join(tmpDir, 'output.webp');
 
  try {
    fs.writeFileSync(inputPath, buffer);
    fs.writeFileSync(maskPath, await sharp(getRoundedMaskSvg()).png().toBuffer());
 
    let webpBuffer;
 
    const roundedFilter =
      `[0:v]scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,` +
      `format=yuva420p,fps=FPS_PLACEHOLDER,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,` +
      `split=2[base1][base2];` +
      `[base1]alphaextract[a_orig];` +
      `[1:v]format=gray[m_gray];` +
      `[a_orig][m_gray]blend=all_mode=multiply[a_final];` +
      `[base2][a_final]alphamerge[out]`;

    // Coba encode makin agresif sampai ukurannya muat di bawah 500KB
    // (limit asli WhatsApp buat stiker animasi). Ini akar penyebab bug
    // "stiker nggak bisa diunduh" — sebelumnya nggak ada pengecekan
    // ukuran sama sekali, jadi GIF apa pun ukurannya langsung dikirim
    // meski hasilnya di atas limit dan gagal di sisi penerima.
    for (const step of ANIMATED_STEPS) {
      await runFfmpeg([
        '-y',
        '-i', inputPath,
        '-i', maskPath,
        '-filter_complex', roundedFilter.replace('FPS_PLACEHOLDER', String(step.fps)),
        '-map', '[out]',
        '-t', String(step.duration),
        '-loop', '0',
        '-vcodec', 'libwebp',
        '-preset', 'icon',
        '-quality', String(step.quality),
        '-an',
        '-vsync', '0',
        outputPath,
      ]);
 
      webpBuffer = fs.readFileSync(outputPath);
      if (webpBuffer.length <= MAX_ANIMATED_BYTES) break;
    }
 
    if (webpBuffer.length > MAX_ANIMATED_BYTES) {
      throw new Error(
        `Stiker animasi masih ${(webpBuffer.length / 1024).toFixed(0)}KB setelah dikompres maksimal (batas WhatsApp 500KB). GIF-nya kemungkinan terlalu panjang/kompleks — coba GIF yang lebih pendek atau lebih simpel warnanya.`
      );
    }
 
    return await addStickerMetadata(webpBuffer, meta);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { imageToSticker, animatedToSticker };
