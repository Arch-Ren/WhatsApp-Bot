const store = require('../lib/store');

function splitPipe(text, expectedParts) {
  const parts = text.split('|').map((s) => s.trim());
  return parts.length >= expectedParts ? parts : null;
}

module.exports = {
  name: 'personality',
  aliases: ['karakter', 'p'],
  description:
    'Kelola karakter chatbot. Pakai: .personality list | get <nama> | set <nama> | ' +
    'add <nama> | <label> | <system prompt> | edit <nama> | <label baru> | <prompt baru> | delete <nama>',
  execute: async (ctx) => {
    const { sock, chatId, text } = ctx;
    const trimmed = text.trim();
    const spaceIdx = trimmed.indexOf(' ');
    const sub = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase() || 'list';
    const rest = (spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)).trim();

    try {
      const all = store.listAllPersonalities();

      if (sub === 'list' || sub === '') {
        const lines = Object.entries(all).map(([key, p]) => `• *${key}* — ${p.label}`).join('\n');
        await sock.sendMessage(chatId, {
          text: `Personality yang tersedia:\n${lines}\n\nDetail: .personality get <nama>\nGanti: .personality set <nama>\nTambah: .personality add <nama> | <label> | <system prompt>`,
        });
        return;
      }

      if (sub === 'get') {
        const name = rest.toLowerCase();
        const p = all[name];
        if (!p) {
          await sock.sendMessage(chatId, { text: `Personality "${name}" nggak ditemukan.` });
          return;
        }
        await sock.sendMessage(chatId, { text: `*${name}* — ${p.label}\n\nSystem prompt:\n${p.systemPrompt}` });
        return;
      }

      if (sub === 'set') {
        const name = rest.toLowerCase();
        const p = all[name];
        if (!p) {
          await sock.sendMessage(chatId, { text: `Personality "${name}" nggak ada. Cek ".personality list" dulu.` });
          return;
        }
        store.setPersonality(chatId, name);
        store.clearHistory(chatId);
        await sock.sendMessage(chatId, { text: `Oke, personality chat ini diganti ke *${p.label}*.` });
        return;
      }

      if (sub === 'add') {
        const parts = splitPipe(rest, 3);
        if (!parts) {
          await sock.sendMessage(chatId, {
            text: 'Format: .personality add <nama> | <label> | <system prompt>\nContoh: .personality add kocak | Kocak/Receh | Kamu suka melempar candaan receh tiap balasan.',
          });
          return;
        }
        const [name, label, ...promptParts] = parts;
        store.addCustomPersonality(chatId, {
          name: name.toLowerCase(),
          label,
          systemPrompt: promptParts.join('|').trim(),
        });
        await sock.sendMessage(chatId, { text: `Personality *${name}* berhasil ditambahkan.` });
        return;
      }

      if (sub === 'edit') {
        const parts = splitPipe(rest, 3);
        if (!parts) {
          await sock.sendMessage(chatId, {
            text: 'Format: .personality edit <nama> | <label baru> | <system prompt baru>\nCek ".personality get <nama>" dulu buat lihat isi sekarang kalau cuma mau ubah salah satu.',
          });
          return;
        }
        const [name, label, ...promptParts] = parts;
        const ok = store.updateCustomPersonality(name.toLowerCase(), {
          label,
          systemPrompt: promptParts.join('|').trim(),
        });
        if (!ok) {
          await sock.sendMessage(chatId, {
            text: `Personality "${name}" nggak ditemukan di daftar custom (personality bawaan nggak bisa diedit).`,
          });
          return;
        }
        await sock.sendMessage(chatId, { text: `Personality *${name}* berhasil diupdate.` });
        return;
      }

      if (sub === 'delete' || sub === 'remove') {
        const name = rest.toLowerCase();
        const ok = store.deleteCustomPersonality(name);
        if (!ok) {
          await sock.sendMessage(chatId, {
            text: `Personality "${name}" nggak ditemukan di daftar custom (personality bawaan nggak bisa dihapus).`,
          });
          return;
        }
        await sock.sendMessage(chatId, { text: `Personality *${name}* dihapus.` });
        return;
      }

      await sock.sendMessage(chatId, {
        text: 'Pakai: .personality list | get <nama> | set <nama> | add <nama> | <label> | <prompt> | edit <nama> | <label> | <prompt> | delete <nama>',
      });
    } catch (err) {
      await sock.sendMessage(chatId, { text: `Gagal: ${err.message}` });
    }
  },
};
