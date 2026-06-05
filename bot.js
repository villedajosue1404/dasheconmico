const fetch = require('node-fetch');
const { pool } = require('./db/schema');

// ============ TELEGRAM API ============
async function tgSend(chatId, text, extra = {}) {
  const token = await getConfig('tg_token');
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...extra })
  });
}

async function getConfig(key) {
  const r = await pool.query('SELECT value FROM config WHERE key=$1', [key]);
  return r.rows[0]?.value || null;
}

// ============ FUZZY MATCH ============
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
  let best = null, bestScore = 0;
  for (const b of businesses) {
    const score = similarity(input, b.name);
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return bestScore > 0.3 ? { business: best, score: bestScore } : null;
}

// ============ PARSER PRINCIPAL ============
function parseMessage(text) {
  const t = text.toLowerCase().trim();

  // Comandos especiales
  if (/^\\/?(balance|saldo|resumen|cuanto|cuánto)/.test(t)) return { type: 'balance' };
  if (/^\\/?ayuda|^\\/help/.test(t)) return { type: 'help' };
  if (/^\\/?negocios/.test(t)) return { type: 'list_businesses' };
  if (/^\\/?inventario/.test(t)) return { type: 'inventory' };

  const newBizMatch = t.match(/^\\/?(nuevo negocio|crear negocio|abrir negocio)\s+(.+)/i);
  if (newBizMatch) return { type: 'new_business', name: newBizMatch[2].trim() };

  // ============ FORMATO CON CANTIDAD Y PRECIO UNITARIO ============
  // Ejemplos: "10 tacos a Q15", "vendí 5 pupusas a 20", "3 kg de carne a Q50"
  const qtyPriceMatch = t.match(/(\d+(?:[.,]\d+)?)\s+([a-záéíóúñ\s]{2,30?})\s+a\s+[qQ]?\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (qtyPriceMatch) {
    const qty = parseFloat(qtyPriceMatch[1]);
    const item = qtyPriceMatch[2].trim().replace(/\b(de|kg|unidades|unidad|piezas)\b/gi, '').trim();
    const unitPrice = parseFloat(qtyPriceMatch[3].replace(',', '.'));
    const total = qty * unitPrice;
    const isExpense = /gast|compr|pagu|insum|ingredient|mater/i.test(t);
    return {
      type: isExpense ? 'expense' : 'income',
      amount: total,
      qty,
      unitPrice,
      item,
      description: `${qty} ${item} a Q${unitPrice.toFixed(2)} c/u`,
      bizHint: extractBizHint(t)
    };
  }

  // ============ FORMATO NORMAL ============
  const isIncome = /vend|ingres|cobr|entr[oó]|ganancia|venta|recibi|factur|vendi|ganamos|gan[eé]|cobr/i.test(t);
  const isExpense = /gast|pagu[eé]|compr|egres|salid|perd|invert|rent|sueldo|pagamos|compramos|gast[eé]/i.test(t);
  const hasNumber = /\d/.test(t);

  if (!isIncome && !isExpense && !hasNumber) return { type: 'unknown' };

  // Extraer monto
  const amountMatch =
    t.match(/q\s*(\d+(?:[.,]\d{1,2})?)/i) ||
    t.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:q|quetzales|gtq)\b/i) ||
    t.match(/(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?)/i) ||
    t.match(/(\d+(?:[.,]\d{1,2})?)/i);

  if (!amountMatch) return { type: 'no_amount' };
  const amount = parseFloat(amountMatch[1].replace(/,(\d{3})/g, '$1').replace(',', '.'));
  const finalType = isExpense && !isIncome ? 'expense' : 'income';

  let description = t
    .replace(/q\s*\d+(?:[.,]\d{1,2})?/gi, '')
    .replace(/\d+(?:[.,]\d{1,2})?\s*(?:q|quetzales|gtq)?/gi, '')
    .replace(/se\s+vendieron?|se\s+gast[oó]|gast[eé]|pagu[eé]|cobr[eé]|ingres[oó]|venta\s+de|compra\s+de|pago\s+de|gasto\s+en|gasto\s+de|vendimos|vendí|gané|ganamos|compramos|pagamos/gi, '')
    .replace(/\b(por|de|en|el|la|los|las|un|una)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();

  if (!description) description = finalType === 'income' ? 'Ingreso' : 'Gasto';

  return {
    type: finalType,
    amount,
    description,
    bizHint: extractBizHint(t)
  };
}

function extractBizHint(t) {
  const m = t.match(/(?:de|en|para|del|negocio|local)\s+([a-záéíóúñ\s]{2,30}?)(?:\s+por|\s+a\s|\s+\d|,|$)/i);
  return m ? m[1].trim() : null;
}

