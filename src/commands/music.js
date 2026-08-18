// Download musik (MP3) dari YouTube/SoundCloud, dari link Spotify
// (diresolve dulu judulnya lalu dicari di YouTube), atau langsung dari
// query teks biasa (nama lagu).
//
// Pakai yt-dlp yang sama kayak downloader.js buat extract+convert audio.
// FLAC SENGAJA TIDAK didukung: audio dari platform-platform ini sudah
// lossy dari sumbernya, jadi convert ke FLAC cuma bikin file lebih
// besar tanpa peningkatan kualitas nyata (repack, bukan upgrade).

const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_SIZE_MB = 16; // audio jauh lebih kecil dari video, batas WA audio message
const SPOTIFY_REGEX = /open\.spotify\.com\/(intl-\w+\/)?(track|album)\/[A-Za-z0-9]+/i;
const URL_REGEX = /https?:\/\/\S+/i;

// Sama seperti downloader.js — coba beberapa cara manggil yt-dlp,
// penting terutama di Windows (lihat catatan di downloader.js).
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

// Spotify nggak punya audio yang bisa didownload langsung (DRM), jadi
// kita cuma ambil JUDUL lagunya lewat endpoint oEmbed publik mereka
// (nggak butuh API key/login), lalu dicari ulang di YouTube.
//
// CATATAN: field "title" dari oEmbed Spotify setahu aku cuma nama
// lagunya (belum tentu termasuk nama artis) — aku nggak bisa
// verifikasi live persis formatnya karena sandbox ini nggak ada akses
// ke open.spotify.com. Kalau hasil pencariannya sering meleset/dapat
// lagu yang salah, kabari aku, nanti aku sesuaikan parsing-nya.
function resolveSpotifyTitle(spotifyUrl) {
  return new Promise((resolve, reject) => {
    const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
    https.get(oembedUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.title) resolve(json.title);
          else reject(new Error('Nggak nemu judul dari link Spotify ini.'));
        } catch {
          reject(new Error('Gagal baca info dari Spotify (link mungkin nggak valid/private).'));
        }
      });
    }).on('error', () => reject(new Error('Gagal menghubungi Spotify.')));
  });
}

module.exports = {
  name: 'music',
  aliases: ['mp3', 'lagu'],
  description:
    'Download lagu (MP3) dari YouTube/SoundCloud, link Spotify, atau langsung nama lagu. ' +
    'Pakai: .music <link atau nama lagu>. Catatan: cuma MP3, FLAC nggak didukung karena ' +
    'audio dari platform ini sudah lossy dari sumbernya.',
  execute: async (ctx) => {
    const { sock, chatId, msg, text } = ctx;
    const query = text.trim();

    if (!query) {
      await sock.sendMessage(
        chatId,
        { text: 'Contoh: .music Blinding Lights The Weeknd\natau: .music https://open.spotify.com/track/xxxx\natau: .music https://youtu.be/xxxx' },
        { quoted: msg }
      );
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-music-'));
    const outputTemplate = path.join(tmpDir, 'audio.%(ext)s');

    try {
      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

      let target = query;
      let caption = null;

      if (SPOTIFY_REGEX.test(query)) {
        const title = await resolveSpotifyTitle(query);
        target = `ytsearch1:${title} official audio`;
        caption = `🎵 ${title} (dicari di YouTube dari link Spotify)`;
      } else if (!URL_REGEX.test(query)) {
        // bukan link -> anggap query pencarian
        target = `ytsearch1:${query}`;
        caption = `🎵 ${query}`;
      }

      await runYtDlp([
        '-x', '--audio-format', 'mp3',
        '--audio-quality', '0',
        '--embed-thumbnail', '--embed-metadata',
        '--max-filesize', `${MAX_SIZE_MB}M`,
        '--no-playlist',
        // Mitigasi umum buat error 403 dari YouTube saat ini — lihat
        // catatan sama di downloader.js.
        '--extractor-args', 'youtube:player_client=android,web',
        '-o', outputTemplate,
        target,
      ]);

      const files = fs.readdirSync(tmpDir);
      if (!files.length) {
        throw new Error('File audio nggak ketemu (mungkin nggak ada hasil pencarian atau kontennya private).');
      }

      const filePath = path.join(tmpDir, files[0]);
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_SIZE_MB * 1024 * 1024) {
        throw new Error(`File terlalu besar (${(stat.size / 1024 / 1024).toFixed(1)}MB, batas ${MAX_SIZE_MB}MB).`);
      }

      const buffer = fs.readFileSync(filePath);
      await sock.sendMessage(
        chatId,
        { audio: buffer, mimetype: 'audio/mpeg', fileName: 'audio.mp3', caption: caption || undefined },
        { quoted: msg }
      );
      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      console.error('[music] gagal:', err);
      await sock.sendMessage(chatId, { text: `Gagal download musik: ${err.message}` }, { quoted: msg });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  },
};