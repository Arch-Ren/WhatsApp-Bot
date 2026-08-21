// Download video/audio dari TikTok/Instagram/Facebook/Twitter(X)/YouTube.
//
// Pakai `yt-dlp` (dipanggil lewat CLI, bukan npm package) karena
// situs-situs ini sering ganti struktur & yt-dlp adalah tool yang
// paling aktif di-update buat ngikutin perubahan itu.
//
// Install: pip install -U yt-dlp

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffprobePath = require('@derhuerst/ffprobe-static');
const ffmpegPath = require('ffmpeg-static');
const config = require('../config');

const MAX_SIZE_MB = 90; // batas aman ukuran file video buat dikirim lewat WA
const MAX_AUDIO_SIZE_MB = 16;
const URL_REGEX = /https?:\/\/\S+/i;
const AUDIO_KEYWORDS = ['mp3', 'audio', 'musik', 'music'];

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

// Sama seperti music.js — coba beberapa cara manggil yt-dlp, penting
// terutama di Windows (pip install naruh yt-dlp.exe di folder yang
// kadang nggak masuk PATH walau `python` sendiri jalan normal).
const YT_DLP_CANDIDATES = [
  { cmd: 'yt-dlp', prefixArgs: [] },
  { cmd: 'python', prefixArgs: ['-m', 'yt_dlp'] },
  { cmd: 'py', prefixArgs: ['-m', 'yt_dlp'] },
  { cmd: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
];
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
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      } else {
        reject(err);
      }
    });
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
      workingCandidateIndex = i;
      return;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  throw new Error(
    'yt-dlp nggak ketemu lewat cara manapun (yt-dlp / python -m yt_dlp / py -m yt_dlp / python3 -m yt_dlp). Install dulu: pip install -U yt-dlp'
  );
}

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

// Cek beneran isi file hasil download itu apa (video/gif/image/audio),
// BUKAN cuma nebak dari ekstensi nama file.
function probeMedia(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,nb_frames',
      '-show_entries', 'format=format_name',
      '-of', 'json',
      filePath,
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim().split('\n').pop() || 'ffprobe gagal membaca file.'));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Gagal membaca info file hasil download (JSON ffprobe rusak).'));
      }
    });
    proc.on('error', reject);
  });
}

function classifyMedia(probeResult) {
  const streams = probeResult.streams || [];
  const formatName = (probeResult.format && probeResult.format.format_name) || '';
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  if (videoStream) {
    if (videoStream.codec_name === 'gif' || formatName === 'gif') return 'gif';

    const imageCodecs = ['mjpeg', 'png', 'bmp', 'webp'];
    const frameCount = parseInt(videoStream.nb_frames, 10);
    if (imageCodecs.includes(videoStream.codec_name) && (!frameCount || frameCount <= 1)) {
      return 'image';
    }
    return 'video';
  }
  if (audioStream) return 'audio';
  return 'unknown';
}

