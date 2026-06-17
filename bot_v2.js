// ============================================================
// BOT_V2.JS — Bot inteligente con IA como cerebro principal
// Groq interpreta TODOS los mensajes y decide la acción
// ============================================================

const fetch    = require('node-fetch');
const { pool } = require('./db/schema');
const { generatePDF, generateExcel } = require('./reports');

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// El bot opera como administrador del sistema
let ADMIN_USER_ID = null;

async function getAdminUserId() {
  if (ADMIN_USER_ID) return ADMIN_USER_ID;
  const r = await pool.query('SELECT id FROM users ORDER BY id LIMIT 1');
  if (r.rows.length) {
    ADMIN_USER_ID = r.rows[0].id;
    return ADMIN_USER_ID;
  }
  return null;
}

// ── Historial de conversación por usuario ──
const history = {};

function addHistory(chatId, role, content) {
  if (!history[chatId]) history[chatId] = [];
  history[chatId].push({ role, content });
  if (history[chatId].length > 8) history[chatId] = history[chatId].slice(-8);
}

// ── Obtener contexto de la DB ──
async function getContext(userId) {
  const uid = userId || await getAdminUserId();
  const biz = await pool.query(
    'SELECT b.id, b.name, b.color,' +
    'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE 0 END),0) as income,' +
    'COALESCE(SUM(CASE WHEN t.type=\'expense\' THEN t.amount ELSE 0 END),0) as expense,' +
    'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE -t.amount END),0) as balance ' +
    'FROM businesses b LEFT JOIN transactions t ON t.business_id=b.id AND t.user_id=$1 ' +
    'WHERE b.user_id=$1 ' +
    'GROUP BY b.id,b.name,b.color ORDER BY b.name',
    [uid]
  );
  const tx = await pool.query(
    'SELECT t.id,t.type,t.amount,t.description,t.date,b.name as business ' +
    'FROM transactions t JOIN businesses b ON b.id=t.business_id ' +
    'WHERE t.user_id=$1 ' +
    'ORDER BY t.created_at DESC LIMIT 8',
    [uid]
  );
  return { businesses: biz.rows, transactions: tx.rows };
}

async function getConfig(key) {
  const r = await pool.query('SELECT value FROM config WHERE key=$1', [key]);
  return r.rows[0] ? r.rows[0].value : null;
}

