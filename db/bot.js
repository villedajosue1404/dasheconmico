const fetch = require('node-fetch');
const { pool } = require('./db/schema');
const { publishToTelegram, publishToFacebook } = require('./scheduler');

// ── Enviar mensaje de texto al usuario del bot ──
async function tgSend(chatId, text) {
  const token = await getConfig('tg_token');
  if (!token) return;
  await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
  });
}

// ── Obtener valor de config desde DB ──
async function getConfig(key) {
  const r = await pool.query('SELECT value FROM config WHERE key=$1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}

// ── Calcular similitud entre dos strings (0 a 1) ──
function similarity(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;
  let matches = 0;
  const shorter = a.length < b.length ? a : b;
  const longer  = a.length < b.length ? b : a;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
}

// ── Buscar negocio más parecido al texto dado ──
function findBestBusiness(input, businesses) {
  if (!businesses.length || !input) return null;
  let best = null, bestScore = 0;
  for (let i = 0; i < businesses.length; i++) {
    const score = similarity(input, businesses[i].name);
    if (score > bestScore) { bestScore = score; best = businesses[i]; }
  }
  return bestScore > 0.3 ? { business: best, score: bestScore } : null;
}

// ── Verificar si el mensaje es un comando específico ──
function isCmd(t, words) {
  for (let i = 0; i < words.length; i++) {
    if (t === words[i] || t === '/' + words[i] ||
        t.startsWith(words[i] + ' ') || t.startsWith('/' + words[i] + ' ')) return true;
  }
  return false;
}

// ── Extraer nombre de negocio mencionado en el texto ──
function extractBizHint(t) {
  const m = t.match(/(?:de|en|para|del|negocio|local)\s+([a-z\u00e0-\u00fc\s]{2,25}?)(?:\s+por|\s+a\s|\s+\d|,|$)/i);
  return m ? m[1].trim() : null;
}

// ── Parsear días escritos en español/inglés ──
// Acepta: "lunes", "lun", "mon", "monday", etc.
function parseDays(text) {
  const map = {
    'lun': 'mon', 'lunes': 'mon', 'monday': 'mon', 'mon': 'mon',
    'mar': 'tue', 'martes': 'tue', 'tuesday': 'tue', 'tue': 'tue',
    'mie': 'wed', 'mier': 'wed', 'miercoles': 'wed', 'wednesday': 'wed', 'wed': 'wed',
    'jue': 'thu', 'jueves': 'thu', 'thursday': 'thu', 'thu': 'thu',
    'vie': 'fri', 'viernes': 'fri', 'friday': 'fri', 'fri': 'fri',
    'sab': 'sat', 'sabado': 'sat', 'saturday': 'sat', 'sat': 'sat',
    'dom': 'sun', 'domingo': 'sun', 'sunday': 'sun', 'sun': 'sun'
  };
  // Detectar "todos los dias" o "cada dia"
  if (/todos|cada dia|diario|daily/i.test(text)) {
    return 'mon,tue,wed,thu,fri,sat,sun';
  }
  // Detectar "fines de semana" o "fin de semana"
  if (/fines?|fin de semana|weekend/i.test(text)) {
    return 'sat,sun';
  }
  // Detectar "dias de semana" o "entre semana"
  if (/entre semana|dias de semana|weekday/i.test(text)) {
    return 'mon,tue,wed,thu,fri';
  }
  // Buscar días individuales mencionados
  const found = [];
  const words = text.toLowerCase().replace(/,/g, ' ').split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const day = map[words[i]];
    if (day && found.indexOf(day) === -1) found.push(day);
  }
  return found.length ? found.join(',') : 'mon,tue,wed,thu,fri,sat,sun';
}

// ── Parsear horas del texto ──
// Acepta: "8am", "8:00 am", "8", "20:00", "8 am 12 pm 5 pm"
function parseTimes(text) {
  const times = [];
  // Solo detectar horas si tienen am/pm O si estan despues de "a las", "las", ":"
  // Esto evita que numeros del contenido se confundan con horas
  const re1 = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/gi; // con am/pm
  const re2 = /(?:a\s+las?|las?)\s+(\d{1,2})(?::(\d{2}))?(\s*(?:am|pm))?/gi; // despues de "a las"
  const re3 = /(\d{1,2}):(\d{2})/g; // formato 12:00
  let m;
  // Buscar con am/pm
  while ((m = re1.exec(text)) !== null) {
    let hour = parseInt(m[1]);
    const min = m[2] ? parseInt(m[2]) : 0;
    const ampm = m[3].toLowerCase();
    if (ampm === 'pm' && hour !== 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) {
      const t = String(hour).padStart(2,'0') + ':' + String(min).padStart(2,'0');
      if (times.indexOf(t) === -1) times.push(t);
    }
  }
  // Buscar despues de "a las"
  while ((m = re2.exec(text)) !== null) {
    let hour = parseInt(m[1]);
    const min = m[2] ? parseInt(m[2]) : 0;
    const ampm = m[3] ? m[3].trim().toLowerCase() : null;
    if (ampm === 'pm' && hour !== 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23) {
      const t = String(hour).padStart(2,'0') + ':' + String(min).padStart(2,'0');
      if (times.indexOf(t) === -1) times.push(t);
    }
  }
  // Buscar formato HH:MM
  while ((m = re3.exec(text)) !== null) {
    const hour = parseInt(m[1]);
    const min = parseInt(m[2]);
    if (hour >= 0 && hour <= 23 && min >= 0 && min <= 59) {
      const t = String(hour).padStart(2,'0') + ':' + String(min).padStart(2,'0');
      if (times.indexOf(t) === -1) times.push(t);
    }
  }
  return times;
}

// ── Analizar mensaje de texto del usuario ──
function parseMessage(text) {
  const t = text.toLowerCase().trim();

  if (isCmd(t, ['balance', 'saldo', 'resumen']))  return { type: 'balance' };
  if (isCmd(t, ['ayuda', 'help', 'inicio', 'start'])) return { type: 'help' };
  if (isCmd(t, ['negocios']))    return { type: 'list_businesses' };
  if (isCmd(t, ['inventario']))  return { type: 'inventory' };
  if (isCmd(t, ['programados'])) return { type: 'list_scheduled' };

  // /ventas mes — ventas del mes actual
  if (isCmd(t, ['ventas','ingresos'])) return { type: 'sales_month' };

  // /nuevo negocio Nombre
  const newBizMatch = t.match(/^(?:\/?)(?:nuevo negocio|crear negocio|abrir negocio)\s+(.+)/i);
  if (newBizMatch) return { type: 'new_business', name: newBizMatch[1].trim() };

  // Formato cantidad: "10 tacos a Q15"
  const qtyMatch = t.match(/(\d+(?:\.\d+)?)\s+([a-z\u00e0-\u00fc\s]{2,25}?)\s+a\s+[qQ]?\s*(\d+(?:\.\d{1,2})?)/i);
  if (qtyMatch) {
    const qty       = parseFloat(qtyMatch[1]);
    const item      = qtyMatch[2].trim().replace(/\b(de|kg|unidades|piezas)\b/gi,'').trim();
    const unitPrice = parseFloat(qtyMatch[3]);
    const isExp     = /gast|compr|pagu|insum|mater/i.test(t);
    return {
      type: isExp ? 'expense' : 'income',
      amount: qty * unitPrice,
      qty: qty, unitPrice: unitPrice, item: item,
      description: qty + ' ' + item + ' a Q' + unitPrice.toFixed(2) + ' c/u',
      bizHint: extractBizHint(t)
    };
  }

  // Formato normal ingreso/gasto
  const isIncome  = /vend|ingres|cobr|ganancia|venta|recibi|factur|gan[eo]/i.test(t);
  const isExpense = /gast|pagu|compr|egres|rent|sueldo|invert/i.test(t);
  const hasNumber = /\d/.test(t);
  if (!isIncome && !isExpense && !hasNumber) return { type: 'unknown' };

  const amountMatch = t.match(/q\s*(\d+(?:\.\d{1,2})?)/i) ||
                      t.match(/(\d+(?:\.\d{1,2})?)\s*(?:q|quetzales)\b/i) ||
                      t.match(/(\d+(?:\.\d{1,2})?)/i);
  if (!amountMatch) return { type: 'no_amount' };

  let desc = t
    .replace(/q\s*\d+(?:\.\d{1,2})?/gi,'')
    .replace(/\d+(?:\.\d{1,2})?\s*(?:q|quetzales)?/gi,'')
    .replace(/se\s+vendieron|vendi|gaste|pague|ingreso|venta de|gasto de|gasto en/gi,'')
    .replace(/\b(por|de|en|el|la|los|las|un|una)\b/gi,' ')
    .replace(/\s+/g,' ').trim();

  const finalType = (isExpense && !isIncome) ? 'expense' : 'income';
  return {
    type: finalType,
    amount: parseFloat(amountMatch[1]),
    description: desc || (finalType === 'income' ? 'Ingreso' : 'Gasto'),
    bizHint: extractBizHint(t)
  };
}

// ── Sesiones activas (esperando respuesta del usuario) ──
const sessions = {};

// ── Handler principal de mensajes ──
async function handleMessage(msg) {
  const chatId   = msg.chat.id;
  const text     = (msg.text || '').trim();
  const userName = (msg.from && msg.from.first_name) ? msg.from.first_name : 'equipo';
  const photo    = msg.photo;  // array de fotos si el mensaje tiene imagen

  // Si hay sesión pendiente, redirigir
  if (sessions[chatId]) {
    await handleSession(chatId, text, userName, msg);
    return;
  }

  // ── PUBLICACIÓN CON FOTO ──
  // Si el usuario mandó una foto con caption
  if (photo && photo.length > 0) {
    const caption = (msg.caption || '').trim();
    const fileId = photo[photo.length - 1].file_id;
    if (!caption) {
      // Sin caption — guardar foto y pedir texto
      await tgSend(chatId, 'Foto recibida. Ahora enviame el texto y cuando publicar.');
      sessions[chatId] = { step: 'waiting_caption', photoFileId: fileId, userName: userName };
      return;
    }
    // Con caption — el contenido es el caption completo, sin las palabras de comando
    const triggerWords = /\s*(publica\s+ahorita|publica\s+ahora|publicar\s+ahorita|publicar\s+ahora|publica|publicar)\s*$/i;
    const hasPublishTrigger = triggerWords.test(caption);
    if (hasPublishTrigger) {
      // Publicar inmediatamente — contenido = caption sin el trigger
      const postContent = caption.replace(triggerWords, '').trim();
      const photoUrl = await getTelegramFileUrl(fileId);
      const rTg = await publishToTelegram(postContent, photoUrl);
      const rFb = await publishToFacebook(postContent, photoUrl);
      let reply = rTg.ok ? 'Publicado en Telegram' : 'Error TG: ' + rTg.error;
      reply += '\n' + (rFb.ok ? 'Publicado en Facebook' : 'Error FB: ' + rFb.error);
      await pool.query('INSERT INTO posts(network,content,status,published_at) VALUES($1,$2,$3,NOW())', ['tg', postContent || '[foto]', 'published']);
      await tgSend(chatId, reply);
    } else {
      // Tiene horario o programación — procesar normalmente
      await handlePublishRequest(chatId, caption, fileId, userName);
    }
    return;
  }

  // ── TEXTO NORMAL ──
  if (!text) return;

  // Comandos de userbot
  if (await handleUserbotCommands(chatId, text, userName)) return;

  // Detectar solicitud de publicación con texto (sin foto)
  if (/publicar|publish/i.test(text)) {
    await handlePublishRequest(chatId, text, null, userName);
    return;
  }

  const parsed = parseMessage(text);

  // ── BALANCE GENERAL ──
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
      ti += parseFloat(b.income); te += parseFloat(b.expense);
    }
    reply += 'TOTAL: Q ' + ti.toFixed(2) + ' ingresos | Q ' + te.toFixed(2) + ' gastos\nNeto: <b>Q ' + (ti-te).toFixed(2) + '</b>';
    await tgSend(chatId, reply);
    return;
  }

  // ── VENTAS DEL MES ──
  if (parsed.type === 'sales_month') {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;
    const r = await pool.query(
      'SELECT b.name,' +
      'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE 0 END),0) as income,' +
      'COALESCE(SUM(CASE WHEN t.type=\'expense\' THEN t.amount ELSE 0 END),0) as expense ' +
      'FROM businesses b ' +
      'LEFT JOIN transactions t ON t.business_id=b.id ' +
      'AND EXTRACT(MONTH FROM t.date)=$1 AND EXTRACT(YEAR FROM t.date)=$2 ' +
      'GROUP BY b.id,b.name ORDER BY income DESC',
      [month, year]
    );
    const monthNames = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
                        'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    let reply = '<b>Ventas de ' + monthNames[month] + ' ' + year + '</b>\n\n';
    let total = 0;
    for (let i = 0; i < r.rows.length; i++) {
      const b = r.rows[i];
      const inc = parseFloat(b.income);
      const exp = parseFloat(b.expense);
      reply += '<b>' + b.name + '</b>\n';
      reply += '  Ventas:  Q ' + inc.toFixed(2) + '\n';
      reply += '  Gastos:  Q ' + exp.toFixed(2) + '\n';
      reply += '  Neto:    Q ' + (inc - exp).toFixed(2) + '\n\n';
      total += inc;
    }
    reply += 'Total ventas del mes: <b>Q ' + total.toFixed(2) + '</b>';
    await tgSend(chatId, reply);
    return;
  }

  // ── AYUDA ──
  if (parsed.type === 'help') {
    await tgSend(chatId,
      '<b>Comandos disponibles</b>\n\n' +
      '<b>Finanzas:</b>\n' +
      '- "vendi 10 tacos a Q15"\n' +
      '- "gasto de 200 en renta"\n' +
      '- /balance\n' +
      '- /ventas (del mes)\n\n' +
      '<b>Publicar:</b>\n' +
      '- Manda foto + texto + "publicar"\n' +
      '- Para programar agrega dias y horas:\n' +
      '  "publicar cada dia a las 8am 12pm 5pm"\n' +
      '  "publicar viernes sabado domingo a las 9am"\n\n' +
      '<b>Negocios:</b>\n' +
      '- /nuevo negocio Nombre\n' +
      '- /negocios\n' +
      '- /inventario\n' +
      '- /programados'
    );
    return;
  }

  // ── LISTAR NEGOCIOS ──
  if (parsed.type === 'list_businesses') {
    const r = await pool.query('SELECT name FROM businesses ORDER BY name');
    if (!r.rows.length) { await tgSend(chatId, 'Sin negocios. Crea uno con /nuevo negocio [nombre]'); return; }
    let list = '<b>Tus negocios:</b>\n\n';
    for (let i = 0; i < r.rows.length; i++) list += '- ' + r.rows[i].name + '\n';
    await tgSend(chatId, list);
    return;
  }

  // ── INVENTARIO DEL DÍA ──
  if (parsed.type === 'inventory') {
    const today = new Date().toISOString().split('T')[0];
    const r = await pool.query(
      'SELECT b.name as biz,t.description,t.amount,t.type ' +
      'FROM transactions t JOIN businesses b ON b.id=t.business_id ' +
      'WHERE t.date=$1 ORDER BY b.name,t.created_at DESC', [today]
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

  // ── LISTAR POSTS PROGRAMADOS ──
  if (parsed.type === 'list_scheduled') {
    const r = await pool.query('SELECT * FROM scheduled_posts WHERE active=TRUE ORDER BY id');
    if (!r.rows.length) { await tgSend(chatId, 'No hay publicaciones programadas.'); return; }
    let reply = '<b>Publicaciones programadas</b>\n\n';
    for (let i = 0; i < r.rows.length; i++) {
      const sp = r.rows[i];
      reply += (i+1) + '. ' + sp.content.slice(0,40) + '...\n';
      reply += '   Dias: ' + sp.days + '\n';
      reply += '   Horas: ' + sp.times + '\n';
      reply += '   Redes: ' + sp.networks + '\n\n';
    }
    reply += 'Para cancelar una: /cancelar [numero]';
    await tgSend(chatId, reply);
    return;
  }

  // ── CANCELAR POST PROGRAMADO ──
  const cancelMatch = text.match(/^\/cancelar\s+(\d+)/i);
  if (cancelMatch) {
    const rows = await pool.query('SELECT * FROM scheduled_posts WHERE active=TRUE ORDER BY id');
    const idx  = parseInt(cancelMatch[1]) - 1;
    if (idx >= 0 && idx < rows.rows.length) {
      await pool.query('UPDATE scheduled_posts SET active=FALSE WHERE id=$1', [rows.rows[idx].id]);
      await tgSend(chatId, 'Publicacion #' + cancelMatch[1] + ' cancelada.');
    } else {
      await tgSend(chatId, 'Numero invalido. Usa /programados para ver la lista.');
    }
    return;
  }

  // ── NUEVO NEGOCIO ──
  if (parsed.type === 'new_business') {
    const existing = await pool.query('SELECT id FROM businesses WHERE LOWER(name)=LOWER($1)', [parsed.name]);
    if (existing.rows.length) { await tgSend(chatId, 'Ya existe un negocio llamado ' + parsed.name); return; }
    const colors = ['#6c5ce7','#00b894','#e17055','#0984e3','#fdcb6e'];
    const color  = colors[Math.floor(Math.random() * colors.length)];
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

  // ── REGISTRAR MOVIMIENTO FINANCIERO ──
  const bizRes  = await pool.query('SELECT id, name FROM businesses ORDER BY name');
  const bizList = bizRes.rows;
  if (!bizList.length) { await tgSend(chatId, 'No tienes negocios. Crea uno con:\n/nuevo negocio [nombre]'); return; }

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
    for (let i = 0; i < bizList.length; i++) opts += (i+1) + '. ' + bizList[i].name + '\n';
    const label = parsed.type === 'income' ? 'Ingreso' : 'Gasto';
    await tgSend(chatId, label + ': Q ' + parsed.amount.toFixed(2) + '\n' + parsed.description + '\n\nA que negocio?\n\n' + opts + '\nResponde con numero o nombre.');
  }
}

// ── Manejar solicitud de publicación (con o sin foto) ──
async function handlePublishRequest(chatId, text, photoFileId, userName) {
  const t = text.toLowerCase();

  // "ahorita", "ahora", "ya" = publicar inmediatamente sin buscar horarios
  if (/\bahorita\b|\bahora\b|\bya\b|^publicar$|^publica$/i.test(t)) {
    const content = text.replace(/publicar|publica|ahorita|ahora|ya/gi,'').trim();
    const photoUrl = photoFileId ? await getTelegramFileUrl(photoFileId) : null;
    const rTg = await publishToTelegram(content || '', photoUrl);
    const rFb = await publishToFacebook(content || '', photoUrl);
    let reply = rTg.ok ? 'Publicado en Telegram' : 'Error TG: ' + rTg.error;
    reply += '\n' + (rFb.ok ? 'Publicado en Facebook' : 'Error FB: ' + rFb.error);
    await pool.query('INSERT INTO posts(network,content,status,published_at) VALUES($1,$2,$3,NOW())', ['tg', content || '[foto]', 'published']);
    await tgSend(chatId, reply);
    return;
  }
  // Detectar si hay horarios en el mensaje
  const times = parseTimes(t);

  if (times.length === 0) {
    // Sin horario → publicar ahora
    const content = text.replace(/publicar/gi,'').trim();
    if (!content && !photoFileId) {
      await tgSend(chatId, 'Que quieres publicar? Escribe el texto.');
      sessions[chatId] = { step: 'waiting_content_to_publish', photoFileId: photoFileId, userName: userName };
      return;
    }
    // Obtener URL de la foto si existe
    const photoUrl = photoFileId ? await getTelegramFileUrl(photoFileId) : null;
    // Publicar en Telegram
    const rTg = await publishToTelegram(content || '', photoUrl);
    let reply = rTg.ok ? 'Publicado en Telegram' : 'Error Telegram: ' + rTg.error;
    // Publicar en Facebook
    const rFb = await publishToFacebook(content || '', photoUrl);
    reply += '\n' + (rFb.ok ? 'Publicado en Facebook' : 'Error Facebook: ' + rFb.error);
    // Guardar en posts
    await pool.query(
      'INSERT INTO posts(network,content,status,published_at) VALUES($1,$2,$3,NOW())',
      ['tg', content || '[foto]', 'published']
    );
    await tgSend(chatId, reply);
  } else {
    // Con horario → programar
    const days    = parseDays(t);
    const content = text
      .replace(/publicar/gi,'')
      .replace(/cada\s+dia|todos\s+los\s+dias|diario/gi,'')
      .replace(/lunes|martes|mier\w*|jueves|viernes|s[áa]bado|domingo/gi,'')
      .replace(/a\s+las?/gi,'')
      .replace(/\d{1,2}(?::\d{2})?\s*(?:am|pm)/gi,'')
      .replace(/\s+/g,' ').trim();

    const photoUrl = photoFileId ? await getTelegramFileUrl(photoFileId) : null;

    await pool.query(
      'INSERT INTO scheduled_posts(content,photo_url,networks,days,times,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [content || '[foto]', photoUrl, 'tg,fb', days, times.join(','), userName]
    );

    const dayLabels = {
      'mon,tue,wed,thu,fri,sat,sun': 'todos los dias',
      'sat,sun': 'fines de semana',
      'mon,tue,wed,thu,fri': 'dias de semana'
    };
    const dayText = dayLabels[days] || days;

    await tgSend(chatId,
      'Publicacion programada\n\n' +
      'Dias: ' + dayText + '\n' +
      'Horas: ' + times.join(', ') + '\n' +
      'Redes: Telegram + Facebook\n\n' +
      'Para ver todas: /programados\n' +
      'Para cancelar: /cancelar [numero]'
    );
  }
}

// ── Obtener URL pública de un archivo de Telegram ──
async function getTelegramFileUrl(fileId) {
  try {
    const token = await getConfig('tg_token');
    if (!token) return null;
    const res  = await fetch('https://api.telegram.org/bot' + token + '/getFile?file_id=' + fileId);
    const data = await res.json();
    if (!data.ok) return null;
    return 'https://api.telegram.org/file/bot' + token + '/' + data.result.file_path;
  } catch(e) { return null; }
}

// ── Manejar sesión activa (esperando respuesta del usuario) ──
async function handleSession(chatId, text, userName, msg) {
  const session = sessions[chatId];

  // Esperando caption de una foto ya enviada
  if (session.step === 'waiting_caption') {
    delete sessions[chatId];
    await handlePublishRequest(chatId, text, session.photoFileId, userName);
    return;
  }

  // Esperando contenido para publicar ahora
  if (session.step === 'waiting_content_to_publish') {
    delete sessions[chatId];
    const photoUrl = session.photoFileId ? await getTelegramFileUrl(session.photoFileId) : null;
    const rTg = await publishToTelegram(text, photoUrl);
    const rFb = await publishToFacebook(text, photoUrl);
    let reply = rTg.ok ? 'Publicado en Telegram' : 'Error TG: ' + rTg.error;
    reply += '\n' + (rFb.ok ? 'Publicado en Facebook' : 'Error FB: ' + rFb.error);
    await tgSend(chatId, reply);
    return;
  }

  // Esperando elegir negocio para movimiento financiero
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

// ── Guardar transacción en DB y confirmar ──
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

// ── Registrar webhook en Express ──
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

// ── Registrar la URL del webhook en Telegram ──
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


// ── Comandos de autenticación del userbot ──
async function handleUserbotCommands(chatId, text, userName) {
  const t = text.trim();

  // /conectar_cuenta — inicia el proceso de autenticacion
  if (t === '/conectar_cuenta' || t === 'conectar_cuenta') {
    const phone = await getConfig('tg_user_phone');
    if (!phone) {
      await tgSend(chatId, 'Para conectar tu cuenta necesito tu numero de telefono.\n\nEscribi:\n/mi_numero +50212345678');
      return true;
    }
    // Marcar que estamos esperando el codigo
    await pool.query(
      'INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
      ['tg_auth_code', 'pending']
    );
    try {
      const { startUserbot } = require('./userbot');
      startUserbot().catch(function(e) { console.log('Userbot auth:', e.message); });
    } catch(e) {}
    await tgSend(chatId, 'Iniciando conexion con tu cuenta...\n\nTelegram te va a mandar un codigo. Cuando lo recibas escribime:\n/codigo 12345');
    return true;
  }

  // /mi_numero +502... — guardar numero
  const phoneMatch = t.match(/^\/mi_numero\s+(\+\d{7,15})/i);
  if (phoneMatch) {
    await pool.query(
      'INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
      ['tg_user_phone', phoneMatch[1]]
    );
    await tgSend(chatId, 'Numero guardado: ' + phoneMatch[1] + '\n\nAhora escribe /conectar_cuenta para iniciar.');
    return true;
  }

  // /codigo 12345 — ingresar codigo de verificacion
  const codeMatch = t.match(/^\/codigo\s+(\d{4,6})/i);
  if (codeMatch) {
    await pool.query(
      'INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
      ['tg_auth_code', codeMatch[1]]
    );
    await tgSend(chatId, 'Codigo recibido. Verificando...');
    return true;
  }

  // /grupo_id -1001234567890 — configurar grupo donde publicar
  const groupMatch = t.match(/^\/grupo_id\s+(-?\d+)/i);
  if (groupMatch) {
    await pool.query(
      'INSERT INTO config(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
      ['tg_user_group_id', groupMatch[1]]
    );
    await tgSend(chatId, 'Grupo configurado: ' + groupMatch[1] + '\n\nAhora las publicaciones saldran desde tu cuenta personal en ese grupo.');
    return true;
  }

  // /estado_userbot — ver si esta conectado
  if (t === '/estado_userbot' || t === 'estado_userbot') {
    try {
      const userbot = require('./userbot');
      const connected = userbot.isConnected();
      const groupId = await getConfig('tg_user_group_id');
      await tgSend(chatId,
        'Estado userbot:\n' +
        'Conexion: ' + (connected ? 'Conectado' : 'Desconectado') + '\n' +
        'Grupo: ' + (groupId || 'No configurado') + '\n\n' +
        (connected ? 'Listo para publicar desde tu cuenta.' : 'Escribe /conectar_cuenta para conectar.')
      );
    } catch(e) {
      await tgSend(chatId, 'Userbot no disponible: ' + e.message);
    }
    return true;
  }

  return false;
}

module.exports = { setupBot: setupBot, registerWebhook: registerWebhook };
