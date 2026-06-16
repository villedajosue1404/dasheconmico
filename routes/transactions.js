const express = require('express');
const router = express.Router();
const { pool } = require('../db/schema');

// GET transactions (optionally filtered by business)
router.get('/', async (req, res) => {
  try {
    const { business_id, type, limit = 50 } = req.query;
    let q = 'SELECT t.*, b.name as business_name, b.color as business_color FROM transactions t LEFT JOIN businesses b ON b.id=t.business_id WHERE t.user_id=$1';
    const params = [req.userId];
    let idx = 1;
    if (business_id) { params.push(business_id); q += ` AND t.business_id=$${++idx}`; }
    if (type) { params.push(type); q += ` AND t.type=$${++idx}`; }
    q += ` ORDER BY t.date DESC, t.created_at DESC LIMIT $${++idx}`;
    params.push(limit);
    const r = await pool.query(q, params);
    res.json({ ok: true, transactions: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// CREATE transaction
router.post('/', async (req, res) => {
  const { business_id, type, amount, description, category, date } = req.body;
  if (!business_id || !type || !amount) return res.status(400).json({ ok: false, error: 'business_id, type y amount requeridos' });
  try {
    const r = await pool.query(
      'INSERT INTO transactions(user_id,business_id,type,amount,description,category,date) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.userId, business_id, type, parseFloat(amount), description || '', category || 'General', date || new Date().toISOString().split('T')[0]]
    );
    res.json({ ok: true, transaction: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE transaction
router.delete('/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2 RETURNING id', [req.params.id, req.userId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'No encontrado' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET monthly summary per business
router.get('/summary/monthly', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        b.id, b.name, b.color,
        DATE_TRUNC('month', t.date) AS month,
        SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) AS income,
        SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END) AS expense,
        SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END) AS profit
      FROM transactions t
      JOIN businesses b ON b.id=t.business_id
      WHERE t.user_id = $1
      GROUP BY b.id, b.name, b.color, DATE_TRUNC('month', t.date)
      ORDER BY month DESC, b.name
    `, [req.userId]);
    res.json({ ok: true, summary: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