// BUG #1 FIX: WhatsApp cuma bisa mutar video H.264 (avc) + audio AAC di
// dalam kontainer mp4. YouTube/platform lain sering kasih "best" quality
// dalam codec VP9/AV1 yang tetap ber-ekstensi .mp4 — makanya galeri HP
// bilang itu file mp4 valid, tapi WhatsApp nolak mutar ("format tidak
// didukung"). Kalau codec-nya nggak kompatibel, transcode paksa ke
// H.264/AAC di sini sebelum dikirim, supaya DIJAMIN bisa diputar di WA.
async function ensureWhatsAppCompatibleVideo(filePath, probeResult) {
  const streams = probeResult.streams || [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  const videoOk = !videoStream || videoStream.codec_name === 'h264';
  const audioOk = !audioStream || videoStream?.codec_name === 'gif' || audioStream.codec_name === 'aac';

  if (videoOk && audioOk) return filePath;

  const outPath = `${filePath}.compat.mp4`;
  await runFfmpeg([
    '-y', '-i', filePath,
    '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outPath,
  ]);
  return outPath;
}

module.exports = {
  name: 'download',
  aliases: ['dl', 'sedot'],
  description:
    'Download dari TikTok/Instagram/Facebook/Twitter(X)/YouTube. Pakai: .download <link> [mp3]. ' +
    'Tambahkan "mp3"/"audio" di akhir buat ambil audio-nya doang.',
  execute: async (ctx) => {
    const { sock, chatId, msg, text } = ctx;
    const match = text.match(URL_REGEX);

    if (!match) {
      await sock.sendMessage(
        chatId,
        { text: 'Kirim link-nya, contoh:\n.download https://www.tiktok.com/@user/video/xxxx\n.download https://youtu.be/xxxx mp3  (buat audio doang)' },
        { quoted: msg }
      );
      return;
    }

    const url = match[0];
    const afterUrl = text.slice(text.indexOf(url) + url.length).trim().toLowerCase();
    const wantAudio = AUDIO_KEYWORDS.some((kw) => afterUrl.includes(kw));
    const platform = detectPlatform(url);
    const maxMb = wantAudio ? MAX_AUDIO_SIZE_MB : MAX_SIZE_MB;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-dl-'));
    const outputTemplate = path.join(tmpDir, 'media.%(ext)s');

    try {
      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

      // BUG #1 FIX: minta codec H.264/AAC dari yt-dlp duluan (bukan
      // cuma "best" tanpa syarat codec). --ffmpeg-location dibutuhkan
      // karena yt-dlp perlu ffmpeg buat gabungin video+audio kalau
      // sumbernya kasih dua stream terpisah.
      const ytArgs = wantAudio
        ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0']
        : [
            '-f',
            `bestvideo[vcodec^=avc1][filesize<${maxMb}M]+bestaudio[acodec^=mp4a]/` +
              `best[vcodec^=avc1][filesize<${maxMb}M]/best[filesize<${maxMb}M]/best`,
            '--merge-output-format', 'mp4',
            '--ffmpeg-location', ffmpegPath,
          ];

      // BUG #2 FIX: kalau YTDLP_COOKIES_FILE atau YTDLP_COOKIES_FROM_BROWSER
      // diisi di .env, pakai cookies itu supaya video yang butuh login
      // (age-restricted, dll) tetap bisa didownload. cookiesFile menang
      // kalau dua-duanya diisi (itu yang kepakai di server headless
      // kayak EC2 — nggak ada browser buat --cookies-from-browser).
      let cookieArgs = [];
      if (config.ytdlpCookiesFile) {
        cookieArgs = ['--cookies', config.ytdlpCookiesFile];
      } else if (config.ytdlpCookiesFromBrowser) {
        cookieArgs = ['--cookies-from-browser', config.ytdlpCookiesFromBrowser];
      }

      await runYtDlp([
        ...ytArgs,
        ...cookieArgs,
        '--max-filesize', `${maxMb}M`,
        '--no-playlist',
        // Mitigasi umum error 403 dari YouTube saat ini.
        '--extractor-args', 'youtube:player_client=android,web',
        '-o', outputTemplate,
        url,
      ]);

      const files = fs.readdirSync(tmpDir);
      if (!files.length) {
        throw new Error('File hasil download nggak ketemu (kontennya mungkin private/sudah dihapus).');
      }

      let filePath = path.join(tmpDir, files[0]);
      let stat = fs.statSync(filePath);
      if (stat.size > maxMb * 1024 * 1024) {
        throw new Error(`File terlalu besar (${(stat.size / 1024 / 1024).toFixed(1)}MB, batas ${maxMb}MB).`);
      }

      // Validasi format beneran sebelum dikirim, bukan cuma tebak dari ekstensi.
      const probeResult = await probeMedia(filePath);
      const kind = wantAudio ? 'audio' : classifyMedia(probeResult);

      // BUG #1 FIX: transcode kalau codec-nya nggak kompatibel WA.
      if (kind === 'video' || kind === 'gif') {
        filePath = await ensureWhatsAppCompatibleVideo(filePath, probeResult);
        stat = fs.statSync(filePath);
        if (stat.size > maxMb * 1024 * 1024) {
          throw new Error(
            `File hasil convert ke format kompatibel WA jadi ${(stat.size / 1024 / 1024).toFixed(1)}MB (batas ${maxMb}MB). Coba video yang lebih pendek.`
          );
        }
      }

      const buffer = fs.readFileSync(filePath);

      if (kind === 'video') {
        await sock.sendMessage(chatId, { video: buffer, caption: `Diunduh dari ${platform}` }, { quoted: msg });
      } else if (kind === 'gif') {
        await sock.sendMessage(chatId, { video: buffer, gifPlayback: true, caption: `Diunduh dari ${platform}` }, { quoted: msg });
      } else if (kind === 'image') {
        await sock.sendMessage(chatId, { image: buffer, caption: `Diunduh dari ${platform}` }, { quoted: msg });
      } else if (kind === 'audio') {
        await sock.sendMessage(
          chatId,
          { audio: buffer, mimetype: 'audio/mpeg', fileName: 'audio.mp3', caption: wantAudio ? `Diunduh dari ${platform}` : undefined },
          { quoted: msg }
        );
      } else {
        await sock.sendMessage(
          chatId,
          { document: buffer, fileName: path.basename(filePath), caption: `Diunduh dari ${platform} (format nggak terdeteksi, dikirim sebagai file biasa)` },
          { quoted: msg }
        );
      }

      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      console.error('[download] gagal:', err);

      // BUG #3: TikTok "Unexpected response" itu bug AKTIF & BELUM
      // ADA FIX RESMI di yt-dlp per Agustus 2026 (dilaporkan di GitHub
      // issue #17403/#17407/#17414), bukan salah konfigurasi bot ini.
      // Kasih pesan yang jujur, bukan pesan error generik yang
      // menyesatkan seolah ini bisa diperbaiki dari sisi kita.
      if (platform === 'TikTok' && /unexpected response/i.test(err.message)) {
        await sock.sendMessage(
          chatId,
          {
            text:
              'Gagal download dari TikTok: ini bug yang lagi aktif di yt-dlp sendiri (belum ada fix resmi per sekarang), ' +
              'bukan masalah di bot ini. Coba lagi beberapa saat/hari lagi (biasanya nyusul di-patch), atau pastikan yt-dlp ' +
              'kamu versi terbaru dengan "pip install -U yt-dlp".',
          },
          { quoted: msg }
        );
        return;
      }

      await sock.sendMessage(chatId, { text: `Gagal download dari ${platform}: ${err.message}` }, { quoted: msg });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },
};
