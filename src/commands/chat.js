const ai = require('../lib/ai');

module.exports = {
  name: 'chat',
  aliases: ['c'],
  description: 'Ngobrol dengan AI. Pakai: .chat <pesan>. Di chat pribadi, kamu juga bisa langsung chat tanpa perintah ini.',
  execute: async (ctx) => {
    const { sock, chatId, text, msg } = ctx;

    if (!text.trim()) {
      await sock.sendMessage(chatId, { text: 'Contoh: .chat halo, lagi ngapain?' }, { quoted: msg });
      return;
    }

    try {
      await sock.sendPresenceUpdate('composing', chatId);
      const reply = await ai.getReply(chatId, text.trim());
      await sock.sendMessage(chatId, { text: reply }, { quoted: msg });
    } catch (err) {
      console.error('[chat] error:', err);
      await sock.sendMessage(chatId, { text: `Ada error pas manggil AI: ${err.message}` }, { quoted: msg });
    }
  },
};