// ============ SESIONES ============
const sessions = {};

// ============ HANDLER PRINCIPAL ============
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const userName = msg.from?.first_name || 'equipo';
  if (!text) return;

  if (sessions[chatId]) { await handleSession(chatId, text, userName); return; }

  const parsed = parseMessage(text);

  // BALANCE
  if (parsed.type === 'balance') {
    const r = await pool.query(`
      SELECT b.name,
        COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0) as income,
        COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0) as expense,
        COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END),0) as balance
      FROM businesses b
      LEFT JOIN transactions t ON t.business_id=b.id
      GROUP BY b.id, b.name ORDER BY balance DESC
    `);
    if (!r.rows.length) { await tgSend(chatId, '📊 No hay negocios. Creá uno con /nuevo negocio [nombre]'); return; }
    let reply = '📊 <b>Balance general</b>\n\n';
    let ti = 0, te = 0;
    for (const b of r.rows) {
      const bal = parseFloat(b.balance);
      reply += `${bal >= 0 ? '📈' : '📉'} <b>${b.name}</b>\n`;
      reply += `   ✅ Q ${parseFloat(b.income).toFixed(2)}  ❌ Q ${parseFloat(b.expense).toFixed(2)}\n`;
      reply += `   💰 Balance: <b>Q ${bal.toFixed(2)}</b>\n\n`;
      ti += parseFloat(b.income); te += parseFloat(b.expense);
    }
    reply += `─────────────────\n💼 Total: ✅ Q ${ti.toFixed(2)}  ❌ Q ${te.toFixed(2)}\n💰 Neto: <b>Q ${(ti-te).toFixed(2)}</b>`;
    await tgSend(chatId, reply);
    return;
  }

  // AYUDA
  if (parsed.type === 'help') {
    await tgSend(chatId,
      `🤖 <b>Comandos disponibles</b>\n\n` +
      `<b>📦 Registrar ventas:</b>\n` +
      `• "vendí 10 tacos a Q15"\n` +
      `• "se vendieron 5 pupusas a 20"\n` +
      `• "venta de 500"\n\n` +
      `<b>💸 Registrar gastos:</b>\n` +
      `• "gasto de 200 en renta"\n` +
      `• "compré 3 kg de carne a Q50"\n` +
      `• "pagamos Q150 de luz"\n\n` +
      `<b>📊 Consultas:</b>\n` +
      `• /balance — resumen general\n` +
      `• /negocios — listar negocios\n` +
      `• /inventario — ver productos vendidos hoy\n\n` +
      `<b>🏢 Negocios:</b>\n` +
      `• /nuevo negocio Tacos Don Pedro`
    );
    return;
  }

  // LISTAR NEGOCIOS
  if (parsed.type === 'list_businesses') {
    const r = await pool.query('SELECT name FROM businesses ORDER BY name');
    if (!r.rows.length) { await tgSend(chatId, '🏢 Sin negocios. Creá uno con /nuevo negocio [nombre]'); return; }
    await tgSend(chatId, '🏢 <b>Tus negocios:</b>\n\n' + r.rows.map(b => `• ${b.name}`).join('\n'));
    return;
  }

  // INVENTARIO DEL DÍA
  if (parsed.type === 'inventory') {
    const today = new Date().toISOString().split('T')[0];
    const r = await pool.query(`
      SELECT b.name as biz, t.description, t.amount, t.type
      FROM transactions t JOIN businesses b ON b.id=t.business_id
      WHERE t.date=$1 ORDER BY b.name, t.created_at DESC
    `, [today]);
    if (!r.rows.length) { await tgSend(chatId, `📦 Sin movimientos hoy (${today})`); return; }
    let reply = `📦 <b>Movimientos de hoy</b>\n\n`;
    let lastBiz = '';
    for (const row of r.rows) {
      if (row.biz !== lastBiz) { reply += `\n🏢 <b>${row.biz}</b>\n`; lastBiz = row.biz; }
      const icon = row.type === 'income' ? '✅' : '❌';
      reply += `  ${icon} ${row.description} — Q ${parseFloat(row.amount).toFixed(2)}\n`;
    }
    await tgSend(chatId, reply);
    return;
  }

  // NUEVO NEGOCIO
  if (parsed.type === 'new_business') {
    const existing = await pool.query('SELECT id FROM businesses WHERE LOWER(name)=LOWER($1)', [parsed.name]);
    if (existing.rows.length) { await tgSend(chatId, `⚠️ Ya existe <b>${parsed.name}</b>.`); return; }
    const colors = ['#6c5ce7','#00b894','#e17055','#0984e3','#fdcb6e','#e84393'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    await pool.query('INSERT INTO businesses(name,category,color) VALUES($1,$2,$3)', [parsed.name, 'General', color]);
    await tgSend(chatId, `✅ Negocio <b>${parsed.name}</b> creado.\n\nYa podés registrar movimientos para este negocio.`);
    return;
  }

  if (parsed.type === 'no_amount') {
    await tgSend(chatId, `⚠️ No encontré el monto.\n\nEjemplos:\n• "venta de 150"\n• "10 tacos a Q15"\n• "gasto de 200 en renta"`);
    return;
  }

  if (parsed.type === 'unknown') {
    await tgSend(chatId, `🤔 No entendí. Probá:\n• "vendí 10 tacos a Q15"\n• "gasto de 200"\n• /balance\n• /ayuda`);
    return;
  }

  // INGRESO O GASTO — buscar negocio
  const businesses = await pool.query('SELECT id, name FROM businesses ORDER BY name');
  const bizList = businesses.rows;

  if (!bizList.length) {
    await tgSend(chatId, `⚠️ No tenés negocios.\n\nCreá uno con:\n/nuevo negocio [nombre]`);
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
    sessions[chatId] = { step: 'choose_business', parsed, userName, businesses: bizList };
    const opts = bizList.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
    const icon = parsed.type === 'income' ? '💰' : '💸';
    const label = parsed.type === 'income' ? 'Ingreso' : 'Gasto';
    await tgSend(chatId,
      `${icon} <b>${label}: Q ${parsed.amount.toFixed(2)}</b>\n📝 ${parsed.description}\n\n¿A qué negocio?\n\n${opts}\n\nResponde con el número o nombre.`
    );
  }
}

