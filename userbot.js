// ============================================================
// USERBOT.JS — Publica mensajes desde tu cuenta personal
// Usa GramJS (implementacion de MTProto en Node.js)
// ============================================================

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { NewMessage }     = require('telegram/events');
const { pool }           = require('./db/schema');
const { publishToFacebook } = require('./scheduler');

// Variable global del cliente
let client = null;

// ── Obtener config de DB ──
async function getConfig(key) {
  const r = await pool.query('SELECT value FROM config WHERE key=$1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}

// ── Guardar config en DB ──
async function setConfig(key, value) {
  await pool.query(
    'INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
    [key, value]
  );
}

// ── Iniciar el cliente de Telegram con tu cuenta ──
async function startUserbot() {
  const apiId   = parseInt(process.env.TG_API_ID || '');
  const apiHash = process.env.TG_API_HASH || '';

  if (!apiId || !apiHash) {
    console.log('Userbot: sin TG_API_ID o TG_API_HASH — desactivado');
    return null;
  }

  // Intentar cargar sesión guardada de la DB
  const savedSession = await getConfig('tg_user_session');
  const session = new StringSession(savedSession || '');

  client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
    useWSS: true
  });

  try {
    await client.start({
      phoneNumber: async () => await getConfig('tg_user_phone'),
      password:    async () => await getConfig('tg_user_password') || '',
      phoneCode:   async () => {
        // El código lo leemos desde la DB — el bot lo pide al usuario
        console.log('Esperando codigo de verificacion...');
        let code = null;
        for (let i = 0; i < 60; i++) {
          await sleep(5000);
          code = await getConfig('tg_auth_code');
          if (code && code !== 'pending') break;
        }
        return code || '';
      },
      onError: function(err) { console.log('Userbot auth error:', err.message); }
    });

    // Guardar la sesión en la DB para no volver a autenticar
    const sessionStr = client.session.save();
    await setConfig('tg_user_session', sessionStr);
    console.log('Userbot conectado como tu cuenta personal');
    return client;
  } catch(e) {
    console.error('Userbot error al conectar:', e.message);
    return null;
  }
}

// ── Publicar mensaje desde tu cuenta en un grupo/canal ──
async function publishAsUser(groupId, content, photoUrl) {
  if (!client || !client.connected) {
    return { ok: false, error: 'Userbot no conectado' };
  }
  try {
    if (photoUrl) {
      // Descargar la foto y enviarla
      const fetch   = require('node-fetch');
      const res     = await fetch(photoUrl);
      const buffer  = await res.buffer();
      await client.sendFile(groupId, {
        file:    buffer,
        caption: content
      });
    } else {
      await client.sendMessage(groupId, { message: content });
    }
    return { ok: true };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// ── Verificar si el userbot está conectado ──
function isConnected() {
  return client && client.connected;
}

// ── Utilidad: esperar N milisegundos ──
function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

module.exports = { startUserbot, publishAsUser, isConnected };
