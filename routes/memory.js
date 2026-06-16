const express = require('express');
const router  = express.Router();
const { pool } = require('../db/schema');

// Extraer keywords simples del texto
function extractKeywords(text) {
  return (text.toLowerCase()
    .replace(/[^a-záéíóúñü0-9\s]/g, '')
    .split(/\s+/)
    .filter(function(w) { return w.length > 3; })
    .slice(0, 15)
  );
}

// Buscar memorias similares por keywords
async function searchMemory(userId, question, scope, limit) {
  limit = limit || 5;
  var keywords = extractKeywords(question);
  if (!keywords.length) return [];

  // Construir query dinámica con matching por keywords
  var params = [keywords, limit];
  var scopeFilter = scope === 'global'
    ? "scope='global'"
    : "(scope='user' AND user_id=$3 OR scope='global')";
  var userParam = scope === 'global' ? '' : ', userId';

  var sql = scope === 'global'
    ? "SELECT id,scope,type,question,answer,hit_count FROM memory WHERE scope='global' AND keywords && $1 ORDER BY hit_count DESC LIMIT $2"
    : "SELECT id,scope,type,question,answer,hit_count FROM memory WHERE (scope='user' AND user_id=$3 OR scope='global') AND keywords && $1 ORDER BY hit_count DESC LIMIT $2";

  var queryParams = scope === 'global' ? params : params.concat([userId]);
  var r = await pool.query(sql, queryParams);
  return r.rows;
}

// ── Buscar en memoria (público para chat) ──
router.post('/search', async (req, res) => {
  var rows = await searchMemory(req.userId, req.body.question || '', req.body.scope || 'user');
  res.json({ ok: true, results: rows });
});

// ── Guardar en memoria ──
router.post('/save', async (req, res) => {
  var { question, answer, type, scope } = req.body;
  if (!question || !answer) return res.status(400).json({ ok: false, error: 'question y answer requeridos' });

  var keywords = extractKeywords(question);
  var r = await pool.query(
    "INSERT INTO memory(user_id,scope,type,keywords,question,answer) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    [req.userId, scope || 'user', type || 'qa', keywords, question, answer]
  );
  res.json({ ok: true, id: r.rows[0].id });
});

// ── Dar feedback (corregir una respuesta) ──
router.post('/feedback', async (req, res) => {
  var { memoryId, correction } = req.body;
  if (!memoryId || !correction) return res.status(400).json({ ok: false, error: 'memoryId y correction requeridos' });

  // Si es una corrección, subir el feedback + crear registro de corrección
  await pool.query("UPDATE memory SET feedback=$1, updated_at=NOW() WHERE id=$2 AND user_id=$3",
    [correction, memoryId, req.userId]);

  // También guardar la corrección como nueva memoria
  var orig = await pool.query("SELECT question,answer,scope FROM memory WHERE id=$1", [memoryId]);
  if (orig.rows.length) {
    var o = orig.rows[0];
    var keywords = extractKeywords(o.question);
    await pool.query(
      "INSERT INTO memory(user_id,scope,type,keywords,question,answer,feedback) VALUES($1,$2,'correction',$3,$4,$5,$6)",
      [req.userId, o.scope, keywords, o.question, correction, 'Corrección de: ' + o.answer]
    );
  }

  res.json({ ok: true });
});

// ── Auto-mejora: la IA analiza su código y sugiere mejoras ──
router.post('/improve', async (req, res) => {
  var key = process.env.GROQ_API_KEY;
  if (!key) return res.json({ ok: false, error: 'No hay GROQ_API_KEY' });

  // Leer los archivos principales del proyecto para analizar
  var fs = require('fs');
  var path = require('path');
  var base = path.join(__dirname, '..');

  var files = {
    'server.js': fs.readFileSync(base + '/server.js', 'utf8'),
    'routes/chat.js': fs.readFileSync(base + '/routes/chat.js', 'utf8'),
    'routes/memory.js': fs.readFileSync(base + '/routes/memory.js', 'utf8'),
    'db/schema.js': fs.readFileSync(base + '/db/schema.js', 'utf8'),
    'bot_v2.js': fs.readFileSync(base + '/bot_v2.js', 'utf8'),
    'ai.js': fs.readFileSync(base + '/ai.js', 'utf8'),
    'reports.js': fs.readFileSync(base + '/reports.js', 'utf8'),
    'scheduler.js': fs.readFileSync(base + '/scheduler.js', 'utf8'),
  };

  // Buscar errores recientes en memoria
  var corrections = await pool.query(
    "SELECT question,answer,feedback FROM memory WHERE type='correction' AND (user_id=$1 OR scope='global') ORDER BY created_at DESC LIMIT 5",
    [req.userId]
  );

  var codeSummary = Object.entries(files).map(function(e) {
    return '-- ' + e[0] + ' (' + e[1].split('\n').length + ' líneas) --\n' + e[1].slice(0, 2000);
  }).join('\n\n');

  var prompt = {
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content:
        'Eres un arquitecto de software experto. Analizas el código de un sistema de gestión de negocios "Centro de Mando" y propones mejoras concretas.\n\n' +
        'Los archivos del proyecto:\n' + codeSummary + '\n\n' +
        (corrections.rows.length
          ? 'Correcciones/errores recientes de usuarios:\n' +
            corrections.rows.map(function(r) { return '- Pregunta: ' + r.question + '\n  Respuesta: ' + r.answer + '\n  Feedback: ' + r.feedback; }).join('\n')
          : 'Sin correcciones recientes.') + '\n\n' +
        'Genera 3 sugerencias de mejora concretas en este formato:\n' +
        'TITULO: título corto\n' +
        'PROBLEMA: qué problema resuelve\n' +
        'SOLUCION: cómo implementarlo (archivos a modificar, código)\n' +
        'IMPACTO: bajo/medio/alto'
      }
    ],
    max_tokens: 1000,
    temperature: 0.3
  };

  var fetch = require('node-fetch');
  var groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify(prompt)
  });
  var data = await groqRes.json();
  var suggestions = data.choices && data.choices[0] ? data.choices[0].message.content : 'No pude analizar.';

  // Guardar sugerencias en memoria global
  var kw = extractKeywords(suggestions);
  await pool.query(
    "INSERT INTO memory(user_id,scope,type,keywords,question,answer) VALUES($1,'global','improvement',$2,'Análisis de mejora automática',$3)",
    [req.userId, kw, suggestions]
  );

  res.json({ ok: true, suggestions: suggestions });
});

module.exports = router;

// Exportar utilidad para que chat.js la use
module.exports.searchMemory = searchMemory;
module.exports.extractKeywords = extractKeywords;