async function handleSession(chatId, text, userName) {
  const session = sessions[chatId];
  if (session.step === 'choose_business') {
    const bizList = session.businesses;
    let chosen = null;
    const num = parseInt(text);
    if (num >= 1 && num <= bizList.length) chosen = bizList[num - 1];
    else {
      const result = findBestBusiness(text, bizList);
      if (result) chosen = result.business;
    }
    if (!chosen) { await tgSend(chatId, `⚠️ No entendí. Respondé con el número o nombre.`); return; }
    delete sessions[chatId];
    await saveTransaction(chatId, chosen, session.parsed, userName);
  }
}

async function saveTransaction(chatId, business, parsed, userName) {
  await pool.query(
    'INSERT INTO transactions(business_id,type,amount,description,category,date) VALUES($1,$2,$3,$4,$5,$6)',
    [business.id, parsed.type, parsed.amount, parsed.description,
     parsed.type === 'income' ? 'Ventas' : 'Gastos',
     new Date().toISOString().split('T')[0]]
  );
  const r = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) as balance FROM transactions WHERE business_id=$1`,
    [business.id]
  );
  const balance = parseFloat(r.rows[0].balance);
  const icon = parsed.type === 'income' ? '✅' : '❌';
  const label = parsed.type === 'income' ? 'Ingreso' : 'Gasto';
  let reply = `${icon} <b>${label} registrado</b>\n\n`;
  reply += `🏢 <b>${business.name}</b>\n`;
  if (parsed.qty) reply += `📦 ${parsed.qty} × ${parsed.item} a Q${parsed.unitPrice.toFixed(2)}\n`;
  reply += `💵 Total: <b>Q ${parsed.amount.toFixed(2)}</b>\n`;
  reply += `📝 ${parsed.description}\n`;
  reply += `👤 ${userName}\n\n`;
  reply += `📊 Balance ${business.name}: <b>Q ${balance.toFixed(2)}</b>`;
  await tgSend(chatId, reply);
}

// ============ WEBHOOK ============
function setupBot(app) {
  app.post('/webhook/telegram', async (req, res) => {
    res.sendStatus(200);
    try {
      const update = req.body;
      if (update.message) await handleMessage(update.message);
    } catch (e) { console.error('Bot error:', e.message); }
  });
  console.log('🤖 Bot de Telegram listo');
}

async function registerWebhook(baseUrl) {
  const token = await getConfig('tg_token');
  if (!token) { console.log('⚠️ Bot: sin tg_token'); return; }
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${baseUrl}/webhook/telegram` })
  });
  const data = await res.json();
  console.log('🤖 Webhook:', data.ok ? '✅' : '❌ ' + data.description);
}

module.exports = { setupBot, registerWebhook };
