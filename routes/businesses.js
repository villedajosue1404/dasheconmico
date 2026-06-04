const express = require('express');
const router = express.Router();
const { pool } = require('../db/schema');

// GET all businesses with financial summary
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT b.*,
        COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END), 0) AS total_expense,
        COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END), 0) AS balance,
        COUNT(DISTINCT t.id) AS transaction_count,
        COUNT(DISTINCT p.id) AS post_count
      FROM businesses b
      LEFT JOIN transactions t ON t.business_id = b.id
      LEFT JOIN posts p ON p.business_id = b.id
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `);
    res.json({ ok: true, businesses: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET single business with transactions
router.get('/:id', async (req, res) => {
  try {
    const b = await pool.query('SELECT * FROM businesses WHERE id=$1', [req.params.id]);
    if (!b.rows.length) return res.status(404).json({ ok: false, error: 'No encontrado' });
    const t = await pool.query(
      'SELECT * FROM transactions WHERE business_id=$1 ORDER BY date DESC, created_at DESC',
      [req.params.id]
    );
    const p = await pool.query(
      'SELECT * FROM posts WHERE business_id=$1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ ok: true, business: b.rows[0], transactions: t.rows, posts: p.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// CREATE business
router.post('/', async (req, res) => {
  const { name, description, category, color } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'Nombre requerido' });
  try {
    const r = await pool.query(
      'INSERT INTO businesses(name,description,category,color) VALUES($1,$2,$3,$4) RETURNING *',
      [name, description || '', category || 'General', color || '#7c6dfa']
    );
    res.json({ ok: true, business: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// UPDATE business
router.put('/:id', async (req, res) => {
  const { name, description, category, color } = req.body;
  try {
    const r = await pool.query(
      'UPDATE businesses SET name=$1,description=$2,category=$3,color=$4 WHERE id=$5 RETURNING *',
      [name, description, category, color, req.params.id]
    );
    res.json({ ok: true, business: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE business
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM businesses WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
