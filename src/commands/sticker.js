const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { imageToSticker, animatedToSticker } = require('../lib/sticker');

// Cari media (gambar/GIF/video) baik dari pesan yang di-reply, maupun
// dari pesan itu sendiri (kirim gambar langsung dengan caption .sticker).
function findMedia(msg) {
  const message = msg.message || {};
  const quoted = message.extendedTextMessage?.contextInfo?.quotedMessage;
  const source = quoted || message;

  if (source.imageMessage) return { type: 'image', wrapped: { message: source } };
  if (source.videoMessage) return { type: 'video', wrapped: { message: source } };
  return null;
}

module.exports = {
  name: 'sticker',
  aliases: ['s', 'stiker'],
  description: 'Ubah gambar/GIF jadi stiker. Kirim gambar/GIF dengan caption .sticker, atau reply media itu dengan .sticker',
  execute: async (ctx) => {
    const { sock, msg, chatId } = ctx;
    const media = findMedia(msg);

    if (!media) {
      await sock.sendMessage(
        chatId,
        { text: 'Kirim gambar/GIF dengan caption .sticker, atau reply gambar/GIF yang sudah ada dengan .sticker.' },
        { quoted: msg }
      );
      return;
    }

    try {
      await sock.sendMessage(chatId, { react: { text: '⏳', key: msg.key } });

      const buffer = await downloadMediaMessage(media.wrapped, 'buffer', {});
      const stickerBuffer =
        media.type === 'image'
          ? await imageToSticker(buffer)
          : await animatedToSticker(buffer, { inputExt: 'mp4' });

      await sock.sendMessage(chatId, { sticker: stickerBuffer }, { quoted: msg });
      await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      console.error('[sticker] gagal bikin stiker:', err);
      await sock.sendMessage(chatId, { text: `Gagal bikin stiker: ${err.message}` }, { quoted: msg });
    }
  },
};
