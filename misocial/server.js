require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./db/schema');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/config', require('./routes/config'));
app.use('/api/businesses', require('./routes/businesses'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/posts', require('./routes/posts'));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Serve frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Start
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 MiSocial corriendo en puerto ${PORT}`));
}).catch(err => {
  console.error('Error iniciando DB:', err);
  process.exit(1);
});
