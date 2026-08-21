const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');

const config = require('./src/config');
const commands = require('./src/commands');
const ai = require('./src/lib/ai');

const AUTH_DIR = path.join(__dirname, 'auth_info');
let reconnectTimer = null;

function waitForSocketOpen(sock, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout menunggu koneksi WhatsApp'));
    }, timeoutMs);

    const onUpdate = (u) => {
      if (u.connection === 'open') {

        
        cleanup();
        resolve();
      } else if (u.connection === 'close') {
        cleanup();
        reject(new Error('Connection closed sebelum pairing'));
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      sock.ev.off('connection.update', onUpdate);
    };

    sock.ev.on('connection.update', onUpdate);
  });
}

function waitForConnectionEvent(sock, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout menunggu event connection.update'));
    }, timeoutMs);

    const onUpdate = (u) => {
      if (u.connection || u.qr) {
        cleanup();
        resolve(u);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      sock.ev.off('connection.update', onUpdate);
    };

    sock.ev.on('connection.update', onUpdate);
  });
}


if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

async function startBot() {
  const { version, isLatest } = await fetchLatestBaileysVersion();
  //console.log('Baileys Version :', version);
  //console.log('Latest          :', isLatest);
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ['Chrome', 'Ubuntu', '1.0.0'],
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    markOnlineOnConnect: true,
});

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    //console.log('\n=== CONNECTION UPDATE ===');
    //console.dir(update, { depth: null });
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan QR code ini lewat WhatsApp > Perangkat Tertaut > Tautkan Perangkat:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(
        'Koneksi terputus.',
        shouldReconnect
          ? 'Mencoba menyambung ulang...'
          : 'Sesi logout. Hapus folder auth_info/ lalu jalankan ulang untuk scan QR baru.'
      );
      if (shouldReconnect && !reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          startBot().catch((err) => {
            console.error('Gagal reconnect bot:', err);
          });
        }, 3000);
      }
    } else if (connection === 'open') {

      
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      console.log('Bot WhatsApp berhasil terhubung ✅');

      // Kirim pesan tes langsung ke Owner saat berhasil connect
      (async () => {
        try {
          const ownerNumber = config.ownerNumber.replace(/\D/g, '');
          const ownerInfo = await sock.onWhatsApp(ownerNumber);
          const ownerJid = ownerInfo?.[0]?.jid || jidNormalizedUser(`${ownerNumber}@s.whatsapp.net`);
          //console.log(`[TEST OWNER] Mencoba mengirim pesan startup ke owner: ${ownerJid}`);
          //const result = await sock.sendMessage(ownerJid, { text: 'Halo Rover, Aemeath disini.' });
          //console.log('[TEST OWNER] Pesan startup berhasil dikirim ke log!');
          //console.log('Hasil sendMessage:', result);
        } catch (err) {
          //console.error('[TEST OWNER] Gagal mengirim ke owner:', err);
        }
      })();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      // Beri WA jeda sebentar (anti-spam drop server-side)
      await new Promise((resolve) => setTimeout(resolve, 500));

      const text = getMessageText(msg);
      

      try {
        await handleMessage(sock, msg);
      } catch (err) {
        console.error('[handleMessage] error:', err);
      }
    }
  });
}

function getMessageText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

async function handleMessage(sock, msg) {
  if (!msg.message || msg.key.fromMe) return;

  const rawChatId = msg.key.remoteJid;
  if (!rawChatId) return;

  const chatId = jidNormalizedUser(rawChatId);
  const isGroup = rawChatId.endsWith('@g.us');
  const senderId = isGroup ? msg.key.participant || rawChatId : rawChatId;
    const text = getMessageText(msg).trim();
  if (!text) return;

  const prefix = config.prefix;
  const baseCtx = { sock, msg, chatId, senderId, isGroup, commands, config };

  // --- Command (diawali prefix, misal: .sticker, .chat, .personality) ---
  if (text.startsWith(prefix)) {
    const [cmdNameRaw, ...rest] = text.slice(prefix.length).trim().split(/\s+/);
    const command = commands.get((cmdNameRaw || '').toLowerCase());
    if (command) {
      await command.execute({ ...baseCtx, args: rest, text: rest.join(' ') });
    }
    return;
  }

  // --- Chat bebas tanpa prefix ---
  // Di chat pribadi: selalu direspon layaknya ngobrol biasa.
  // Di grup: hanya direspon kalau bot di-mention (biar nggak spam ke semua orang).
  const botNumber = sock.user?.id?.split(':')[0];
  const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const isMentioned = botNumber ? mentionedJids.some((jid) => jid.startsWith(botNumber)) : false;

  
  if (!isGroup || isMentioned) {
    try {
            await sock.sendPresenceUpdate('composing', chatId);

            const reply = await ai.getReply(chatId, text);
      
            const targetId = isGroup ? chatId : (await sock.onWhatsApp(chatId.split('@')[0]))?.[0]?.jid || chatId;
            /* sock.ws.on('CB:ack,class:message', node => {
              console.log("ACK:");
              console.dir(node, { depth: null });
            });

            sock.ws.on('CB:message', node => {
              console.log("MESSAGE:");
              console.dir(node, { depth: 5 });
            }); */

      await sock.sendMessage(targetId, { text: reply });
          } catch (err) {
      console.error('[auto-chat] error:', err);
    }
  } else {
    console.log('[DEBUG] Pesan diabaikan (Grup tapi bot tidak di-mention)');
  }
}

startBot().catch((err) => {
  console.error('Gagal start bot:', err);
  process.exit(1);
});
