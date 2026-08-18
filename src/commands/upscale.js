const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const sharp = require('sharp');

const MIN_FACTOR = 1.5;
const MAX_FACTOR = 4;
const DEFAULT_FACTOR = 2;

function findImage(msg) {
  const message = msg.message || {};
  const quoted = message.extendedTextMessage?.contextInfo?.quotedMessage;
  const source = quoted || message;
  if (source.imageMessage) return { message: source };
  return null;
}

module.exports = {
  name: 'upscale',
  aliases: ['hd', 'perbesar'],
  description:
    'Perbesar & pertajam gambar. Reply gambar dengan .upscale [faktor 1.5-4, default 2]. ' +
    'Catatan: ini pembesaran resolusi + penajaman biasa (bukan AI super-resolution), jadi detail yang sudah hilang di gambar asli nggak akan "diciptakan" ulang.',
  execute: async (ctx) => {
    const { sock, msg, chatId, args } = ctx;
    const media = findImage(msg);

    if (!media) {
      await sock.sendMessage(
        chatId,
        { text: 'Reply gambar dengan caption .upscale (boleh tambah faktor, misal ".upscale 3").' },
        { quoted: msg }
      );
      return;
    }

    let factor = parseFloat(args[0]);
    if (!Number.isFinite(factor)) factor = DEFAULT_FACTOR;
    factor = Math.min(Math.max(factor, MIN_FACTOR), MAX_FACTOR);

    try {
      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

      const buffer = await downloadMediaMessage(media, 'buffer', {});
      const metadata = await sharp(buffer).metadata();
      const targetWidth = Math.round((metadata.width || 512) * factor);
      const targetHeight = Math.round((metadata.height || 512) * factor);

      const upscaled = await sharp(buffer)
        .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
        .sharpen({ sigma: 1 })
        .jpeg({ quality: 92 })
        .toBuffer();

      await sock.sendMessage(
        chatId,
        { image: upscaled, caption: `Diperbesar ${factor}x (${metadata.width}x${metadata.height} → ${targetWidth}x${targetHeight})` },
        { quoted: msg }
      );
      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      console.error('[upscale] gagal:', err);
      await sock.sendMessage(chatId, { text: `Gagal upscale: ${err.message}` }, { quoted: msg });
    }
  },
};
