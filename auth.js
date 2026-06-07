// ============================================================
// AUTH.JS — Autenticación del userbot (correr una sola vez)
// Uso: node auth.js
// Corre esto en la Console de Railway para autenticar tu cuenta
// ============================================================

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { pool }           = require('./db/schema');
const readline           = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function getConfig(key) {
  const r = await pool.query('SELECT value FROM config WHERE key=$1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}

async function main() {
  const apiId   = parseInt(process.env.TG_API_ID || '');
  const apiHash = process.env.TG_API_HASH || '';

  if (!apiId || !apiHash) {
    console.log('ERROR: Falta TG_API_ID o TG_API_HASH en las variables de entorno');
    process.exit(1);
  }

  const phone = process.env.TG_USER_PHONE || await new Promise(r => rl.question('Numero de telefono (+502...): ', r));

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 3,
    useWSS: false
  });

  await client.start({
    phoneNumber: async () => phone,
    phoneCode:   async () => new Promise(r => rl.question('Codigo de verificacion: ', r)),
    password:    async () => new Promise(r => rl.question('Contrasena 2FA (Enter si no tenes): ', r)),
    onError:     (e) => console.log('Error:', e.message)
  });

  const session = client.session.save();

  await pool.query(
    'INSERT INTO config(key,value) VALUES(\'tg_user_session\',$1) ON CONFLICT(key) DO UPDATE SET value=$1',
    [session]
  );

  console.log('Sesion guardada correctamente en la base de datos.');
  console.log('El userbot ya puede publicar desde tu cuenta personal.');

  rl.close();
  await client.disconnect();
  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
