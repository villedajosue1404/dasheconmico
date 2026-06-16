const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const fetch     = require('node-fetch');
const { pool }  = require('../db/schema');
const router    = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'c3ntr0-d3-m4nd0-s3cr3t-k3y-2026';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token requerido' });
  }
  try {
    const decoded = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId    = decoded.userId;
    req.userEmail = decoded.email;
    req.userName  = decoded.name;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
  }
}

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ ok: false, error: 'Nombre, email y contraseña requeridos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, error: 'Contraseña debe tener al menos 6 caracteres' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) {
      return res.status(400).json({ ok: false, error: 'Este email ya está registrado' });
    }
    const hash = await bcrypt.hash(password, 10);
    const r    = await pool.query(
      'INSERT INTO users(name,email,password) VALUES($1,$2,$3) RETURNING id,name,email',
      [name, email, hash]
    );
    const user   = r.rows[0];
    const token  = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });
  }
  try {
    const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!r.rows.length) {
      return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos' });
    }
    const user = r.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos' });
    }
    const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  res.json({ ok: true, user: { id: req.userId, name: req.userName, email: req.userEmail } });
});

// Google Sign-In (verifica el token con Google y crea/retorna usuario)
router.post('/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ ok: false, error: 'Token de Google requerido' });

  try {
    // Verificar el token contra Google
    const verify = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + credential);
    const data   = await verify.json();

    if (!data.email) {
      return res.status(401).json({ ok: false, error: 'Token de Google inválido' });
    }

    const email = data.email;
    const name  = data.name || email.split('@')[0];
    const pic   = data.picture || null;

    // Buscar o crear usuario
    const existing = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    let user;
    if (existing.rows.length) {
      user = existing.rows[0];
    } else {
      // Crear usuario sin contraseña (login solo con Google)
      const r = await pool.query(
        'INSERT INTO users(name,email,password) VALUES($1,$2,$3) RETURNING *',
        [name, email, '(google-oauth)']
      );
      user = r.rows[0];
    }

    const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, picture: pic } });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Error verificando token de Google: ' + e.message });
  }
});

module.exports = { router, authMiddleware };
