// Modul ini yang menghubungkan bot ke provider AI.
// Coba Groq dulu (paling cepat), kalau gagal/limit otomatis fallback
// ke Cerebras. Keduanya kompatibel format OpenAI jadi dipanggil pakai
// satu SDK yang sama, cuma beda baseURL.
//
// Kalau nanti mau ganti/tambah provider lain, cukup ubah file ini —
// selama fungsi getReply(chatId, userMessage) tetap mengembalikan
// string balasan, bagian lain bot tidak perlu diubah sama sekali.

const OpenAI = require('openai');
const config = require('../config');
const store = require('./store');

const groqClient = new OpenAI({ apiKey: config.groqApiKey, baseURL: 'https://api.groq.com/openai/v1' });
const cerebrasClient = new OpenAI({ apiKey: config.cerebrasApiKey, baseURL: 'https://api.cerebras.ai/v1' });

async function callProvider(client, model, systemPrompt, messages) {
  const response = await client.chat.completions.create({
    model,
    max_tokens: 400,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  });
  return (response.choices[0]?.message?.content || '').trim();
}

async function getReply(chatId, userMessage) {
  if (!config.groqApiKey && !config.cerebrasApiKey) {
    return 'GROQ_API_KEY / CEREBRAS_API_KEY belum diisi di file .env, jadi aku belum bisa ngobrol pakai AI dulu ya.';
  }

  const chat = store.getChat(chatId);
  const allPersonalities = store.listAllPersonalities();
  const personalityName = chat.personality || config.defaultPersonality;
  const personality = allPersonalities[personalityName] || allPersonalities.default;

  store.appendHistory(chatId, 'user', userMessage);
  const history = store.getChat(chatId).history;
  const messages = history.map((h) => ({ role: h.role, content: h.content }));

  let reply;
  if (config.groqApiKey) {
    try {
      reply = await callProvider(groqClient, config.groqModel, personality.systemPrompt, messages);
    } catch (err) {
      console.error('[ai] Groq gagal:', err.message);
    }
  }

  if (!reply && config.cerebrasApiKey) {
    try {
      reply = await callProvider(cerebrasClient, config.cerebrasModel, personality.systemPrompt, messages);
    } catch (err) {
      console.error('[ai] Cerebras juga gagal:', err.message);
    }
  }

  if (!reply) {
    throw new Error('Groq dan Cerebras sama-sama gagal merespons (cek API key & limit masing-masing).');
  }

  store.appendHistory(chatId, 'assistant', reply);
  return reply;
}

module.exports = { getReply };
