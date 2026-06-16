require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { initDB }                    = require('./db/schema');
const { setupBot, registerWebhook } = require('./bot_v2');
const { startScheduler }            = require('./scheduler');
const { router: authRouter, authMiddleware } = require('./routes/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use('/api/auth', authRouter);

// Rutas protegidas con auth
app.use('/api/config',       authMiddleware, require('./routes/config'));
app.use('/api/businesses',   authMiddleware, require('./routes/businesses'));
app.use('/api/transactions', authMiddleware, require('./routes/transactions'));
app.use('/api/posts',        authMiddleware, require('./routes/posts'));
app.use('/api/chat',         authMiddleware, require('./routes/chat'));

app.get('/api/health', function(req, res) {
  res.json({ ok: true, time: new Date().toISOString() });
});

setupBot(app);

app.get('*', function(req, res) {
  var html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  // Inyectar Google Client ID desde variable de entorno
  html = html.replace('{{GOOGLE_CLIENT_ID}}', process.env.GOOGLE_CLIENT_ID || '');
  res.send(html);
});

initDB().then(function() {
  app.listen(PORT, async function() {
    console.log('Servidor corriendo en puerto ' + PORT);
    startScheduler();

    // Iniciar userbot si hay credenciales
    if (process.env.TG_API_ID && process.env.TG_API_HASH) {
      try {
        const { startUserbot } = require('./userbot');
        await startUserbot();
      } catch(e) {
        console.log('Userbot no disponible:', e.message);
      }
    }

    var BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
      ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
      : (process.env.BASE_URL || '');
    if (BASE_URL) await registerWebhook(BASE_URL);
  });
}).catch(function(err) {
  console.error('Error iniciando DB:', err);
  process.exit(1);
});
