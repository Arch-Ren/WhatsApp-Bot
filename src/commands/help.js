module.exports = {
  name: 'help',
  aliases: ['menu'],
  description: 'Menampilkan daftar command yang tersedia',
  execute: async (ctx) => {
    const { sock, chatId, commands, config } = ctx;
    const seen = new Set();
    const lines = [];

    for (const cmd of commands.values()) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      lines.push(`*${config.prefix}${cmd.name}* — ${cmd.description} \n`);
    }

    await sock.sendMessage(chatId, { text: `Daftar command:\n\n${lines.join('\n')}` });
  },
};
