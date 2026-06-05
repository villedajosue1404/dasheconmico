const fetch  = require('node-fetch');
const { pool } = require('./db/schema');

const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];

async function getConfig(key) {
  const r = await pool.query('SELECT value FROM config WHERE key=$1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}

// Publicar en Telegram (como bot al canal, o como usuario a un grupo)
async function publishToTelegram(content, photoUrl) {
  // Intentar primero con userbot si está conectado
  try {
    const userbot = require('./userbot');
    if (userbot.isConnected()) {
      const groupId = await getConfig('tg_user_group_id');
      if (groupId) {
        const r = await userbot.publishAsUser(groupId, content, photoUrl);
        if (r.ok) return r;
      }
    }
  } catch(e) { /* userbot no disponible, usar bot normal */ }

  // Fallback: bot normal al canal configurado
  const token  = await getConfig('tg_token');
  const chatId = await getConfig('tg_chatid');
  if (!token || !chatId) return { ok: false, error: 'Telegram no configurado' };

  try {
    if (photoUrl) {
      const res = await fetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption: content, parse_mode: 'HTML' })
      });
      const data = await res.json();
      return { ok: data.ok, error: data.description };
    } else {
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

// Revisar y publicar posts programados
async function checkAndPublish() {
  try {
    const r = await pool.query('SELECT * FROM scheduled_posts WHERE active=TRUE ORDER BY id');
    if (!r.rows.length) return;

    const now     = new Date();
    const utcMs   = now.getTime() + (now.getTimezoneOffset() * 60000);
    const gtMs    = utcMs - (6 * 3600000);
    const gtNow   = new Date(gtMs);
    const curDay  = DAY_NAMES[gtNow.getDay()];
    const curTime = String(gtNow.getHours()).padStart(2,'0') + ':' + String(gtNow.getMinutes()).padStart(2,'0');

    for (let i = 0; i < r.rows.length; i++) {
      const sp    = r.rows[i];
      const days  = sp.days.split(',').map(function(d) { return d.trim(); });
      const times = sp.times.split(',').map(function(t) { return t.trim(); });

      if (!days.includes(curDay)) continue;
      if (!times.includes(curTime)) continue;

      if (sp.last_sent) {
        const diffMin = (Date.now() - new Date(sp.last_sent).getTime()) / 60000;
        if (diffMin < 2) continue;
      }

      console.log('Publicando post #' + sp.id + ' a las ' + curTime);
      const networks = sp.networks.split(',').map(function(n) { return n.trim(); });

      for (let j = 0; j < networks.length; j++) {
        if (networks[j] === 'tg') await publishToTelegram(sp.content, sp.photo_url);
        if (networks[j] === 'fb') await publishToFacebook(sp.content, sp.photo_url);
      }

      await pool.query('UPDATE scheduled_posts SET last_sent=NOW() WHERE id=$1', [sp.id]);
      await pool.query(
        'INSERT INTO posts(business_id,network,content,status,published_at) VALUES($1,$2,$3,$4,NOW())',
        [sp.business_id || null, networks[0], sp.content, 'published']
      );
    }
  } catch(e) {
    console.error('Scheduler error:', e.message);
  }
}

function startScheduler() {
  console.log('Scheduler iniciado');
  checkAndPublish();
  setInterval(checkAndPublish, 60000);
}

module.exports = { startScheduler, publishToTelegram, publishToFacebook };
