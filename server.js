require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initDB }                    = require('./db/schema');
const { setupBot, registerWebhook } = require('./bot_v2');
const { startScheduler }            = require('./scheduler');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/config',       require('./routes/config'));
app.use('/api/businesses',   require('./routes/businesses'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/posts',        require('./routes/posts'));
app.use('/api/chat',         require('./routes/chat'));

app.get('/api/health', function(req, res) {
  res.json({ ok: true, time: new Date().toISOString() });
});

setupBot(app);

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
