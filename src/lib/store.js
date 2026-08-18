// Penyimpanan sederhana berbasis file JSON untuk data per-chat:
// - personality yang dipilih tiap chat
// - riwayat percakapan singkat (biar AI ingat konteks obrolan)
//
// Ini sengaja dibuat simpel (file JSON, bukan database) supaya gampang
// dibaca/diedit manual. Kalau nanti botnya makin besar dan butuh
// database asli (SQLite/PostgreSQL), tinggal ganti isi modul ini —
// fungsi yang dipakai command lain (get/set/appendHistory) tetap sama,
// jadi command lain tidak perlu diubah.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'chats.json');
const MAX_HISTORY = 12; // jumlah pesan terakhir yang diingat per chat

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function getChat(chatId) {
  const db = loadDb();
  if (!db[chatId]) {
    db[chatId] = { personality: null, history: [] };
    saveDb(db);
  }
  return db[chatId];
}

function setPersonality(chatId, personalityName) {
  const db = loadDb();
  if (!db[chatId]) db[chatId] = { personality: null, history: [] };
  db[chatId].personality = personalityName;
  saveDb(db);
}

function appendHistory(chatId, role, content) {
  const db = loadDb();
  if (!db[chatId]) db[chatId] = { personality: null, history: [] };
  db[chatId].history.push({ role, content });
  if (db[chatId].history.length > MAX_HISTORY) {
    db[chatId].history = db[chatId].history.slice(-MAX_HISTORY);
  }
  saveDb(db);
}

function clearHistory(chatId) {
  const db = loadDb();
  if (db[chatId]) {
    db[chatId].history = [];
    saveDb(db);
  }
}

function getCustomPersonalities() {
  const path = require('path');
  const filePath = path.join(__dirname, '..', 'data', 'custom-personalities.json');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCustomPersonalities(custom) {
  const path = require('path');
  const filePath = path.join(__dirname, '..', 'data', 'custom-personalities.json');
  fs.writeFileSync(filePath, JSON.stringify(custom, null, 2));
}

const PROTECTED_NAME = 'default';

function addCustomPersonality(chatId, personality) {
  if (!personality || !personality.name) {
    throw new Error('Personality butuh nama.');
  }
  if (personality.name.toLowerCase() === PROTECTED_NAME) {
    throw new Error(`Nama "${PROTECTED_NAME}" sudah dipakai personality bawaan dan nggak boleh ditimpa.`);
  }
  const custom = getCustomPersonalities();
  if (custom[personality.name]) {
    throw new Error(`Personality "${personality.name}" sudah ada. Pakai "edit" kalau mau ubah.`);
  }
  custom[personality.name] = personality;
  saveCustomPersonalities(custom);
}

function updateCustomPersonality(name, personality) {
  if (name.toLowerCase() === PROTECTED_NAME) {
    throw new Error(`Personality "${PROTECTED_NAME}" nggak bisa diubah.`);
  }
  const custom = getCustomPersonalities();
  if (custom[name]) {
    custom[name] = { ...personality, name }; // preserve name
    saveCustomPersonalities(custom);
    return true;
  }
  return false;
}

function deleteCustomPersonality(name) {
  if (name.toLowerCase() === PROTECTED_NAME) {
    throw new Error(`Personality "${PROTECTED_NAME}" nggak boleh dihapus (harus selalu ada minimal 1 personality).`);
  }
  const custom = getCustomPersonalities();
  if (custom[name]) {
    delete custom[name];
    saveCustomPersonalities(custom);
    return true;
  }
  return false;
}

function listAllPersonalities() {
  const builtins = require('../data/personalities.json');
  const custom = getCustomPersonalities();
  return { ...builtins, ...custom };
}

module.exports = { getChat, setPersonality, appendHistory, clearHistory, getCustomPersonalities, saveCustomPersonalities, addCustomPersonality, updateCustomPersonality, deleteCustomPersonality, listAllPersonalities };
