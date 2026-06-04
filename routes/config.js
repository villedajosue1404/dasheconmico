const express = require('express');
const router = express.Router();
const { pool } = require('../db/schema');

// GET all config
router.get('/', async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM config');
    const cfg = {};
    r.rows.forEach(row => cfg[row.key] = row.value);
    // Mask tokens in response
    const safe = {};
    Object.entries(cfg).forEach(([k, v]) => {
      safe[k] = (k.includes('token') || k.includes('secret')) ? '••••••' + v.slice(-4) : v;
    });
    res.json({ ok: true, config: safe });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// SET config key
router.post('/', async (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ ok: false, error: 'key y value requeridos' });
  try {
    await pool.query(
      'INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()',
      [key, value]
    );
    res.json({ ok: true, message: 'Config guardada' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET raw value (for internal use)
router.get('/raw/:key', async (req, res) => {
  try {
    const r = await pool.query('SELECT value FROM config WHERE key=$1', [req.params.key]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true, value: r.rows[0].value });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
