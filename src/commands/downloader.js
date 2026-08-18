// Download video dari TikTok/Instagram/Facebook/Twitter(X)/YouTube.
//
// Pakai `yt-dlp` (dipanggil lewat CLI, bukan npm package) karena
// situs-situs ini sering ganti struktur & yt-dlp adalah tool yang
// paling aktif di-update buat ngikutin perubahan itu. npm package
// wrapper yang ada semuanya sudah nggak di-maintain / bundling versi
// lama yang gampang rusak.
//
// Install: pip install -U yt-dlp   (lihat README buat detail)

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_SIZE_MB = 90; // batas aman ukuran file buat dikirim lewat WA
const URL_REGEX = /https?:\/\/\S+/i;

const PLATFORM_PATTERNS = [
  { name: 'TikTok', pattern: /tiktok\.com/i },
  { name: 'Instagram', pattern: /instagram\.com/i },
  { name: 'Facebook', pattern: /(facebook\.com|fb\.watch)/i },
  { name: 'Twitter/X', pattern: /(twitter\.com|x\.com)/i },
  { name: 'YouTube', pattern: /(youtube\.com|youtu\.be)/i },
];

function detectPlatform(url) {
  const found = PLATFORM_PATTERNS.find((p) => p.pattern.test(url));
  return found ? found.name : 'link ini';
}

// Beberapa cara buat manggil yt-dlp, dicoba berurutan. Ini nolong di
// Windows terutama, di mana `yt-dlp` polos sering nggak ke-detect di
// PATH walau `python -m yt_dlp` jalan normal dari terminal manapun.
const YT_DLP_CANDIDATES = [
  { cmd: 'yt-dlp', prefixArgs: [] },
  { cmd: 'python', prefixArgs: ['-m', 'yt_dlp'] },
  { cmd: 'py', prefixArgs: ['-m', 'yt_dlp'] }, // Windows py launcher
  { cmd: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
];
 
// Cache index kandidat yang berhasil, biar panggilan berikutnya
// nggak perlu coba satu-satu lagi dari awal.
let workingCandidateIndex = null;
 
function trySpawn(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split('\n').pop() || `keluar dengan kode ${code}`));
    });
    proc.on('error', (err) => reject(err));
  });
}
 
async function runYtDlp(args) {
  if (workingCandidateIndex !== null) {
    const c = YT_DLP_CANDIDATES[workingCandidateIndex];
    return trySpawn(c.cmd, [...c.prefixArgs, ...args]);
  }
 
  for (let i = 0; i < YT_DLP_CANDIDATES.length; i++) {
    const c = YT_DLP_CANDIDATES[i];
    try {
      await trySpawn(c.cmd, [...c.prefixArgs, ...args]);
      workingCandidateIndex = i; // ketemu yang jalan, dipakai terus buat panggilan berikutnya
      return;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Command-nya ADA tapi gagal karena alasan lain (URL invalid,
        // konten private, dll) -> jangan coba kandidat lain, lempar
        // error asli biar pesannya jelas.
        throw err;
      }
      // ENOENT = command ini nggak ada di sistem, lanjut coba kandidat berikutnya.
    }
  }
 
  throw new Error(
    'yt-dlp nggak ketemu lewat cara manapun (yt-dlp / python -m yt_dlp / py -m yt_dlp / python3 -m yt_dlp). ' +
    'Pastikan sudah "pip install -U yt-dlp" dan Python ada di PATH.'
  );
}

module.exports = {
  name: 'download',
  aliases: ['dl', 'sedot'],
  description:
    'Download video dari TikTok/Instagram/Facebook/Twitter(X)/YouTube. Pakai: .download <link>',
  execute: async (ctx) => {
    const { sock, chatId, msg, text } = ctx;
    const match = text.match(URL_REGEX);

    if (!match) {
      await sock.sendMessage(
        chatId,
        { text: 'Kirim link-nya, contoh: .download https://www.tiktok.com/@user/video/xxxx' },
        { quoted: msg }
      );
      return;
    }

    const url = match[0];
    const platform = detectPlatform(url);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-dl-'));
    const outputTemplate = path.join(tmpDir, 'media.%(ext)s');

    try {
      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

      await runYtDlp([
        '-f', `best[filesize<${MAX_SIZE_MB}M]/best`,
        '--max-filesize', `${MAX_SIZE_MB}M`,
        '--no-playlist',
        '-o', outputTemplate,
        url,
      ]);

      const files = fs.readdirSync(tmpDir);
      if (!files.length) {
        throw new Error('File hasil download nggak ketemu (kontennya mungkin private/sudah dihapus).');
      }

      const filePath = path.join(tmpDir, files[0]);
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_SIZE_MB * 1024 * 1024) {
        throw new Error(`File terlalu besar (${(stat.size / 1024 / 1024).toFixed(1)}MB, batas ${MAX_SIZE_MB}MB).`);
      }

      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const isVideo = ['.mp4', '.mkv', '.webm', '.mov'].includes(ext);

      if (isVideo) {
        await sock.sendMessage(chatId, { video: buffer, caption: `Diunduh dari ${platform}` }, { quoted: msg });
      } else {
        await sock.sendMessage(chatId, { image: buffer, caption: `Diunduh dari ${platform}` }, { quoted: msg });
      }

      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      console.error('[download] gagal:', err);
      await sock.sendMessage(chatId, { text: `Gagal download dari ${platform}: ${err.message}` }, { quoted: msg });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },
};
