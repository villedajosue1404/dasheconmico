const express = require('express');
const router  = express.Router();
const fetch   = require('node-fetch');
const { pool } = require('../db/schema');
const { searchMemory, extractKeywords } = require('./memory');

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// POST /api/chat — chat con IA que ve los datos financieros
router.post('/', async (req, res) => {
  const { message, history } = req.body;
  if (!message) return res.status(400).json({ ok: false, error: 'message requerido' });

  const key = process.env.GROQ_API_KEY;
  if (!key) return res.json({ ok: true, reply: 'No tengo IA configurada (falta GROQ_API_KEY).' });

  try {
    // Buscar en memoria primero
    var memResults = await searchMemory(req.userId, message, 'user', 3);
    var memContext = '';
    if (memResults.length) {
      memContext = '\n\nConocimiento previo relevante:\n' +
        memResults.map(function(m) {
          return '- [' + m.type + '] ' + m.question + ' → ' + m.answer.slice(0, 200);
        }).join('\n') +
        '\n\nUsa este conocimiento si es pertinente.';
      // Incrementar hit count
      await pool.query("UPDATE memory SET hit_count=hit_count+1 WHERE id=ANY($1)",
        [memResults.map(function(m) { return m.id; })]);
    }

    // Contexto financiero del usuario autenticado
    const biz = await pool.query(
      'SELECT b.name,' +
      'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE 0 END),0) as income,' +
      'COALESCE(SUM(CASE WHEN t.type=\'expense\' THEN t.amount ELSE 0 END),0) as expense,' +
      'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE -t.amount END),0) as balance ' +
      'FROM businesses b LEFT JOIN transactions t ON t.business_id=b.id AND t.user_id=$1 ' +
      'WHERE b.user_id=$1 ' +
      'GROUP BY b.id,b.name ORDER BY b.name',
      [req.userId]
    );
    const tx = await pool.query(
      'SELECT t.date::text,t.type,t.amount,t.description,b.name as business ' +
      'FROM transactions t JOIN businesses b ON b.id=t.business_id ' +
      'WHERE t.user_id=$1 ' +
      'ORDER BY t.created_at DESC LIMIT 8',
      [req.userId]
    );

    const bizSummary = biz.rows.map(function(b) {
      return b.name + ': ingresos Q' + parseFloat(b.income).toFixed(2) +
             ', gastos Q' + parseFloat(b.expense).toFixed(2) +
             ', balance Q' + parseFloat(b.balance).toFixed(2);
    }).join('\n') || 'Sin negocios registrados';

    const txSummary = tx.rows.map(function(t) {
      return t.date + ' ' + t.business + ' ' + t.type + ' Q' + parseFloat(t.amount).toFixed(2) + ' "' + (t.description||'') + '"';
    }).join('\n') || 'Sin transacciones';

    const system =
      'Eres un asistente de inteligencia artificial integrado al panel de control de un sistema de ' +
      'gestion de negocios para Guatemala llamado "Centro de Mando". Hablas en espanol, ' +
      'de forma clara, directa y profesional pero cercana. ' +
      'Puedes ver los datos financieros en tiempo real:\n\n' +
      'NEGOCIOS:\n' + bizSummary + '\n\n' +
      'ULTIMAS TRANSACCIONES:\n' + txSummary + '\n\n' +
      'Responde preguntas sobre estos datos, da analisis, proyecciones y consejos. ' +
      'Se conciso (maximo 100 palabras) ya que tus respuestas pueden leerse en voz alta.' +
      memContext;

    const msgs = [{ role: 'system', content: system }]
      .concat((history || []).slice(-6))
      .concat([{ role: 'user', content: message }]);

    const groqRes = await fetch(GROQ_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: msgs, max_tokens: 350, temperature: 0.4 })
    });
    const data  = await groqRes.json();
    const reply = data.choices && data.choices[0] ? data.choices[0].message.content : 'No pude responder.';

    // Guardar en memoria (ignorar errores)
    try {
      var keywords = extractKeywords(message);
      await pool.query(
        "INSERT INTO memory(user_id,scope,type,keywords,question,answer) VALUES($1,'user','qa',$2,$3,$4) ON CONFLICT DO NOTHING",
        [req.userId, keywords, message.slice(0, 300), reply.slice(0, 500)]
      );
    } catch (_) {}

    res.json({ ok: true, reply: reply });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
