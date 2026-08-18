// Loader otomatis untuk semua command.
//
// CARA NAMBAH COMMAND BARU (ini bagian yang paling penting buat kamu):
// Tinggal buat file baru di folder ini, isinya:
//
//   module.exports = {
//     name: 'namacommand',            // dipanggil via .namacommand
//     aliases: ['alias1'],            // opsional
//     description: 'Penjelasan singkat buat .help',
//     execute: async (ctx) => {
//       // ctx berisi: sock, msg, chatId, senderId, isGroup, args, text,
//       // commands (Map semua command), config
//       await ctx.sock.sendMessage(ctx.chatId, { text: 'contoh balasan' });
//     },
//   };
//
// File ini otomatis ke-scan saat bot start. Tidak perlu edit file ini
// atau index.js sama sekali.

const fs = require('fs');
const path = require('path');

const commands = new Map();

for (const file of fs.readdirSync(__dirname)) {
  if (file === 'index.js' || !file.endsWith('.js')) continue;

  const cmd = require(path.join(__dirname, file));
  if (cmd && cmd.name && typeof cmd.execute === 'function') {
    commands.set(cmd.name, cmd);
    for (const alias of cmd.aliases || []) {
      commands.set(alias, cmd);
    }
  } else {
    console.warn(`[commands] Melewati ${file}: butuh minimal { name, execute }`);
  }
}

module.exports = commands;
