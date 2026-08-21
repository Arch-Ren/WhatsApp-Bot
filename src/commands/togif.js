// Converter: ubah stiker (webp, statis/animasi) atau video pendek jadi
// file GIF yang bisa disimpan/dipakai ulang di luar WA.
//
// Didesain jadi "keluarga" .to<format> — kalau nanti mau nambah
// converter lain (.tomp4, .topng, dst), tinggal ikuti pola yang sama:
// download media yang di-reply, convert, kirim balik.
//
// CATATAN TEKNIS: konversi WEBP animasi pakai Python+Pillow, BUKAN
// ffmpeg. ffmpeg (baik versi sistem maupun ffmpeg-static) ternyata
// nggak bisa decode balik animated webp buatannya sendiri (limitasi
// demuxer webp di ffmpeg, sudah dites langsung). Pillow terbukti bisa
// baca frame-nya dengan benar. Video (mp4) tetap lewat ffmpeg seperti
// biasa karena itu nggak ada masalah.
//
// Prasyarat tambahan: pip install Pillow

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');

const MAX_SIZE_MB = 16; // batas aman kirim dokumen lewat WA

// Sama seperti downloader.js/music.js — coba beberapa cara manggil
// Python, penting terutama di Windows.
const PYTHON_CANDIDATES = ['python', 'py', 'python3'];
let workingPythonIndex = null;

function trySpawn(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').pop() || `keluar dengan kode ${code}`));
    });
    proc.on('error', reject);
  });
}

async function runPython(args) {
  if (workingPythonIndex !== null) {
    return trySpawn(PYTHON_CANDIDATES[workingPythonIndex], args);
  }
  for (let i = 0; i < PYTHON_CANDIDATES.length; i++) {
    try {
      await trySpawn(PYTHON_CANDIDATES[i], args);
      workingPythonIndex = i;
      return;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  throw new Error(
    'Python nggak ketemu (dicoba: python / py / python3). Install Python dulu, lalu "pip install Pillow".'
  );
}

const WEBP_TO_GIF_SCRIPT = `
import sys
from PIL import Image

input_path, output_path = sys.argv[1], sys.argv[2]
im = Image.open(input_path)
frames = []
durations = []
try:
    while True:
        frames.append(im.convert('RGBA').copy())
        durations.append(im.info.get('duration', 66))
        im.seek(im.tell() + 1)
except EOFError:
    pass

if len(frames) == 1:
    frames[0].save(output_path)
else:
    frames[0].save(
        output_path, save_all=True, append_images=frames[1:],
        duration=durations, loop=0, disposal=2
    )
`;

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg keluar dengan kode ${code}: ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

// Cari media yang bisa dikonversi (stiker atau video) dari pesan yang
// di-reply, atau dari pesan itu sendiri kalau dikirim langsung dengan caption.
function findConvertibleMedia(msg) {
  const message = msg.message || {};
  const quoted = message.extendedTextMessage?.contextInfo?.quotedMessage;
  const source = quoted || message;

  if (source.stickerMessage) return { type: 'sticker', wrapped: { message: source }, ext: 'webp' };
  if (source.videoMessage) return { type: 'video', wrapped: { message: source }, ext: 'mp4' };
  if (source.imageMessage) return { type: 'image', wrapped: { message: source }, ext: 'jpg' };
  return null;
}

module.exports = {
  name: 'togif',
  aliases: ['gif'],
  description: 'Ubah stiker/video yang di-reply jadi file GIF. Pakai: reply stiker/video dengan .togif',
  execute: async (ctx) => {
    const { sock, msg, chatId } = ctx;
    const media = findConvertibleMedia(msg);

    if (!media) {
      await sock.sendMessage(
        chatId,
        { text: 'Reply stiker atau video dengan caption .togif ya.' },
        { quoted: msg }
      );
      return;
    }

    if (media.type === 'image') {
      await sock.sendMessage(
        chatId,
        { text: 'Gambar diam nggak ada animasinya — reply stiker atau video aja.' },
        { quoted: msg }
      );
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-togif-'));
    const inputPath = path.join(tmpDir, `input.${media.ext}`);
    const outputPath = path.join(tmpDir, 'output.gif');

    try {
      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

      const buffer = await downloadMediaMessage(media.wrapped, 'buffer', {});
      fs.writeFileSync(inputPath, buffer);

      if (media.type === 'sticker') {
        // WEBP -> lewat Python+Pillow (lihat catatan di atas file).
        const scriptPath = path.join(tmpDir, 'convert.py');
        fs.writeFileSync(scriptPath, WEBP_TO_GIF_SCRIPT);
        await runPython([scriptPath, inputPath, outputPath]);
      } else {
        // Video -> ffmpeg, dua-pass palette biar warnanya bagus.
        const palettePath = path.join(tmpDir, 'palette.png');
        await runFfmpeg([
          '-y', '-i', inputPath,
          '-vf', 'fps=15,scale=512:-1:flags=lanczos,palettegen=stats_mode=diff',
          palettePath,
        ]);
        await runFfmpeg([
          '-y', '-i', inputPath, '-i', palettePath,
          '-filter_complex', 'fps=15,scale=512:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer',
          '-loop', '0',
          outputPath,
        ]);
      }

      const stat = fs.statSync(outputPath);
      if (stat.size > MAX_SIZE_MB * 1024 * 1024) {
        throw new Error(`Hasil GIF terlalu besar (${(stat.size / 1024 / 1024).toFixed(1)}MB, batas ${MAX_SIZE_MB}MB). Coba media yang lebih pendek.`);
      }

      const gifBuffer = fs.readFileSync(outputPath);
      await sock.sendMessage(
        chatId,
        { document: gifBuffer, mimetype: 'image/gif', fileName: 'converted.gif' },
        { quoted: msg }
      );
      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      console.error('[togif] gagal:', err);
      await sock.sendMessage(chatId, { text: `Gagal convert ke GIF: ${err.message}` }, { quoted: msg });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },
};