// ── Enviar mensaje de texto ──
async function tgSend(chatId, text) {
  const token = await getConfig('tg_token');
  if (!token) return;
  await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

// ── Enviar documento (PDF o Excel) ──
async function tgSendDoc(chatId, buffer, filename, caption) {
  const token = await getConfig('tg_token');
  if (!token) return;
  const FormData = require('form-data');
  const form = new FormData();
  form.append('chat_id', chatId.toString());
  form.append('caption', caption || filename);
  const mime = filename.endsWith('.pdf')
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  form.append('document', buffer, { filename, contentType: mime });
  await fetch('https://api.telegram.org/bot' + token + '/sendDocument', {
    method: 'POST', body: form, headers: form.getHeaders()
  });
}

// ── Cerebro: Groq decide qué hacer ──
async function think(chatId, userMessage, ctx) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { action: 'chat', reply: 'No tengo IA configurada. Agrega GROQ_API_KEY.' };

  const bizList = ctx.businesses.map(function(b) {
    return b.name + ' (id:' + b.id + ') ingresos:Q' + parseFloat(b.income).toFixed(2) +
           ' gastos:Q' + parseFloat(b.expense).toFixed(2) + ' balance:Q' + parseFloat(b.balance).toFixed(2);
  }).join('\n') || 'Sin negocios';

  const txList = ctx.transactions.map(function(t) {
    return '#' + t.id + ' ' + t.date + ' ' + t.business + ' ' + t.type +
           ' Q' + parseFloat(t.amount).toFixed(2) + ' "' + (t.description||'') + '"';
  }).join('\n') || 'Sin transacciones';

  const system =
    'Sos el asistente inteligente de "Centro de Mando", un sistema de gestión de negocios para Guatemala. ' +
    'Tu trabajo es interpretar mensajes en español guatemalteco informal y responder con JSON. ' +
    '\n\nDATOS ACTUALES:\nNegocios:\n' + bizList + '\n\nUltimas transacciones:\n' + txList +
    '\n\nRESPONDE SIEMPRE CON JSON VALIDO, sin texto extra, sin markdown, sin explicaciones. ' +
    'Acciones disponibles:\n' +
    '{"action":"record","type":"income|expense","amount":numero,"description":"texto","business_id":numero_o_null}\n' +
    '{"action":"balance"}\n' +
    '{"action":"sales_month"}\n' +
    '{"action":"list_businesses"}\n' +
    '{"action":"create_business","name":"nombre"}\n' +
    '{"action":"delete_business","id":numero,"name":"nombre"}\n' +
    '{"action":"delete_tx","id":numero}\n' +
    '{"action":"edit_tx","id":numero,"field":"amount|description","value":"nuevo"}\n' +
    '{"action":"last_tx"}\n' +
    '{"action":"report","period":"texto del periodo o nombre de negocio, incluye el estilo si el usuario lo pide (ej: ejecutivo, minimalista, colorido)"}\n' +
    '{"action":"excel","period":"texto del periodo o nombre de negocio"}\n' +
    '{"action":"publish_now","content":"texto a publicar"}\n' +
    '{"action":"schedule_post","content":"texto","days":"mon,tue,...","times":"09:00,18:00"}\n' +
    '{"action":"list_scheduled"}\n' +
    '{"action":"cancel_scheduled","id":numero}\n' +
    '{"action":"chat","reply":"respuesta en texto"}\n' +
    '\nREGLAS IMPORTANTES:\n' +
    '- Si el usuario pide "pdf", "informe", "reporte", "genera un informe", "dame un reporte", SIEMPRE usa action:report. NUNCA digas que no podes generar PDF.\n' +
    '- Si el usuario pide "excel", "hoja de calculo", "spreadsheet", SIEMPRE usa action:excel.\n' +
    '- Si menciona un negocio específico en el pedido de informe (ej: "informe de skittes", "reporte de gomitas"), ponelo en el campo period (ej: "skittes junio" o solo "skittes").\n' +
    '- Si el usuario registra una venta/gasto y no menciona negocio, usa business_id:null.\n' +
    '- Si dice "el último", "la #3" etc., busca en las transacciones recientes.\n' +
    '- Si es una pregunta de análisis, consejos o conversación general, usa action:chat con una respuesta útil.\n' +
    '- Moneda: Quetzales guatemaltecos (Q).\n' +
    '- Para días en schedule_post: lunes=mon, martes=tue, miercoles=wed, jueves=thu, viernes=fri, sabado=sat, domingo=sun.';

  const msgs = [{ role: 'system', content: system }]
    .concat(history[chatId] || [])
    .concat([{ role: 'user', content: userMessage }]);

  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: msgs, max_tokens: 400, temperature: 0.2 })
    });
    const data = await res.json();
    const raw  = data.choices && data.choices[0] ? data.choices[0].message.content : null;
    if (!raw) return { action: 'chat', reply: 'No pude procesar eso. Intenta de nuevo.' };

    addHistory(chatId, 'user', userMessage);
    addHistory(chatId, 'assistant', raw);

    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch(e) {
    console.error('Groq error:', e.message);
    return { action: 'chat', reply: 'Hubo un error. Intenta de nuevo.' };
  }
}

