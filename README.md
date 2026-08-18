# WA Bot — Sticker Maker + Upscale + AI Chatbot + Downloader

Bot WhatsApp dengan fitur:
- **Sticker maker** — kirim/reply gambar atau GIF dengan `.sticker` → jadi stiker WA
- **Upscale gambar** — perbesar & pertajam gambar dengan `.upscale`
- **Chatbot AI ber-personality** — ngobrol pakai Groq (fallback ke Cerebras), personality bisa di-CRUD per-chat
- **Downloader** — download video TikTok/Instagram/Facebook/Twitter(X)/YouTube dengan `.download <link>`

Dibangun pakai [Baileys](https://github.com/WhiskeySockets/Baileys) + Node.js, dengan arsitektur command yang gampang ditambah sendiri (auto-load dari `src/commands/`).

## 1. Prasyarat

- **Node.js 18+**
- `ffmpeg` sudah otomatis ter-bundle lewat package `ffmpeg-static`, nggak perlu install manual.
- **yt-dlp** untuk fitur `.download` — **ini perlu diinstall manual**, nggak bisa lewat npm (situs-situs medsos sering berubah, jadi butuh tool yang aktif di-update):
  ```bash
  pip install -U yt-dlp
  ```
  Update berkala disarankan (`pip install -U yt-dlp` lagi) karena TikTok/Instagram/dst sering ganti struktur, dan yt-dlp rilis fix baru cukup sering.
- API key **Groq** (gratis, [console.groq.com](https://console.groq.com)) dan/atau **Cerebras** (gratis, [cloud.cerebras.ai](https://cloud.cerebras.ai)) untuk fitur chatbot.

## 2. Instalasi

```bash
npm install
```

`.env` kamu sudah ada isinya (sesi WA & config lama) — aku sudah tambahkan baris `GROQ_API_KEY` / `CEREBRAS_API_KEY` di bagian bawah file itu, tinggal isi. `GEMINI_API_KEY` yang lama boleh dibiarkan (sudah nggak dipakai) atau dihapus manual.

## 3. Menjalankan

```bash
npm start
```

Sesi WhatsApp kamu sudah tersimpan di `auth_info/`, jadi harusnya langsung connect tanpa perlu scan ulang QR (kecuali sesi itu di-logout dari HP).

## 4. Command yang tersedia

| Command | Fungsi |
|---|---|
| `.sticker` / `.s` | Reply atau kirim gambar/GIF dengan caption ini → jadi stiker |
| `.upscale [faktor]` | Reply gambar → diperbesar & dipertajam (faktor 1.5–4x, default 2x) |
| `.download <link>` / `.dl` / `.sedot` | Download video dari TikTok/Instagram/Facebook/Twitter(X)/YouTube |
| `.chat <pesan>` / `.c` | Ngobrol dengan AI (di chat pribadi, boleh langsung ketik tanpa command) |
| `.personality list` | Lihat daftar karakter chatbot |
| `.personality get <nama>` | Lihat detail satu personality |
| `.personality set <nama>` | Ganti personality aktif untuk chat ini |
| `.personality add <nama> \| <label> \| <system prompt>` | Bikin personality custom baru |
| `.personality edit <nama> \| <label> \| <system prompt>` | Update personality custom |
| `.personality delete <nama>` | Hapus personality custom (`default` **tidak bisa dihapus/ditimpa**) |
| `.help` / `.menu` | Lihat semua command |

**Catatan `.download`:** dibatasi maksimal ±90MB per file (batas aman WA) dan cuma ambil video utama (`--no-playlist`). Instagram & Facebook kadang butuh login buat konten tertentu (private/dibatasi wilayah) — kalau sering gagal khusus 2 platform itu, kabari aku, ada opsi pakai cookie file yang bisa ditambahkan nanti.

**Catatan `.upscale`:** pembesaran resolusi + penajaman biasa (Lanczos + sharpen via `sharp`), **bukan** AI super-resolution — detail yang sudah hilang di foto asli nggak "diciptakan ulang".

**Personality CRUD:** personality custom disimpan di `src/data/custom-personalities.json` (terpisah dari `src/data/personalities.json` yang isinya personality bawaan). `default` khusus dilindungi di level kode (`src/lib/store.js`) — nggak bisa ditimpa nama-nya, diedit, atau dihapus lewat command apa pun.

## 5. AI provider: Groq + Cerebras (fallback otomatis)

`src/lib/ai.js` coba **Groq dulu**, kalau gagal/limit/API key kosong → fallback ke **Cerebras**. Kalau keduanya kosong, `.chat` akan kasih pesan error yang jelas alih-alih diam saja.

## 6. Cara nambah command baru

Buat file baru di `src/commands/`, format:

```js
module.exports = {
  name: 'namacommand',
  aliases: ['alias1'],
  description: 'Penjelasan buat .help',
  execute: async (ctx) => {
    // ctx: sock, msg, chatId, senderId, isGroup, args, text, commands, config
    await ctx.sock.sendMessage(ctx.chatId, { text: 'contoh balasan' });
  },
};
```

Otomatis ke-load, nggak perlu edit `index.js`.

## 7. Keamanan — PENTING

Folder `auth_info/` berisi kredensial sesi WhatsApp aktif kamu, dan `.env` berisi API key asli. **Jangan pernah**:
- Push folder ini ke repository publik (GitHub public, dsb)
- Share file zip/folder project ini ke orang lain
- Upload ke hosting/paste site publik

Kalau nggak sengaja bocor, segera logout perangkat itu dari WhatsApp (Setelan → Perangkat Tertaut) dan cabut/ganti API key yang ada di `.env`.
