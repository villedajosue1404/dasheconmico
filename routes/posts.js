const express = require('express');
const router = express.Router();
const { pool } = require('../db/schema');
const fetch = require('node-fetch');

// GET all posts with business info
router.get('/', async (req, res) => {
  try {
    const { business_id, status } = req.query;
    let q = `SELECT p.*, b.name as business_name, b.color as business_color
             FROM posts p LEFT JOIN businesses b ON b.id=p.business_id WHERE 1=1`;
    const params = [];
    if (business_id) { params.push(business_id); q += ` AND p.business_id=$${params.length}`; }
    if (status) { params.push(status); q += ` AND p.status=$${params.length}`; }
    q += ' ORDER BY p.created_at DESC LIMIT 100';
    const r = await pool.query(q, params);
    res.json({ ok: true, posts: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// CREATE post
router.post('/', async (req, res) => {
  const { business_id, network, content, status, scheduled_at } = req.body;
  if (!network || !content) return res.status(400).json({ ok: false, error: 'network y content requeridos' });
  try {
    const r = await pool.query(
      'INSERT INTO posts(business_id,network,content,status,scheduled_at) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [business_id || null, network, content, status || 'draft', scheduled_at || null]
    );
    res.json({ ok: true, post: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUBLISH NOW to Telegram
router.post('/:id/publish', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM posts WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Post no encontrado' });
    const post = r.rows[0];

    const cfgR = await pool.query("SELECT key, value FROM config WHERE key IN ('tg_token','tg_chatid','fb_token','fb_pageid')");
    const cfg = {};
    cfgR.rows.forEach(row => cfg[row.key] = row.value);

    let result = { ok: false, message: 'Red no soportada o sin configurar' };

    if (post.network === 'tg' && cfg.tg_token && cfg.tg_chatid) {
      const tgRes = await fetch(`https://api.telegram.org/bot${cfg.tg_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.tg_chatid, text: post.content, parse_mode: 'HTML' })
      });
      const tgData = await tgRes.json();
      if (tgData.ok) {
        await pool.query("UPDATE posts SET status='published', published_at=NOW() WHERE id=$1", [post.id]);
        result = { ok: true, message: 'Publicado en Telegram ✅' };
      } else {
        result = { ok: false, message: 'Error Telegram: ' + (tgData.description || 'desconocido') };
      }
    } else if (post.network === 'fb' && cfg.fb_token && cfg.fb_pageid) {
      const fbRes = await fetch(`https://graph.facebook.com/${cfg.fb_pageid}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: post.content, access_token: cfg.fb_token })
      });
      const fbData = await fbRes.json();
      if (fbData.id) {
        await pool.query("UPDATE posts SET status='published', published_at=NOW() WHERE id=$1", [post.id]);
        result = { ok: true, message: 'Publicado en Facebook ✅' };
      } else {
        result = { ok: false, message: 'Error Facebook: ' + (fbData.error?.message || 'desconocido') };
      }
    } else {
      result = { ok: false, message: 'API no configurada para ' + post.network };
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// UPDATE post stats (reach, clicks)
router.patch('/:id/stats', async (req, res) => {
  const { reach, clicks } = req.body;
  try {
    const r = await pool.query(
      'UPDATE posts SET reach=$1, clicks=$2 WHERE id=$3 RETURNING *',
      [reach || 0, clicks || 0, req.params.id]
    );
    res.json({ ok: true, post: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE post
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM posts WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET post comparison stats
router.get('/stats/comparison', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT p.id, p.content, p.network, p.reach, p.clicks, p.published_at,
             b.name as business_name, b.color as business_color
      FROM posts p
      LEFT JOIN businesses b ON b.id=p.business_id
      WHERE p.status='published'
      ORDER BY p.reach DESC
      LIMIT 20
    `);
    res.json({ ok: true, posts: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