// ── Ejecutar la acción decidida por la IA ──
async function execute(chatId, intent, userName, msg) {
  const a = intent.action;

  const uid = await getAdminUserId();

  // REGISTRAR TRANSACCIÓN
  if (a === 'record') {
    const amount = parseFloat(intent.amount);
    if (!amount || amount <= 0) {
      await tgSend(chatId, 'No entendi el monto. Intenta de nuevo con un numero claro.');
      return;
    }
    if (!intent.business_id) {
      const biz = await pool.query('SELECT id,name FROM businesses WHERE user_id=$1 ORDER BY name', [uid]);
      if (biz.rows.length === 1) {
        intent.business_id = biz.rows[0].id;
      } else if (biz.rows.length > 1) {
        pendingTx[chatId] = intent;
        let opts = '';
        biz.rows.forEach(function(b, i) { opts += (i+1) + '. ' + b.name + '\n'; });
        await tgSend(chatId, (intent.type==='income'?'Ingreso':'Gasto') + ' de Q' + amount.toFixed(2) +
          '\n' + (intent.description||'') + '\n\n¿A qué negocio?\n\n' + opts + '\nResponde con número o nombre.');
        return;
      }
    }
    await saveTransaction(chatId, intent.business_id, intent.type, amount, intent.description, userName, uid);
    return;
  }

  // BALANCE
  if (a === 'balance') {
    const r = await pool.query(
      'SELECT b.name,' +
      'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE 0 END),0) as income,' +
      'COALESCE(SUM(CASE WHEN t.type=\'expense\' THEN t.amount ELSE 0 END),0) as expense,' +
      'COALESCE(SUM(CASE WHEN t.type=\'income\' THEN t.amount ELSE -t.amount END),0) as balance ' +
      'FROM businesses b LEFT JOIN transactions t ON t.business_id=b.id AND t.user_id=$1 ' +
      'WHERE b.user_id=$1 ' +
      'GROUP BY b.id,b.name ORDER BY balance DESC',
      [uid]
    );
    if (!r.rows.length) { await tgSend(chatId, 'No hay negocios todavia. Crea uno primero.'); return; }
    let reply = '<b>Balance general</b>\n\n';
    let ti = 0, te = 0;
    r.rows.forEach(function(b) {
      const bal = parseFloat(b.balance);
      reply += '<b>' + b.name + '</b>\n';
      reply += '  Ingresos: Q ' + parseFloat(b.income).toFixed(2) + '\n';
      reply += '  Gastos:   Q ' + parseFloat(b.expense).toFixed(2) + '\n';
      reply += '  Balance:  <b>Q ' + bal.toFixed(2) + '</b>\n\n';
      ti += parseFloat(b.income); te += parseFloat(b.expense);
    });
    reply += 'TOTAL: Q ' + ti.toFixed(2) + ' ingresos | Q ' + te.toFixed(2) + ' gastos\nNeto: <b>Q ' + (ti-te).toFixed(2) + '</b>';
    await tgSend(chatId, reply);
    return;
  }

  // VENTAS DEL MES
  if (a === 'sales_month') {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth()+1;
    const r = await pool.query(
      'SELECT b.name,' +
      'COALESCE(SUM(CASE WHEN t.type=\'income\' AND EXTRACT(MONTH FROM t.date)=$1 AND EXTRACT(YEAR FROM t.date)=$2 THEN t.amount ELSE 0 END),0) as income,' +
      'COALESCE(SUM(CASE WHEN t.type=\'expense\' AND EXTRACT(MONTH FROM t.date)=$1 AND EXTRACT(YEAR FROM t.date)=$2 THEN t.amount ELSE 0 END),0) as expense ' +
      'FROM businesses b LEFT JOIN transactions t ON t.business_id=b.id AND t.user_id=$3 ' +
      'WHERE b.user_id=$3 GROUP BY b.id,b.name ORDER BY income DESC',
      [m, y, uid]
    );
    const months = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    let reply = '<b>Ventas de ' + months[m] + ' ' + y + '</b>\n\n';
    let total = 0;
    r.rows.forEach(function(b) {
      reply += '<b>' + b.name + '</b>\n  Ventas: Q ' + parseFloat(b.income).toFixed(2) + '\n  Gastos: Q ' + parseFloat(b.expense).toFixed(2) + '\n\n';
      total += parseFloat(b.income);
    });
    reply += 'Total: <b>Q ' + total.toFixed(2) + '</b>';
    await tgSend(chatId, reply);
    return;
  }

  // LISTAR NEGOCIOS
  if (a === 'list_businesses') {
    const r = await pool.query('SELECT name FROM businesses WHERE user_id=$1 ORDER BY name', [uid]);
    if (!r.rows.length) { await tgSend(chatId, 'No hay negocios. Dime el nombre del negocio que quieres crear.'); return; }
    await tgSend(chatId, '<b>Tus negocios:</b>\n\n' + r.rows.map(function(b){return '• '+b.name;}).join('\n'));
    return;
  }

  // CREAR NEGOCIO
  if (a === 'create_business') {
    if (!intent.name) { await tgSend(chatId, 'Dime el nombre del negocio.'); return; }
    const ex = await pool.query('SELECT id FROM businesses WHERE LOWER(name)=LOWER($1) AND user_id=$2', [intent.name, uid]);
    if (ex.rows.length) { await tgSend(chatId, 'Ya existe un negocio llamado <b>' + intent.name + '</b>.'); return; }
    const colors = ['#6c5ce7','#00b894','#e17055','#0984e3','#fdcb6e','#e84393'];
    const color = colors[Math.floor(Math.random()*colors.length)];
    await pool.query('INSERT INTO businesses(user_id,name,category,color) VALUES($1,$2,$3,$4)', [uid, intent.name, 'General', color]);
    await tgSend(chatId, 'Negocio <b>' + intent.name + '</b> creado.');
    return;
  }

  // BORRAR NEGOCIO
  if (a === 'delete_business') {
    if (!intent.id) { await tgSend(chatId, 'No identifiqué qué negocio borrar.'); return; }
    const bizCheck = await pool.query('SELECT id FROM businesses WHERE id=$1 AND user_id=$2', [intent.id, uid]);
    if (!bizCheck.rows.length) { await tgSend(chatId, 'No encontré ese negocio.'); return; }
    pendingConfirm[chatId] = { type: 'delete_business', id: intent.id, name: intent.name };
    await tgSend(chatId, 'Seguro que queres borrar <b>' + intent.name + '</b> y TODAS sus transacciones?\n\nResponde <b>si</b> o <b>no</b>.');
    return;
  }

  // BORRAR TRANSACCIÓN
  if (a === 'delete_tx') {
    const tx = await pool.query('SELECT t.*,b.name as biz FROM transactions t JOIN businesses b ON b.id=t.business_id WHERE t.id=$1 AND t.user_id=$2', [intent.id, uid]);
    if (!tx.rows.length) { await tgSend(chatId, 'No encontré la transacción #' + intent.id); return; }
    const t2 = tx.rows[0];
    pendingConfirm[chatId] = { type: 'delete_tx', id: intent.id, desc: t2.biz + ' Q' + parseFloat(t2.amount).toFixed(2) + ' "' + t2.description + '"' };
    await tgSend(chatId, 'Seguro que queres borrar esta transacción?\n\n' + t2.biz + ' · ' + (t2.type==='income'?'+':'-') + 'Q' + parseFloat(t2.amount).toFixed(2) + '\n' + t2.description + '\n\nResponde <b>si</b> o <b>no</b>.');
    return;
  }

  // EDITAR TRANSACCIÓN
  if (a === 'edit_tx') {
    const tx = await pool.query('SELECT * FROM transactions WHERE id=$1 AND user_id=$2', [intent.id, uid]);
    if (!tx.rows.length) { await tgSend(chatId, 'No encontré la transacción #' + intent.id); return; }
    if (intent.field === 'amount') {
      const amt = parseFloat(intent.value);
      await pool.query('UPDATE transactions SET amount=$1 WHERE id=$2 AND user_id=$3', [amt, intent.id, uid]);
      await tgSend(chatId, 'Transacción #' + intent.id + ' actualizada. Nuevo monto: Q ' + amt.toFixed(2));
    } else {
      await pool.query('UPDATE transactions SET description=$1 WHERE id=$2 AND user_id=$3', [intent.value, intent.id, uid]);
      await tgSend(chatId, 'Transacción #' + intent.id + ' actualizada. Nueva descripción: ' + intent.value);
    }
    return;
  }

  // ÚLTIMAS TRANSACCIONES
  if (a === 'last_tx') {
    const r = await pool.query(
      'SELECT t.id,t.type,t.amount,t.description,t.date,b.name as biz FROM transactions t ' +
      'JOIN businesses b ON b.id=t.business_id WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 10',
      [uid]
    );
    if (!r.rows.length) { await tgSend(chatId, 'No hay transacciones todavia.'); return; }
    let reply = '<b>Ultimas transacciones</b>\n\n';
    r.rows.forEach(function(t) {
      reply += (t.type==='income'?'+ ':'- ') + '<b>#' + t.id + '</b> ' + t.biz + ' Q' + parseFloat(t.amount).toFixed(2) + '\n';
      reply += '   ' + (t.description||'—') + ' · ' + t.date + '\n\n';
    });
    await tgSend(chatId, reply);
    return;
  }

  // INFORME PDF
  if (a === 'report') {
    await tgSend(chatId, '⏳ Generando informe PDF con IA...');
    try {
      const { generateReport } = require('./ai');
      const aiText = await generateReport(intent.period || 'resumen general', chatId);
      const buf = await generatePDF(intent.period, aiText, uid, msg);
      await tgSendDoc(chatId, buf, 'informe.pdf', '📊 Informe ' + (intent.period||'general'));
    } catch(e) {
      console.error('PDF error:', e.message);
      await tgSend(chatId, '❌ Error generando PDF: ' + e.message);
    }
    return;
  }

  // EXCEL
  if (a === 'excel') {
    await tgSend(chatId, '⏳ Generando Excel...');
    try {
      const buf = await generateExcel(intent.period, uid);
      await tgSendDoc(chatId, buf, 'reporte.xlsx', '📈 Reporte Excel ' + (intent.period||'general'));
    } catch(e) {
      console.error('Excel error:', e.message);
      await tgSend(chatId, '❌ Error generando Excel: ' + e.message);
    }
    return;
  }

  // PUBLICAR AHORA
  if (a === 'publish_now') {
    const { publishToTelegram, publishToFacebook } = require('./scheduler');
    const rTg = await publishToTelegram(intent.content, null);
    const rFb = await publishToFacebook(intent.content, null);
    let reply = rTg.ok ? '✅ Publicado en Telegram' : '❌ Error TG: ' + rTg.error;
    reply += '\n' + (rFb.ok ? '✅ Publicado en Facebook' : 'Facebook no configurado');
    await tgSend(chatId, reply);
    return;
  }

  // PROGRAMAR POST
  if (a === 'schedule_post') {
    const days  = intent.days  || 'mon,tue,wed,thu,fri,sat,sun';
    const times = intent.times || '09:00';
    await pool.query(
      'INSERT INTO scheduled_posts(user_id,content,networks,days,times,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [uid, intent.content, 'tg,fb', days, times, userName]
    );
    const dayMap = {mon:'lunes',tue:'martes',wed:'miércoles',thu:'jueves',fri:'viernes',sat:'sábado',sun:'domingo'};
    const dayText = days.split(',').map(function(d){return dayMap[d]||d;}).join(', ');
    await tgSend(chatId, '✅ Publicación programada.\nDías: ' + dayText + '\nHoras: ' + times);
    return;
  }

  // LISTAR PROGRAMADOS
  if (a === 'list_scheduled') {
    const r = await pool.query('SELECT * FROM scheduled_posts WHERE active=TRUE AND user_id=$1 ORDER BY id', [uid]);
    if (!r.rows.length) { await tgSend(chatId, 'No hay publicaciones programadas.'); return; }
    let reply = '<b>Publicaciones programadas</b>\n\n';
    r.rows.forEach(function(sp, i) {
      reply += (i+1) + '. ' + sp.content.slice(0,50) + '...\n';
      reply += '   Días: ' + sp.days + ' · Horas: ' + sp.times + '\n\n';
    });
    await tgSend(chatId, reply);
    return;
  }

  // CANCELAR PROGRAMADO
  if (a === 'cancel_scheduled') {
    await pool.query('UPDATE scheduled_posts SET active=FALSE WHERE id=$1 AND user_id=$2', [intent.id, uid]);
    await tgSend(chatId, '✅ Publicación #' + intent.id + ' cancelada.');
    return;
  }

  // CHAT / RESPUESTA CONVERSACIONAL
  if (a === 'chat') {
    await tgSend(chatId, intent.reply || 'No entendi. Intenta de nuevo.');
    return;
  }

  await tgSend(chatId, 'No entendi eso. Intenta de nuevo.');
}

