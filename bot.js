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
  // Count matching chars
  let matches = 0;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
}

function findBestBusiness(input, businesses) {
  if (!businesses.length) return null;
  let best = null;
  let bestScore = 0;
  for (const b of businesses) {
    const score = similarity(input, b.name);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return bestScore > 0.3 ? { business: best, score: bestScore } : null;
}

// ============ NLP — entender el mensaje ============
function parseMessage(text) {
  const t = text.toLowerCase().trim();

  // Comandos especiales
  if (/^\/?(balance|saldo|resumen|cuanto|cuánto)/.test(t)) return { type: 'balance' };
  if (/^\/?ayuda|^\/help/.test(t)) return { type: 'help' };
  if (/^\/?negocios/.test(t)) return { type: 'list_businesses' };
  if (/^\/?nuevo negocio (.+)/.test(t)) {
    const m = t.match(/^\/?nuevo negocio (.+)/);
    return { type: 'new_business', name: m[1].trim() };
  }

  // Detectar tipo: ingreso o gasto
  const isIncome = /vend|ingres|cobr|entr[oó]|ganancia|venta|pag[oó]|recibi|cobr|factur/i.test(t);
  const isExpense = /gast|pagu[eé]|compr|egrés|salid|perd|invert|rent|sueldo|pag[oué] (a|por|de)/i.test(t);

  if (!isIncome && !isExpense) return { type: 'unknown' };

  // Extraer monto — buscar números con o sin Q/q/quetzales
  const amountMatch = t.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:q|quetzales|gtq)?/i) ||
                      t.match(/q\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (!amountMatch) return { type: 'no_amount' };
  const amount = parseFloat(amountMatch[1].replace(',', '.'));

  // Extraer descripción — todo lo que no sea el monto y palabras clave de tipo
  let description = t
    .replace(/\d+(?:[.,]\d{1,2})?\s*(?:q|quetzales|gtq)?/gi, '')
    .replace(/se\s+vendieron?|se\s+gast[oó]|gast[eé]|pagu[eé]|cobr[eé]|ingres[oó]|venta\s+de|compra\s+de|pago\s+de|gasto\s+en|gasto\s+de/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Intentar extraer negocio del mensaje
  // Busca patrones como "de [negocio]", "en [negocio]", "para [negocio]"
  const bizMatch = t.match(/(?:de|en|para|del|negocio)\s+([a-záéíóúñ\s]+?)(?:\s+por|\s+de|\s+\d|$)/i);
  const bizHint = bizMatch ? bizMatch[1].trim() : null;

  return {
    type: isIncome ? 'income' : 'expense',
    amount,
    description: description || (isIncome ? 'Ingreso' : 'Gasto'),
    bizHint
  };
}

// ============ ESTADOS DE CONVERSACIÓN ============
const sessions = {}; // chatId -> estado pendiente

// ============ HANDLER PRINCIPAL ============
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const userName = msg.from?.first_name || 'equipo';

  if (!text) return;

  // ¿Hay una sesión pendiente? (esperando respuesta del usuario)
  if (sessions[chatId]) {
    await handleSession(chatId, text, userName);
    return;
  }

  const parsed = parseMessage(text);

  // BALANCE
  if (parsed.type === 'balance') {
    const r = await pool.query(`
      SELECT b.name, b.color,
        COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END),0) as income,
        COALESCE(SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END),0) as expense,
        COALESCE(SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END),0) as balance
      FROM businesses b
      LEFT JOIN transactions t ON t.business_id=b.id
      GROUP BY b.id, b.name, b.color
      ORDER BY balance DESC
    `);
    if (!r.rows.length) {
      await tgSend(chatId, '📊 No hay negocios registrados todavía.\n\nUsá <b>/nuevo negocio [nombre]</b> para crear uno.');
      return;
    }
    let msg2 = '📊 <b>Balance general</b>\n\n';
    let totalIncome = 0, totalExpense = 0;
    for (const b of r.rows) {
      const bal = parseFloat(b.balance);
      const icon = bal >= 0 ? '📈' : '📉';
      msg2 += `${icon} <b>${b.name}</b>\n`;
      msg2 += `   ✅ Ingresos: Q ${parseFloat(b.income).toFixed(2)}\n`;
      msg2 += `   ❌ Gastos: Q ${parseFloat(b.expense).toFixed(2)}\n`;
      msg2 += `   💰 Balance: Q ${bal.toFixed(2)}\n\n`;
      totalIncome += parseFloat(b.income);
      totalExpense += parseFloat(b.expense);
    }
    const totalBal = totalIncome - totalExpense;
    msg2 += `─────────────────\n`;
    msg2 += `💼 <b>TOTAL</b>\n`;
    msg2 += `✅ Q ${totalIncome.toFixed(2)} | ❌ Q ${totalExpense.toFixed(2)}\n`;
    msg2 += `💰 Balance neto: <b>Q ${totalBal.toFixed(2)}</b>`;
    await tgSend(chatId, msg2);
    return;
  }

  // AYUDA
  if (parsed.type === 'help') {
    await tgSend(chatId, `🤖 <b>Comandos del bot</b>\n\n` +
      `<b>Registrar movimientos:</b>\n` +
      `• "se vendieron tacos por 150"\n` +
      `• "venta de 500 en la pizzería"\n` +
      `• "gasto de 200 en renta"\n` +
      `• "compré insumos por 350"\n\n` +
      `<b>Consultas:</b>\n` +
      `• /balance — ver resumen de todos los negocios\n` +
      `• /negocios — listar negocios\n\n` +
      `<b>Crear negocio:</b>\n` +
      `• /nuevo negocio Pizzería Central\n\n` +
      `El bot entiende lenguaje natural 🧠\n` +
      `No necesitás escribir exacto.`
    );
    return;
  }

  // LISTAR NEGOCIOS
  if (parsed.type === 'list_businesses') {
    const r = await pool.query('SELECT name FROM businesses ORDER BY name');
    if (!r.rows.length) {
      await tgSend(chatId, '🏢 No hay negocios. Creá uno con:\n<b>/nuevo negocio [nombre]</b>');
      return;
    }
    await tgSend(chatId, '🏢 <b>Tus negocios:</b>\n\n' + r.rows.map(b => `• ${b.name}`).join('\n'));
    return;
  }

  // NUEVO NEGOCIO
  if (parsed.type === 'new_business') {
    const existing = await pool.query('SELECT id FROM businesses WHERE LOWER(name)=LOWER($1)', [parsed.name]);
    if (existing.rows.length) {
      await tgSend(chatId, `⚠️ Ya existe un negocio llamado <b>${parsed.name}</b>.`);
      return;
    }
    const colors = ['#6c5ce7','#00b894','#e17055','#0984e3','#fdcb6e','#e84393'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    await pool.query('INSERT INTO businesses(name,category,color) VALUES($1,$2,$3)', [parsed.name, 'General', color]);
    await tgSend(chatId, `✅ Negocio <b>${parsed.name}</b> creado con éxito.\n\nYa podés registrar movimientos para este negocio.`);
    return;
  }

  // SIN MONTO
  if (parsed.type === 'no_amount') {
    await tgSend(chatId, `⚠️ Entendí que es un ${parsed.type === 'income' ? 'ingreso' : 'gasto'} pero no encontré el monto.\n\nEjemplo: <b>"venta de tacos por 150"</b>`);
    return;
  }

  // DESCONOCIDO
  if (parsed.type === 'unknown') {
    await tgSend(chatId, `🤔 No entendí bien el mensaje.\n\nProbá con:\n• "venta de 200"\n• "gasto de 150 en renta"\n• /balance\n• /ayuda`);
    return;
  }

  // INGRESO O GASTO — buscar negocio
  const businesses = await pool.query('SELECT id, name FROM businesses ORDER BY name');
  const bizList = businesses.rows;

  if (!bizList.length) {
    await tgSend(chatId, `⚠️ No tenés negocios registrados.\n\nCreá uno primero:\n<b>/nuevo negocio [nombre]</b>`);
    return;
  }

  // Intentar match automático
  let matchedBiz = null;
  if (parsed.bizHint) {
    const result = findBestBusiness(parsed.bizHint, bizList);
    if (result && result.score > 0.6) matchedBiz = result.business;
  }

  // Si solo hay un negocio, usarlo automáticamente
  if (!matchedBiz && bizList.length === 1) {
    matchedBiz = bizList[0];
  }

  if (matchedBiz) {
    // Registrar directo
    await saveTransaction(chatId, matchedBiz, parsed, userName);
  } else {
    // Preguntar a cuál negocio
    sessions[chatId] = { step: 'choose_business', parsed, userName };
    const bizButtons = bizList.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
    await tgSend(chatId,
      `${parsed.type === 'income' ? '💰' : '💸'} <b>${parsed.type === 'income' ? 'Ingreso' : 'Gasto'} de Q ${parsed.amount.toFixed(2)}</b>\n` +
      `📝 "${parsed.description}"\n\n` +
      `¿A qué negocio pertenece?\n\n${bizButtons}\n\n` +
      `Respondé con el número o el nombre.`
    );
    sessions[chatId].businesses = bizList;
  }
}

async function handleSession(chatId, text, userName) {
  const session = sessions[chatId];

  if (session.step === 'choose_business') {
    const bizList = session.businesses;
    let chosen = null;

    // Por número
    const num = parseInt(text);
    if (num >= 1 && num <= bizList.length) {
      chosen = bizList[num - 1];
    } else {
      // Por nombre fuzzy
      const result = findBestBusiness(text, bizList);
      if (result) chosen = result.business;
    }

    if (!chosen) {
      await tgSend(chatId, `⚠️ No entendí. Respondé con el número o nombre del negocio.`);
      return;
    }

    delete sessions[chatId];
    await saveTransaction(chatId, chosen, session.parsed, userName);
  }
}

async function saveTransaction(chatId, business, parsed, userName) {
  await pool.query(
    'INSERT INTO transactions(business_id,type,amount,description,category,date) VALUES($1,$2,$3,$4,$5,$6)',
    [business.id, parsed.type, parsed.amount, parsed.description, parsed.type === 'income' ? 'Ventas' : 'Gastos', new Date().toISOString().split('T')[0]]
  );

  const icon = parsed.type === 'income' ? '✅' : '❌';
  const typeLabel = parsed.type === 'income' ? 'Ingreso' : 'Gasto';

  // Calcular balance actualizado del negocio
  const r = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) as balance FROM transactions WHERE business_id=$1`,
    [business.id]
  );
  const balance = parseFloat(r.rows[0].balance);

  await tgSend(chatId,
    `${icon} <b>${typeLabel} registrado</b>\n\n` +
    `🏢 Negocio: <b>${business.name}</b>\n` +
    `💵 Monto: <b>Q ${parsed.amount.toFixed(2)}</b>\n` +
    `📝 Detalle: ${parsed.description}\n` +
    `👤 Por: ${userName}\n\n` +
    `📊 Balance actual de ${business.name}: <b>Q ${balance.toFixed(2)}</b>`
  );
}

// ============ WEBHOOK ============
function setupBot(app) {
  app.post('/webhook/telegram', async (req, res) => {
    res.sendStatus(200); // Responder rápido a Telegram
    try {
      const update = req.body;
      if (update.message) {
        await handleMessage(update.message);
      }
    } catch (e) {
      console.error('Bot error:', e.message);
    }
  });

  console.log('🤖 Bot de Telegram listo en /webhook/telegram');
}

// ============ REGISTRAR WEBHOOK ============
async function registerWebhook(baseUrl) {
  const token = await getConfig('tg_token');
  if (!token) { console.log('⚠️ Bot: no hay tg_token configurado todavía'); return; }
  const webhookUrl = `${baseUrl}/webhook/telegram`;
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl })
  });
  const data = await res.json();
  console.log('🤖 Webhook registrado:', data.ok ? '✅' : '❌ ' + data.description);
}

module.exports = { setupBot, registerWebhook };
