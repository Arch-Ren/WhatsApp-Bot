// Semua pengaturan bot dibaca dari .env di sini.
// Kalau nanti mau nambah pengaturan baru, cukup tambah baris di .env
// dan tambahkan di object ini.
require('dotenv').config();

module.exports = {
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  cerebrasApiKey: process.env.CEREBRAS_API_KEY || '',
  cerebrasModel: process.env.CEREBRAS_MODEL || 'llama-3.3-70b',
  ownerNumber: process.env.BOT_OWNER_NUMBER || '',
  defaultPersonality: process.env.DEFAULT_PERSONALITY || 'default',
  prefix: process.env.COMMAND_PREFIX || '.',
  ytdlpCookiesFromBrowser: process.env.YTDLP_COOKIES_FROM_BROWSER || 'chrome',
  ytdlpCookiesFile: process.env.YTDLP_COOKIES_FILE || './cookies.txt',
};