// ── Guardar transacción ──
async function saveTransaction(chatId, bizId, type, amount, description, userName, uid) {
  const today = new Date().toISOString().split('T')[0];
  await pool.query(
    'INSERT INTO transactions(user_id,business_id,type,amount,description,category,date) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [uid, bizId, type, amount, description||'', type==='income'?'Ventas':'Gastos', today]
  );
  let balText = '';
  if (bizId) {
    const r = await pool.query(
      'SELECT COALESCE(SUM(CASE WHEN type=\'income\' THEN amount ELSE -amount END),0) as balance,b.name FROM transactions t JOIN businesses b ON b.id=t.business_id WHERE t.business_id=$1 AND t.user_id=$2 GROUP BY b.name',
      [bizId, uid]
    );
    if (r.rows.length) balText = '\nBalance ' + r.rows[0].name + ': <b>Q ' + parseFloat(r.rows[0].balance).toFixed(2) + '</b>';
  }
  await tgSend(chatId,
    (type==='income'?'✅ INGRESO':'💸 GASTO') + ' registrado\n\n' +
    'Total: <b>Q ' + amount.toFixed(2) + '</b>\n' +
    'Detalle: ' + (description||'—') + '\n' +
    'Por: ' + userName + balText
  );
}

// ── Pendientes (esperando respuesta) ──
const pendingTx      = {};
const pendingConfirm = {};

