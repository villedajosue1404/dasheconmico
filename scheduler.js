// ============================================================
// SCHEDULER.JS — Publicador automático programado
// Revisa cada minuto si hay posts que deben publicarse ahora
// ============================================================

const fetch = require('node-fetch');
const { pool } = require('./db/schema');

// Días de la semana en inglés abreviado (igual que guardamos en DB)
const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];

// Obtener config de la DB
async function getConfig(key) {
  const r = await pool.query('SELECT value FROM config WHERE key=$1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}

// Publicar texto+foto en Telegram
async function publishToTelegram(content, photoUrl) {
  const token  = await getConfig('tg_token');
  const chatId = await getConfig('tg_chatid');
  if (!token || !chatId) return { ok: false, error: 'Telegram no configurado' };

  try {
    if (photoUrl) {
      // Si tiene foto, usamos sendPhoto
      const res = await fetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption: content, parse_mode: 'HTML' })
      });
      const data = await res.json();
      return { ok: data.ok, error: data.description };
    } else {
      // Solo texto
      const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: content, parse_mode: 'HTML' })
      });
      const data = await res.json();
      return { ok: data.ok, error: data.description };
    }
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// Publicar en Facebook
async function publishToFacebook(content, photoUrl) {
  const token  = await getConfig('fb_token');
  const pageId = await getConfig('fb_pageid');
  if (!token || !pageId) return { ok: false, error: 'Facebook no configurado' };

  try {
    const endpoint = photoUrl
      ? 'https://graph.facebook.com/' + pageId + '/photos'
      : 'https://graph.facebook.com/' + pageId + '/feed';

    const body = photoUrl
      ? { url: photoUrl, caption: content, access_token: token }
      : { message: content, access_token: token };

    const res  = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return { ok: !!data.id, error: data.error ? data.error.message : null };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

// Función principal que corre cada minuto
async function checkAndPublish() {
  try {
    // Obtenemos todos los posts programados activos
    const r = await pool.query(
      'SELECT * FROM scheduled_posts WHERE active=TRUE ORDER BY id'
    );
    if (!r.rows.length) return;

    // Hora actual en Guatemala (UTC-6)
    const now      = new Date();
    const utcMs    = now.getTime() + (now.getTimezoneOffset() * 60000);
    const gtMs     = utcMs - (6 * 3600000); // UTC-6
    const gtNow    = new Date(gtMs);
    const curDay   = DAY_NAMES[gtNow.getDay()];    // dia actual ej: 'mon'
    const curHour  = gtNow.getHours();
    const curMin   = gtNow.getMinutes();
    const curTime  = String(curHour).padStart(2,'0') + ':' + String(curMin).padStart(2,'0');

    for (let i = 0; i < r.rows.length; i++) {
      const sp = r.rows[i];

      // Verificar si hoy es un día programado
      const days = sp.days.split(',').map(function(d) { return d.trim(); });
      if (!days.includes(curDay)) continue;

      // Verificar si la hora actual coincide con alguna hora programada
      const times = sp.times.split(',').map(function(t) { return t.trim(); });
      if (!times.includes(curTime)) continue;

      // Verificar que no lo hayamos enviado en los últimos 2 minutos (evitar duplicados)
      if (sp.last_sent) {
        const lastMs = new Date(sp.last_sent).getTime();
        const diffMin = (Date.now() - lastMs) / 60000;
        if (diffMin < 2) continue;
      }

      console.log('Publicando post programado #' + sp.id + ' a las ' + curTime);

      // Publicar según las redes configuradas
      const networks = sp.networks.split(',').map(function(n) { return n.trim(); });
      const results  = [];

      for (let j = 0; j < networks.length; j++) {
        const net = networks[j];
        if (net === 'tg') {
          const r2 = await publishToTelegram(sp.content, sp.photo_url);
          results.push('TG: ' + (r2.ok ? 'OK' : 'ERROR ' + r2.error));
        }
        if (net === 'fb') {
          const r2 = await publishToFacebook(sp.content, sp.photo_url);
          results.push('FB: ' + (r2.ok ? 'OK' : 'ERROR ' + r2.error));
        }
      }

      // Actualizar last_sent para no repetir
      await pool.query(
        'UPDATE scheduled_posts SET last_sent=NOW() WHERE id=$1',
        [sp.id]
      );

      // Registrar en tabla posts como publicado
      await pool.query(
        'INSERT INTO posts(business_id,network,content,status,published_at) VALUES($1,$2,$3,$4,NOW())',
        [sp.business_id || null, networks[0], sp.content, 'published']
      );

      console.log('Post #' + sp.id + ' publicado: ' + results.join(' | '));
    }
  } catch(e) {
    console.error('Scheduler error:', e.message);
  }
}

// Iniciar el scheduler — corre cada 60 segundos
function startScheduler() {
  console.log('Scheduler iniciado — revisando cada minuto');
  // Corremos inmediatamente al iniciar
  checkAndPublish();
  // Luego cada 60 segundos
  setInterval(checkAndPublish, 60000);
}

module.exports = { startScheduler, publishToTelegram, publishToFacebook };
