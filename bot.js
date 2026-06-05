const fetch = require('node-fetch');
const { pool } = require('./db/schema');

async function tgSend(chatId, text) {
  const token = await getConfig('tg_token');
  if (!token) return;
  await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
  });
}

async function getConfig(key) {
  const r = await pool.query('SELECT value FROM config WHERE key=$1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}

function similarity(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;
  let matches = 0;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
}

function findBestBusiness(input, businesses) {
  if (!businesses.length || !input) return null;
  let best = null;
  let bestScore = 0;
  for (let i = 0; i < businesses.length; i++) {
    const score = similarity(input, businesses[i].name);
    if (score > bestScore) { bestScore = score; best = businesses[i]; }
  }
  return bestScore > 0.3 ? { business: best, score: bestScore } : null;
}

function isCmd(t, words) {
  for (let i = 0; i < words.length; i++) {
    if (t === words[i] || t === '/' + words[i] || t.startsWith(words[i] + ' ') || t.startsWith('/' + words[i] + ' ')) return true;
  }
  return false;
}

function extractBizHint(t) {
  const m = t.match(/(?:de|en|para|del|negocio|local)\s+([a-z\u00e0-\u00fc\s]{2,25}?)(?:\s+por|\s+a\s|\s+\d|,|$)/i);
  return m ? m[1].trim() : null;
}

function parseMessage(text) {
  const t = text.toLowerCase().trim();

  if (isCmd(t, ['balance', 'saldo', 'resumen'])) return { type: 'balance' };
  if (isCmd(t, ['ayuda', 'help', 'inicio', 'start'])) return { type: 'help' };
  if (isCmd(t, ['negocios'])) return { type: 'list_businesses' };
  if (isCmd(t, ['inventario'])) return { type: 'inventory' };

  const newBizRe = /^(?:\/?)(?:nuevo negocio|crear negocio|abrir negocio)\s+(.+)/i;
  const newBizMatch = t.match(newBizRe);
  if (newBizMatch) return { type: 'new_business', name: newBizMatch[1].trim() };

  // Formato: "10 tacos a 15" o "vendi 10 tacos a Q15"
  const qtyRe = /(\d+(?:\.\d+)?)\s+([a-z\u00e0-\u00fc\s]{2,25}?)\s+a\s+[qQ]?\s*(\d+(?:\.\d{1,2})?)/i;
  const qtyMatch = t.match(qtyRe);
  if (qtyMatch) {
    const qty = parseFloat(qtyMatch[1]);
    const item = qtyMatch[2].trim().replace(/\b(de|kg|unidades|piezas)\b/gi, '').trim();
    const unitPrice = parseFloat(qtyMatch[3]);
    const total = qty * unitPrice;
    const isExp = /gast|compr|pagu|insum|mater/i.test(t);
    return {
      type: isExp ? 'expense' : 'income',
      amount: total,
      qty: qty,
      unitPrice: unitPrice,
      item: item,
      description: qty + ' ' + item + ' a Q' + unitPrice.toFixed(2) + ' c/u',
      bizHint: extractBizHint(t)
    };
  }

  const isIncome = /vend|ingres|cobr|ganancia|venta|recibi|factur|gan[eo]/i.test(t);
  const isExpense = /gast|pagu|compr|egres|rent|sueldo|invert/i.test(t);
  const hasNumber = /\d/.test(t);

  if (!isIncome && !isExpense && !hasNumber) return { type: 'unknown' };

  const amRe1 = /q\s*(\d+(?:\.\d{1,2})?)/i;
  const amRe2 = /(\d+(?:\.\d{1,2})?)\s*(?:q|quetzales)\b/i;
  const amRe3 = /(\d+(?:\.\d{1,2})?)/i;
  let amountMatch = t.match(amRe1) || t.match(amRe2) || t.match(amRe3);

  if (!amountMatch) return { type: 'no_amount' };
  const amount = parseFloat(amountMatch[1]);
  const finalType = (isExpense && !isIncome) ? 'expense' : 'income';

  let desc = t
    .replace(/q\s*\d+(?:\.\d{1,2})?/gi, '')
    .replace(/\d+(?:\.\d{1,2})?\s*(?:q|quetzales)?/gi, '')
    .replace(/se\s+vendieron|vendi|gaste|pague|ingreso|venta de|gasto de|gasto en/gi, '')
    .replace(/\b(por|de|en|el|la|los|las|un|una)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();

  if (!desc) desc = finalType === 'income' ? 'Ingreso' : 'Gasto';

  return {
    type: finalType,
    amount: amount,
    description: desc,
    bizHint: extractBizHint(t)
  };
}

const sessions = {};

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const userName = (msg.from && msg.from.first_name) ? msg.from.first_name : 'equipo';
  if (!text) return;

  if (sessions[chatId]) {
    await handleSession(chatId, text, userName);
    return;
  }

  const parsed = parseMessage(text);

  if (parsed.type === 'balance') {
    const r = await pool.query(
      'SELECT b.name,' +
      'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE 0 END),0) as income,' +
      'COALESCE(SUM(CASE WHEN t.type=\'expense\' THEN t.amount ELSE 0 END),0) as expense,' +
      'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE -t.amount END),0) as balance ' +
      'FROM businesses b LEFT JOIN transactions t ON t.business_id=b.id ' +
      'GROUP BY b.id,b.name ORDER BY balance DESC'
    );
    if (!r.rows.length) { await tgSend(chatId, 'No hay negocios. Crea uno con /nuevo negocio [nombre]'); return; }
    let reply = '<b>Balance general</b>\n\n';
    let ti = 0, te = 0;
    for (let i = 0; i < r.rows.length; i++) {
      const b = r.rows[i];
      const bal = parseFloat(b.balance);
      reply += '<b>' + b.name + '</b>\n';
      reply += '  Ingresos: Q ' + parseFloat(b.income).toFixed(2) + '\n';
      reply += '  Gastos:   Q ' + parseFloat(b.expense).toFixed(2) + '\n';
      reply += '  Balance:  <b>Q ' + bal.toFixed(2) + '</b>\n\n';
      ti += parseFloat(b.income);
      te += parseFloat(b.expense);
    }
    reply += 'TOTAL\nQ ' + ti.toFixed(2) + ' ingresos | Q ' + te.toFixed(2) + ' gastos\nNeto: <b>Q ' + (ti - te).toFixed(2) + '</b>';
    await tgSend(chatId, reply);
    return;
  }

  if (parsed.type === 'help') {
    await tgSend(chatId,
      '<b>Comandos</b>\n\n' +
      'Ventas:\n' +
      '- "vendi 10 tacos a Q15"\n' +
      '- "venta de 500"\n\n' +
      'Gastos:\n' +
      '- "gasto de 200 en renta"\n' +
      '- "compre 3 kg carne a Q50"\n\n' +
      'Consultas:\n' +
      '- /balance\n' +
      '- /negocios\n' +
      '- /inventario\n\n' +
      'Negocios:\n' +
      '- /nuevo negocio Tacos Don Pedro'
    );
    return;
  }

  if (parsed.type === 'list_businesses') {
    const r = await pool.query('SELECT name FROM businesses ORDER BY name');
    if (!r.rows.length) { await tgSend(chatId, 'Sin negocios. Crea uno con /nuevo negocio [nombre]'); return; }
    let list = '<b>Tus negocios:</b>\n\n';
    for (let i = 0; i < r.rows.length; i++) list += '- ' + r.rows[i].name + '\n';
    await tgSend(chatId, list);
    return;
  }

  if (parsed.type === 'inventory') {
    const today = new Date().toISOString().split('T')[0];
    const r = await pool.query(
      'SELECT b.name as biz,t.description,t.amount,t.type ' +
      'FROM transactions t JOIN businesses b ON b.id=t.business_id ' +
      'WHERE t.date=$1 ORDER BY b.name,t.created_at DESC',
      [today]
    );
    if (!r.rows.length) { await tgSend(chatId, 'Sin movimientos hoy (' + today + ')'); return; }
    let reply = '<b>Hoy ' + today + '</b>\n';
    let lastBiz = '';
    for (let i = 0; i < r.rows.length; i++) {
      const row = r.rows[i];
      if (row.biz !== lastBiz) { reply += '\n<b>' + row.biz + '</b>\n'; lastBiz = row.biz; }
      reply += (row.type === 'income' ? '+' : '-') + ' ' + row.description + ' Q' + parseFloat(row.amount).toFixed(2) + '\n';
    }
    await tgSend(chatId, reply);
    return;
  }

  if (parsed.type === 'new_business') {
    const existing = await pool.query('SELECT id FROM businesses WHERE LOWER(name)=LOWER($1)', [parsed.name]);
    if (existing.rows.length) { await tgSend(chatId, 'Ya existe un negocio llamado ' + parsed.name); return; }
    const colors = ['#6c5ce7', '#00b894', '#e17055', '#0984e3', '#fdcb6e'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    await pool.query('INSERT INTO businesses(name,category,color) VALUES($1,$2,$3)', [parsed.name, 'General', color]);
    await tgSend(chatId, 'Negocio <b>' + parsed.name + '</b> creado.');
    return;
  }

  if (parsed.type === 'no_amount') {
    await tgSend(chatId, 'No encontre el monto.\nEjemplo: "venta de 150" o "10 tacos a Q15"');
    return;
  }

  if (parsed.type === 'unknown') {
    await tgSend(chatId, 'No entendi. Prueba:\n- "vendi 10 tacos a Q15"\n- "gasto de 200"\n- /balance\n- /ayuda');
    return;
  }

  const bizRes = await pool.query('SELECT id, name FROM businesses ORDER BY name');
  const bizList = bizRes.rows;

  if (!bizList.length) {
    await tgSend(chatId, 'No tienes negocios. Crea uno con:\n/nuevo negocio [nombre]');
    return;
  }

  let matchedBiz = null;
  if (parsed.bizHint) {
    const result = findBestBusiness(parsed.bizHint, bizList);
    if (result && result.score > 0.6) matchedBiz = result.business;
  }
  if (!matchedBiz && bizList.length === 1) matchedBiz = bizList[0];

  if (matchedBiz) {
    await saveTransaction(chatId, matchedBiz, parsed, userName);
  } else {
    sessions[chatId] = { step: 'choose_business', parsed: parsed, userName: userName, businesses: bizList };
    let opts = '';
    for (let i = 0; i < bizList.length; i++) opts += (i + 1) + '. ' + bizList[i].name + '\n';
    const label = parsed.type === 'income' ? 'Ingreso' : 'Gasto';
    await tgSend(chatId, label + ': Q ' + parsed.amount.toFixed(2) + '\n' + parsed.description + '\n\nA que negocio?\n\n' + opts + '\nResponde con numero o nombre.');
  }
}

async function handleSession(chatId, text, userName) {
  const session = sessions[chatId];
  if (session.step === 'choose_business') {
    const bizList = session.businesses;
    let chosen = null;
    const num = parseInt(text);
    if (num >= 1 && num <= bizList.length) {
      chosen = bizList[num - 1];
    } else {
      const result = findBestBusiness(text, bizList);
      if (result) chosen = result.business;
    }
    if (!chosen) { await tgSend(chatId, 'No entendi. Responde con numero o nombre.'); return; }
    delete sessions[chatId];
    await saveTransaction(chatId, chosen, session.parsed, session.userName);
  }
}

async function saveTransaction(chatId, business, parsed, userName) {
  const today = new Date().toISOString().split('T')[0];
  await pool.query(
    'INSERT INTO transactions(business_id,type,amount,description,category,date) VALUES($1,$2,$3,$4,$5,$6)',
    [business.id, parsed.type, parsed.amount, parsed.description,
     parsed.type === 'income' ? 'Ventas' : 'Gastos', today]
  );
  const r = await pool.query(
    'SELECT COALESCE(SUM(CASE WHEN type=\'income\' THEN amount ELSE -amount END),0) as balance FROM transactions WHERE business_id=$1',
    [business.id]
  );
  const balance = parseFloat(r.rows[0].balance);
  let reply = (parsed.type === 'income' ? 'INGRESO' : 'GASTO') + ' registrado\n\n';
  reply += 'Negocio: <b>' + business.name + '</b>\n';
  if (parsed.qty) reply += 'Cantidad: ' + parsed.qty + ' x ' + parsed.item + ' a Q' + parsed.unitPrice.toFixed(2) + '\n';
  reply += 'Total: <b>Q ' + parsed.amount.toFixed(2) + '</b>\n';
  reply += 'Detalle: ' + parsed.description + '\n';
  reply += 'Por: ' + userName + '\n\n';
  reply += 'Balance ' + business.name + ': <b>Q ' + balance.toFixed(2) + '</b>';
  await tgSend(chatId, reply);
}

function setupBot(app) {
  app.post('/webhook/telegram', function(req, res) {
    res.sendStatus(200);
    var update = req.body;
    if (update.message) {
      handleMessage(update.message).catch(function(e) { console.error('Bot error:', e.message); });
    }
  });
  console.log('Bot de Telegram listo');
}

async function registerWebhook(baseUrl) {
  const token = await getConfig('tg_token');
  if (!token) { console.log('Bot: sin tg_token'); return; }
  const res = await fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: baseUrl + '/webhook/telegram' })
  });
  const data = await res.json();
  console.log('Webhook:', data.ok ? 'OK' : 'ERROR ' + data.description);
}

module.exports = { setupBot: setupBot, registerWebhook: registerWebhook };