// ── Handler principal ──
async function handleMessage(msg) {
  const chatId   = msg.chat.id;
  const text     = (msg.text || '').trim();
  const userName = (msg.from && msg.from.first_name) ? msg.from.first_name : 'equipo';
  const photo    = msg.photo;

  if (!text && !photo) return;

  // ── FOTO ──
  if (photo && photo.length > 0) {
    const fileId  = photo[photo.length-1].file_id;
    const caption = (msg.caption || '').trim();
    const token   = await getConfig('tg_token');
    const fileRes = await fetch('https://api.telegram.org/bot' + token + '/getFile?file_id=' + fileId);
    const fileData = await fileRes.json();
    const photoUrl = fileData.ok ? 'https://api.telegram.org/file/bot' + token + '/' + fileData.result.file_path : null;

    const captionLower = caption.toLowerCase();
    if (captionLower.includes('publica ahorita') || captionLower.includes('publicar ahorita') ||
        captionLower.includes('publica ahora')   || captionLower.includes('publicar ahora')) {
      const content = caption.replace(/publica ahorita|publicar ahorita|publica ahora|publicar ahora/gi,'').trim();
      const { publishToTelegram, publishToFacebook } = require('./scheduler');
      const rTg = await publishToTelegram(content, photoUrl);
      const rFb = await publishToFacebook(content, photoUrl);
      let reply = rTg.ok ? '✅ Publicado en Telegram' : '❌ Error TG: ' + rTg.error;
      reply += '\n' + (rFb.ok ? '✅ Publicado en Facebook' : 'Facebook no configurado');
      await tgSend(chatId, reply);
    } else if (caption) {
      await tgSend(chatId, 'Foto recibida con texto. Para publicar ahora agrega "Publica ahorita" al final.');
    } else {
      await tgSend(chatId, 'Foto recibida. Enviame el texto de la publicación.');
      pendingTx[chatId] = { waitingPhotoCaption: true, photoUrl };
    }
    return;
  }

  // ── CONFIRMACIONES PENDIENTES ──
  if (pendingConfirm[chatId]) {
    const pc = pendingConfirm[chatId];
    delete pendingConfirm[chatId];
    if (/^si$/i.test(text.trim())) {
      const uid = await getAdminUserId();
      if (pc.type === 'delete_business') {
        await pool.query('DELETE FROM businesses WHERE id=$1 AND user_id=$2', [pc.id, uid]);
        await tgSend(chatId, '✅ Negocio <b>' + pc.name + '</b> y todas sus transacciones borrados.');
      } else if (pc.type === 'delete_tx') {
        await pool.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [pc.id, uid]);
        await tgSend(chatId, '✅ Transacción borrada: ' + pc.desc);
      }
    } else {
      await tgSend(chatId, 'Cancelado.');
    }
    return;
  }

  // ── SELECCIÓN DE NEGOCIO PENDIENTE ──
  if (pendingTx[chatId] && !pendingTx[chatId].waitingPhotoCaption) {
    const uid = await getAdminUserId();
    const pt = pendingTx[chatId];
    delete pendingTx[chatId];
    const biz = await pool.query('SELECT id,name FROM businesses WHERE user_id=$1 ORDER BY name', [uid]);
    let chosen = null;
    const num = parseInt(text);
    if (num >= 1 && num <= biz.rows.length) {
      chosen = biz.rows[num-1];
    } else {
      for (let i = 0; i < biz.rows.length; i++) {
        if (biz.rows[i].name.toLowerCase().includes(text.toLowerCase())) { chosen = biz.rows[i]; break; }
      }
    }
    if (chosen) {
      await saveTransaction(chatId, chosen.id, pt.type, parseFloat(pt.amount), pt.description, userName);
    } else {
      await tgSend(chatId, 'No entendi. Responde con el numero o nombre del negocio.');
      pendingTx[chatId] = pt;
    }
    return;
  }

  // ── CEREBRO: GROQ DECIDE TODO ──
  const uid    = await getAdminUserId();
  const ctx    = await getContext(uid);
  const intent = await think(chatId, text, ctx);
  await execute(chatId, intent, userName, msg);
}

// ── Registrar webhook ──
function setupBot(app) {
  app.post('/webhook/telegram', function(req, res) {
    res.sendStatus(200);
    const update = req.body;
    if (update.message) {
      handleMessage(update.message).catch(function(e) { console.error('Bot error:', e.message); });
    }
  });
  console.log('Bot v2 listo');
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

module.exports = { setupBot, registerWebhook };
