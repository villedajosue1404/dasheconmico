const fetch = require('node-fetch');
const { pool } = require('./db/schema');

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// ── Historial de conversaciones por usuario ──
const conversationHistory = {};
const MAX_HISTORY = 6;

function addToHistory(chatId, role, content) {
  if (!conversationHistory[chatId]) conversationHistory[chatId] = [];
  conversationHistory[chatId].push({ role: role, content: content });
  if (conversationHistory[chatId].length > MAX_HISTORY) {
    conversationHistory[chatId] = conversationHistory[chatId].slice(-MAX_HISTORY);
  }
}

function getHistory(chatId) {
  return conversationHistory[chatId] || [];
}

function clearHistory(chatId) {
  conversationHistory[chatId] = [];
}

// ── Obtener contexto de negocios ──
async function getBusinessContext() {
  const r = await pool.query(
    'SELECT b.name,' +
    'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE 0 END),0) as income,' +
    'COALESCE(SUM(CASE WHEN t.type=\'expense\' THEN t.amount ELSE 0 END),0) as expense,' +
    'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE -t.amount END),0) as balance ' +
    'FROM businesses b LEFT JOIN transactions t ON t.business_id=b.id ' +
    'GROUP BY b.id,b.name ORDER BY b.name'
  );
  return r.rows;
}

// ── Obtener transacciones recientes ──
async function getRecentTransactions(limit) {
  const r = await pool.query(
    'SELECT t.type,t.amount,t.description,t.date,b.name as business ' +
    'FROM transactions t JOIN businesses b ON b.id=t.business_id ' +
    'ORDER BY t.created_at DESC LIMIT $1',
    [limit || 5]
  );
  return r.rows;
}

// ── Llamar a Groq con historial ──
async function askGroq(systemPrompt, userMessage, chatId) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const history = chatId ? getHistory(chatId) : [];
    const messages = [{ role: 'system', content: systemPrompt }]
      .concat(history)
      .concat([{ role: 'user', content: userMessage }]);
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        max_tokens: 400,
        temperature: 0.5
      })
    });
    const data = await res.json();
    const reply = data.choices && data.choices[0] ? data.choices[0].message.content : null;
    if (reply && chatId) {
      addToHistory(chatId, 'user', userMessage);
      addToHistory(chatId, 'assistant', reply);
    }
    return reply;
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
  const result = await askGroq(system, message, null);
  if (!result) return null;
  try {
    const clean = result.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch(e) {
    return null;
  }
}

// ── Generar reporte analítico ──
async function generateReport(question, chatId) {
  const businesses = await getBusinessContext();
  const transactions = await getRecentTransactions(5);
  if (!businesses.length) return 'No tenés negocios registrados todavía.';
  const bizSummary = businesses.map(function(b) {
    return b.name + ': ingresos Q' + parseFloat(b.income).toFixed(2) +
           ', gastos Q' + parseFloat(b.expense).toFixed(2) +
           ', balance Q' + parseFloat(b.balance).toFixed(2);
  }).join('\n');
  const txSummary = transactions.map(function(t) {
    return t.date + ' ' + t.business + ' ' + t.type + ' Q' + parseFloat(t.amount).toFixed(2);
  }).join('\n');
  const system = 'Sos un asesor de negocios para Guatemala llamado "Asistente Centro de Mando". ' +
    'Hablás en español informal guatemalteco. Sos directo, práctico y amigable. ' +
    'Cuando el usuario diga "si", "ok", "y?", "continua" o algo corto, seguí la conversación naturalmente. ' +
    'Máximo 200 palabras por respuesta. Usá números concretos. ' +
    'Datos actuales de los negocios:\n' + bizSummary + '\n\nÚltimas transacciones:\n' + txSummary;
  const result = await askGroq(system, question, chatId);
  return result || 'No pude responder en este momento. Intenta de nuevo.';
}

// ── Generar texto para publicación ──
async function generatePostText(prompt, businessName) {
  const system = 'Sos un experto en marketing para pequeños negocios de Guatemala. ' +
    'Escribí publicaciones para redes sociales en español guatemalteco informal. ' +
    'Usá emojis con moderación. Máximo 150 palabras. ' +
    'El negocio se llama: ' + (businessName || 'el negocio') + '. ' +
    'Respondé SOLO con el texto de la publicacion, sin explicaciones.';
  const result = await askGroq(system, prompt, null);
  return result || null;
}

module.exports = {
  analyzeFinancialMessage,
  generateReport,
  generatePostText,
  getBusinessContext,
  addToHistory,
  getHistory,
  clearHistory
};
