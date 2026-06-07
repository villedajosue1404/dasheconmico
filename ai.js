// ============================================================
// AI.JS — Integración con Groq (Llama 3) para entender
// mensajes complejos que el parser básico no puede manejar
// ============================================================

const fetch = require('node-fetch');
const { pool } = require('./db/schema');

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// ── Obtener contexto de negocios para dárselo a la IA ──
async function getBusinessContext() {
  const r = await pool.query(`
    SELECT b.name,
      COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0) as income,
      COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0) as expense,
      COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END),0) as balance
    FROM businesses b
    LEFT JOIN transactions t ON t.business_id=b.id
    GROUP BY b.id, b.name
    ORDER BY b.name
  `);
  return r.rows;
}

// ── Obtener transacciones recientes ──
async function getRecentTransactions(limit) {
  const r = await pool.query(`
    SELECT t.type, t.amount, t.description, t.date, b.name as business
    FROM transactions t
    JOIN businesses b ON b.id=t.business_id
    ORDER BY t.created_at DESC
    LIMIT $1
  `, [limit || 20]);
  return r.rows;
}

// ── Llamar a Groq ──
async function askGroq(systemPrompt, userMessage) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 500,
        temperature: 0.3
      })
    });
    const data = await res.json();
    return data.choices && data.choices[0] ? data.choices[0].message.content : null;
  } catch(e) {
    console.error('Groq error:', e.message);
    return null;
  }
}

// ── Analizar mensaje financiero complejo ──
async function analyzeFinancialMessage(message, businesses) {
  const bizNames = businesses.map(function(b) { return b.name; }).join(', ');
  const system = 'Sos un asistente de negocios para Guatemala. ' +
    'El usuario habla en español informal guatemalteco. ' +
    'Los negocios disponibles son: ' + bizNames + '. ' +
    'Respondé SOLO con JSON, sin texto extra, sin markdown. ' +
    'Si el mensaje es un registro financiero, respondé: ' +
    '{"type":"transaction","transType":"income|expense","amount":numero,"description":"texto","business":"nombre exacto del negocio o null"} ' +
    'Si es una consulta, respondé: ' +
    '{"type":"query","intent":"balance|ventas|gastos|comparar|reporte","period":"hoy|semana|mes|año|null","business":"nombre o null"} ' +
    'Si no entendés, respondé: {"type":"unknown"}';

  const result = await askGroq(system, message);
  if (!result) return null;

  try {
    const clean = result.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch(e) {
    return null;
  }
}

// ── Generar reporte analítico ──
async function generateReport(question) {
  const businesses = await getBusinessContext();
  const transactions = await getRecentTransactions(30);

  if (!businesses.length) return 'No tenés negocios registrados todavía.';

  const bizSummary = businesses.map(function(b) {
    return b.name + ': ingresos Q' + parseFloat(b.income).toFixed(2) +
           ', gastos Q' + parseFloat(b.expense).toFixed(2) +
           ', balance Q' + parseFloat(b.balance).toFixed(2);
  }).join('\n');

  const txSummary = transactions.slice(0, 10).map(function(t) {
    return t.date + ' ' + t.business + ' ' + t.type + ' Q' + t.amount + ' ' + t.description;
  }).join('\n');

  const system = 'Sos un asesor de negocios para Guatemala. ' +
    'Respondé en español informal, máximo 200 palabras. ' +
    'Sé directo y práctico. Usá números concretos. ' +
    'Datos de los negocios:\n' + bizSummary + '\n\nÚltimas transacciones:\n' + txSummary;

  const result = await askGroq(system, question);
  return result || 'No pude generar el análisis en este momento.';
}

// ── Generar texto para publicación ──
async function generatePostText(prompt, businessName) {
  const system = 'Sos un experto en marketing para pequeños negocios de Guatemala. ' +
    'Escribí publicaciones para redes sociales en español guatemalteco informal. ' +
    'Usá emojis con moderación. Máximo 150 palabras. ' +
    'El negocio se llama: ' + (businessName || 'el negocio') + '. ' +
    'Respondé SOLO con el texto de la publicación, sin explicaciones.';

  const result = await askGroq(system, prompt);
  return result || null;
}

module.exports = { analyzeFinancialMessage, generateReport, generatePostText, getBusinessContext };
