// ============================================================
// REPORTS.JS — PDF con LaTeX (lualatex) + Excel con ExcelJS
// PDF profesional estilo académico, filtrado por negocio
// ============================================================

const { execSync }  = require('child_process');
const fs            = require('fs');
const os            = require('os');
const path          = require('path');
const ExcelJS       = require('exceljs');
const { pool }      = require('./db/schema');

// ── Escapa caracteres especiales de LaTeX ──
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function fmtQ(n) {
  return 'Q\\,' + parseFloat(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '{,}');
}

// ── Parsear período y detectar negocio específico en el filtro ──
function parseFilter(filter) {
  const f = (filter || '').toLowerCase();
  const now = new Date();

  // Detectar nombre de negocio en el filtro (ej: "skittes junio")
  let businessHint = null;
  const bizMatch = f.match(/(?:de|para|negocio|empresa)?\s*([a-záéíóúñ]{3,})\s*(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|semana|mes|año|hoy|ayer|$)/i);
  if (bizMatch) {
    const candidate = bizMatch[1].trim();
    // Ignorar palabras que son períodos o artículos
    const skipWords = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                       'septiembre','octubre','noviembre','diciembre','semana','mes','año',
                       'hoy','ayer','todo','todos','general','resumen','informe','reporte'];
    if (!skipWords.includes(candidate)) businessHint = candidate;
  }

  let dateFrom, dateTo, periodLabel;

  if (/enero|january/.test(f))          { dateFrom=`${now.getFullYear()}-01-01`; dateTo=`${now.getFullYear()}-01-31`; periodLabel='Enero '+now.getFullYear(); }
  else if (/febrero|february/.test(f))  { dateFrom=`${now.getFullYear()}-02-01`; dateTo=`${now.getFullYear()}-02-28`; periodLabel='Febrero '+now.getFullYear(); }
  else if (/marzo|march/.test(f))       { dateFrom=`${now.getFullYear()}-03-01`; dateTo=`${now.getFullYear()}-03-31`; periodLabel='Marzo '+now.getFullYear(); }
  else if (/abril|april/.test(f))       { dateFrom=`${now.getFullYear()}-04-01`; dateTo=`${now.getFullYear()}-04-30`; periodLabel='Abril '+now.getFullYear(); }
  else if (/mayo|may/.test(f))          { dateFrom=`${now.getFullYear()}-05-01`; dateTo=`${now.getFullYear()}-05-31`; periodLabel='Mayo '+now.getFullYear(); }
  else if (/junio|june/.test(f))        { dateFrom=`${now.getFullYear()}-06-01`; dateTo=`${now.getFullYear()}-06-30`; periodLabel='Junio '+now.getFullYear(); }
  else if (/julio|july/.test(f))        { dateFrom=`${now.getFullYear()}-07-01`; dateTo=`${now.getFullYear()}-07-31`; periodLabel='Julio '+now.getFullYear(); }
  else if (/agosto|august/.test(f))     { dateFrom=`${now.getFullYear()}-08-01`; dateTo=`${now.getFullYear()}-08-31`; periodLabel='Agosto '+now.getFullYear(); }
  else if (/septiembre|september/.test(f)){ dateFrom=`${now.getFullYear()}-09-01`; dateTo=`${now.getFullYear()}-09-30`; periodLabel='Septiembre '+now.getFullYear(); }
  else if (/octubre|october/.test(f))   { dateFrom=`${now.getFullYear()}-10-01`; dateTo=`${now.getFullYear()}-10-31`; periodLabel='Octubre '+now.getFullYear(); }
  else if (/noviembre|november/.test(f)){ dateFrom=`${now.getFullYear()}-11-01`; dateTo=`${now.getFullYear()}-11-30`; periodLabel='Noviembre '+now.getFullYear(); }
  else if (/diciembre|december/.test(f)){ dateFrom=`${now.getFullYear()}-12-01`; dateTo=`${now.getFullYear()}-12-31`; periodLabel='Diciembre '+now.getFullYear(); }
  else if (/semana|week/.test(f)) {
    const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1);
    dateFrom = mon.toISOString().split('T')[0]; dateTo = now.toISOString().split('T')[0];
    periodLabel = 'Esta semana';
  } else if (/ayer|yesterday/.test(f)) {
    const y = new Date(now); y.setDate(now.getDate() - 1);
    dateFrom = dateTo = y.toISOString().split('T')[0]; periodLabel = 'Ayer';
  } else if (/hoy|today/.test(f)) {
    dateFrom = dateTo = now.toISOString().split('T')[0]; periodLabel = 'Hoy';
  } else {
    const yr = now.getFullYear(); const mo = String(now.getMonth() + 1).padStart(2, '0');
    dateFrom = `${yr}-${mo}-01`; dateTo = now.toISOString().split('T')[0];
    periodLabel = 'Mes actual';
  }

  return { dateFrom, dateTo, periodLabel, businessHint };
}

// ── Obtener datos del período, opcionalmente filtrado por negocio ──
async function getReportData(filter, userId) {
  const { dateFrom, dateTo, periodLabel, businessHint } = parseFilter(filter);

  // Si hay hint de negocio, buscar coincidencia en DB
  let businessFilter = null;
  if (businessHint) {
    const bizSearch = await pool.query(
      'SELECT id, name FROM businesses WHERE LOWER(name) LIKE LOWER($1) AND user_id=$2 LIMIT 1',
      [`%${businessHint}%`, userId]
    );
    if (bizSearch.rows.length) businessFilter = bizSearch.rows[0];
  }

  // Query negocios — si hay filtro solo ese negocio, filtrar por user_id
  const bizWhere = businessFilter
    ? 'AND b.id = $3 AND b.user_id = $4'
    : 'AND b.user_id = $3';
  const bizParams = businessFilter
    ? [dateFrom, dateTo, businessFilter.id, userId]
    : [dateFrom, dateTo, userId];

  const bizQ = await pool.query(
    `SELECT b.id, b.name, b.color,
      COALESCE(SUM(CASE WHEN t.type='income' AND t.date BETWEEN $1 AND $2 THEN t.amount ELSE 0 END),0) AS income,
      COALESCE(SUM(CASE WHEN t.type='expense' AND t.date BETWEEN $1 AND $2 THEN t.amount ELSE 0 END),0) AS expense,
      COALESCE(SUM(CASE WHEN t.type='income' AND t.date BETWEEN $1 AND $2 THEN t.amount
                        WHEN t.type='expense' AND t.date BETWEEN $1 AND $2 THEN -t.amount ELSE 0 END),0) AS balance,
      COUNT(CASE WHEN t.date BETWEEN $1 AND $2 THEN 1 END) AS tx_count
    FROM businesses b LEFT JOIN transactions t ON t.business_id = b.id
    WHERE 1=1 ${bizWhere}
    GROUP BY b.id, b.name, b.color ORDER BY balance DESC`,
    bizParams
  );

  // Query transacciones
  const txWhere = businessFilter
    ? 'AND t.business_id = $3 AND t.user_id = $4'
    : 'AND t.user_id = $3';
  const txParams = businessFilter
    ? [dateFrom, dateTo, businessFilter.id, userId]
    : [dateFrom, dateTo, userId];
  const txQ = await pool.query(
    `SELECT t.date, t.type, t.amount, t.description, t.category, b.name AS business
     FROM transactions t JOIN businesses b ON b.id = t.business_id
     WHERE t.date BETWEEN $1 AND $2 ${txWhere}
     ORDER BY t.date DESC, t.created_at DESC`,
    txParams
  );

  const totalIncome  = bizQ.rows.reduce((s, b) => s + parseFloat(b.income),  0);
  const totalExpense = bizQ.rows.reduce((s, b) => s + parseFloat(b.expense), 0);
  const totalBalance = bizQ.rows.reduce((s, b) => s + parseFloat(b.balance), 0);

  return {
    period: businessFilter ? `${periodLabel} — ${businessFilter.name}` : periodLabel,
    dateFrom, dateTo,
    businesses: bizQ.rows,
    transactions: txQ.rows,
    totalIncome, totalExpense, totalBalance,
    singleBusiness: businessFilter ? businessFilter.name : null
  };
}

// ── IA genera JSON de estilo, template LaTeX lo renderiza ──
async function generateAIStyle(data, userRequest) {
  var key = process.env.GROQ_API_KEY;
  if (!key) return null;

  var topBiz = data.businesses.slice(0, 3).map(function(b) {
    return b.name + ': Q' + parseFloat(b.balance).toFixed(2);
  }).join(', ');

  var systemPrompt =
    'Eres un analisis financiero. Basado en los datos y la solicitud del usuario, ' +
    'genera solo las VARIABLES de estilo para un informe LaTeX. ' +
    'Responde UNICAMENTE con JSON, sin explicaciones, sin markdown:\n' +
    '{"title":"titulo","subtitle":"subtitulo","highlight":"insight clave en 1 oracion",' +
    '"focus":"ejecutivo|normal|detallado","theme":"moderno|clasico|minimalista"}\n\n' +
    'Solicitud: "' + userRequest + '"';

  var fetch = require('node-fetch');
  var groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Ingresos Q' + parseFloat(data.totalIncome).toFixed(2) +
          ', gastos Q' + parseFloat(data.totalExpense).toFixed(2) +
          ', balance Q' + parseFloat(data.totalBalance).toFixed(2) +
          ', ' + data.businesses.length + ' negocios. Top: ' + topBiz }
      ],
      max_tokens: 200,
      temperature: 0.2
    })
  });
  var groqData = await groqRes.json();
  var raw = groqData.choices && groqData.choices[0] ? groqData.choices[0].message.content : null;
  if (!raw) return null;
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch(_) { return null; }
}

// ── Generar el .tex del informe ──
function buildTex(data, aiAnalysis, style) {
  const genDate = new Date().toLocaleDateString('es-GT');
  const balColor = data.totalBalance >= 0 ? 'colorgreen' : 'colorred';

  // Aplicar estilo generado por IA si existe
  var reportTitle = style && style.title ? esc(style.title) : 'Informe Financiero';
  var reportSub   = style && style.subtitle ? esc(style.subtitle) : esc(data.period);
  var highlightText = style && style.highlight ? esc(style.highlight) : '';
  var accentColor   = style && style.color_accent ? style.color_accent : '6C5CE7';
  var theme         = style && style.theme ? style.theme : 'moderno';

  // Tema de colores
  var cAccent = accentColor;
  var cDark   = theme === 'clasico' ? '2C3E50' : '1A1A2E';
  var cGreen  = '00875A';
  var cRed    = 'C0392B';

  // Tabla de negocios
  const bizRows = data.businesses.map(b => {
    const bal = parseFloat(b.balance);
    const balCol = bal >= 0 ? 'colorgreen' : 'colorred';
    return `  \\textbf{${esc(b.name)}} & ${esc(fmtQ(b.income))} & ${esc(fmtQ(b.expense))} & {\\color{${balCol}}\\textbf{${esc(fmtQ(bal))}}} & ${b.tx_count} \\\\`;
  }).join('\n');

  // Tabla de transacciones (máx 50)
  const txRows = data.transactions.slice(0, 50).map(t => {
    const isInc = t.type === 'income';
    const amtColor = isInc ? 'colorgreen' : 'colorred';
    const sign = isInc ? '+' : '-';
    const dateStr = t.date ? String(t.date).slice(0, 10) : '';
    const desc = esc(t.description || t.category || '—').slice(0, 45);
    return `  ${esc(dateStr)} & ${esc(t.business)} & ${isInc ? 'Ingreso' : 'Gasto'} & ${desc} & {\\color{${amtColor}}${sign}${esc(fmtQ(t.amount))}} \\\\`;
  }).join('\n');

  // Análisis IA
  const aiSection = aiAnalysis ? `
\\section*{Análisis Inteligente}
\\begin{tcolorbox}[colback=accentbg,colframe=accent,title={\\faRobot\\quad Generado por IA -- Centro de Mando}]
${esc(aiAnalysis)}
\\end{tcolorbox}
` : '';

  const txSection = data.transactions.length > 0 ? `
\\newpage
\\section*{Transacciones del Período}

\\begin{longtable}{p{2cm}p{3cm}p{1.8cm}p{5.5cm}r}
\\toprule
\\rowcolor{darkbg}
\\color{white}\\textbf{Fecha} & \\color{white}\\textbf{Negocio} & \\color{white}\\textbf{Tipo} & \\color{white}\\textbf{Descripción} & \\color{white}\\textbf{Monto} \\\\
\\midrule
\\endhead
${txRows}
\\bottomrule
\\end{longtable}
` : '';

  return `\\documentclass[11pt,a4paper]{article}
\\usepackage{fontspec}
\\usepackage{xcolor}
\\usepackage{geometry}
\\usepackage{booktabs}
\\usepackage{longtable}
\\usepackage{colortbl}
\\usepackage{tabularx}
\\usepackage{tcolorbox}
\\usepackage{titlesec}
\\usepackage{parskip}
\\usepackage{fancyhdr}
\\usepackage{graphicx}
\\usepackage{array}

\\geometry{top=2cm,bottom=2.5cm,left=2.5cm,right=2.5cm}
\\setmainfont{DejaVu Sans}

% Colores
\\definecolor{accent}{HTML}{${cAccent}}
\\definecolor{accentbg}{HTML}{EDE9FF}
\\definecolor{colorgreen}{HTML}{${cGreen}}
\\definecolor{colorred}{HTML}{${cRed}}
\\definecolor{darkbg}{HTML}{${cDark}}
\\definecolor{lightgray}{HTML}{F4F4F8}
\\definecolor{medgray}{HTML}{888899}

% Encabezado y pie
\\pagestyle{fancy}
\\fancyhf{}
\\renewcommand{\\headrulewidth}{0pt}
\\fancyhead[L]{\\small\\color{medgray} Centro de Mando}
\\fancyhead[R]{\\small\\color{medgray} ${esc(data.period)}}
\\fancyfoot[C]{\\small\\color{medgray} Página \\thepage}

% Títulos de sección
\\titleformat{\\section*}{\\Large\\bfseries\\color{darkbg}}{}{0em}{}[\\color{accent}\\titlerule]

\\tcbuselibrary{skins,breakable}

\\begin{document}

% ── PORTADA ──────────────────────────────────────────────────
\\begin{center}
  \\colorbox{darkbg}{\\parbox{\\textwidth}{
    \\vspace{12pt}
    \\centering
    {\\fontsize{26}{30}\\selectfont\\bfseries\\color{accent} Centro de Mando}\\\\[6pt]
    {\\large\\color{white} ${reportTitle}}\\\\[4pt]
    {\\normalsize\\color{medgray} ${reportSub}}\\\\[6pt]
    {\\small\\color{medgray} Generado el ${esc(genDate)} $\\cdot$ ${esc(data.dateFrom)} al ${esc(data.dateTo)}}\\\\[12pt]
  }}
\\end{center}

\\vspace{16pt}

% ── MÉTRICAS PRINCIPALES ──────────────────────────────────────
\\section*{Resumen Ejecutivo}

\\begin{tabular}{p{4.5cm}p{4.5cm}p{4.5cm}}
\\cellcolor{green!12}\\textbf{\\color{colorgreen}Total Ingresos} &
\\cellcolor{red!12}\\textbf{\\color{colorred}Total Gastos} &
\\cellcolor{accentbg}\\textbf{\\color{accent}Balance Neto} \\\\[4pt]
\\cellcolor{green!12}{\\LARGE\\color{colorgreen} ${esc(fmtQ(data.totalIncome))}} &
\\cellcolor{red!12}{\\LARGE\\color{colorred} ${esc(fmtQ(data.totalExpense))}} &
\\cellcolor{accentbg}{\\LARGE\\color{${balColor}} ${esc(fmtQ(data.totalBalance))}} \\\\[6pt]
\\end{tabular}

\\vspace{18pt}

${highlightText ? `
% ── HIGHLIGHT IA ─────────────────────────────────────────────
\\begin{tcolorbox}[colback=accentbg,colframe=accent,arc=6pt]
\\textbf{\\color{accent}\\Large ${esc('✦')}} \\hspace{6pt} {\\large\\textbf{${highlightText}}}
\\end{tcolorbox}
\\vspace{12pt}
` : ''}

% ── DETALLE POR NEGOCIO ───────────────────────────────────────
\\section*{Detalle por Negocio}

\\begin{tabular}{lrrrr}
\\toprule
\\rowcolor{darkbg}
\\color{white}\\textbf{Negocio} & \\color{white}\\textbf{Ingresos} & \\color{white}\\textbf{Gastos} & \\color{white}\\textbf{Balance} & \\color{white}\\textbf{Movimientos} \\\\
\\midrule
${bizRows}
\\midrule
\\textbf{TOTAL} & \\textbf{${esc(fmtQ(data.totalIncome))}} & \\textbf{${esc(fmtQ(data.totalExpense))}} & {\\color{${balColor}}\\textbf{${esc(fmtQ(data.totalBalance))}}} & \\textbf{${data.transactions.length}} \\\\
\\bottomrule
\\end{tabular}

${aiSection}
${txSection}

\\end{document}`;
}

// ── Compilar LaTeX → PDF buffer ──
async function compileTex(texSource) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-report-'));
  const texFile = path.join(tmpDir, 'report.tex');
  const pdfFile = path.join(tmpDir, 'report.pdf');
  const logFile = path.join(tmpDir, 'report.log');

  try {
    fs.writeFileSync(texFile, texSource, 'utf8');
    const cmd = `xelatex -interaction=nonstopmode -output-directory="${tmpDir}" "${texFile}"`;
    execSync(cmd, { timeout: 90000, stdio: 'pipe' });
    execSync(cmd, { timeout: 90000, stdio: 'pipe' });

    if (!fs.existsSync(pdfFile)) {
      var log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-1000) : 'sin log';
      throw new Error('PDF no generado. LaTeX log:\n' + log);
    }
    const buf = fs.readFileSync(pdfFile);
    return buf;
  } catch(e) {
    // Incluir log en el error
    if (!e.message.includes('LaTeX log')) {
      var log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-1000) : '';
      if (log) e.message += '\nLog: ' + log;
    }
    throw e;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}
  }
}

// ── generatePDF: entrada pública ──
async function generatePDF(filter, aiAnalysis, userId, userRequest) {
  const data = await getReportData(filter, userId);
  var style = null;
  if (userRequest) {
    try { style = await generateAIStyle(data, userRequest); } catch(e) {}
  }
  var tex = buildTex(data, aiAnalysis, style);
  return await compileTex(tex);
}

// ── generateExcel: corregido con filtro por negocio ──
async function generateExcel(filter, userId) {
  const data = await getReportData(filter, userId);
  const wb   = new ExcelJS.Workbook();
  wb.creator = 'Centro de Mando';
  wb.created = new Date();

  const ACCENT  = 'FF6C5CE7';
  const GREEN   = 'FF00875A';
  const RED     = 'FFC0392B';
  const DARK    = 'FF1A1A2E';
  const LIGHT   = 'FFF4F4F8';

  const tabName = data.singleBusiness
    ? data.singleBusiness.slice(0, 28)
    : 'Resumen';

  // ── HOJA 1: Resumen ──
  const ws1 = wb.addWorksheet(tabName, { properties: { tabColor: { argb: ACCENT } } });

  // Título
  ws1.mergeCells('A1:F1');
  const titleCell = ws1.getCell('A1');
  titleCell.value = `CENTRO DE MANDO — ${data.period.toUpperCase()}`;
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws1.getRow(1).height = 36;

  ws1.mergeCells('A2:F2');
  const subCell = ws1.getCell('A2');
  subCell.value = `Período: ${data.dateFrom} al ${data.dateTo}`;
  subCell.font  = { size: 10, color: { argb: 'FF888899' } };
  subCell.alignment = { horizontal: 'center' };

  ws1.addRow([]);

  // Métricas resumen
  ws1.mergeCells('B4:C4'); ws1.getCell('B4').value = 'Total Ingresos';
  ws1.mergeCells('D4:E4'); ws1.getCell('D4').value = 'Total Gastos';
  ws1.mergeCells('F4:G4'); ws1.getCell('F4').value = 'Balance Neto';
  ['B4','D4','F4'].forEach(c => {
    ws1.getCell(c).font = { bold: true, size: 11 };
    ws1.getCell(c).alignment = { horizontal: 'center' };
  });

  ws1.mergeCells('B5:C5'); ws1.getCell('B5').value = parseFloat(data.totalIncome);
  ws1.mergeCells('D5:E5'); ws1.getCell('D5').value = parseFloat(data.totalExpense);
  ws1.mergeCells('F5:G5'); ws1.getCell('F5').value = parseFloat(data.totalBalance);
  ws1.getCell('B5').numFmt = '"Q"#,##0.00'; ws1.getCell('B5').font = { bold: true, size: 14, color: { argb: GREEN } };
  ws1.getCell('D5').numFmt = '"Q"#,##0.00'; ws1.getCell('D5').font = { bold: true, size: 14, color: { argb: RED } };
  ws1.getCell('F5').numFmt = '"Q"#,##0.00';
  ws1.getCell('F5').font = { bold: true, size: 14, color: { argb: parseFloat(data.totalBalance) >= 0 ? GREEN : RED } };
  [5].forEach(r => ws1.getRow(r).height = 26);

  ws1.addRow([]);
  ws1.addRow([]);

  // Tabla de negocios
  const hRow = ws1.addRow(['Negocio', 'Ingresos', 'Gastos', 'Balance', 'Movimientos', 'Estado']);
  hRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
  hRow.height = 22;
  hRow.eachCell(c => { c.alignment = { horizontal: 'center', vertical: 'middle' }; });

  data.businesses.forEach((b, i) => {
    const bal = parseFloat(b.balance);
    const row = ws1.addRow([
      b.name,
      parseFloat(b.income),
      parseFloat(b.expense),
      bal,
      parseInt(b.tx_count),
      bal >= 0 ? 'Positivo ✓' : 'Negativo ✗'
    ]);
    if (i % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    }
    row.getCell(2).numFmt = '"Q"#,##0.00';
    row.getCell(3).numFmt = '"Q"#,##0.00';
    row.getCell(4).numFmt = '"Q"#,##0.00';
    row.getCell(4).font = { bold: true, color: { argb: bal >= 0 ? GREEN : RED } };
    row.getCell(6).font = { color: { argb: bal >= 0 ? GREEN : RED } };
  });

  // Fila de totales
  ws1.addRow([]);
  const totRow = ws1.addRow(['TOTAL GENERAL', data.totalIncome, data.totalExpense, data.totalBalance, data.transactions.length, '']);
  totRow.font = { bold: true, size: 11 };
  totRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FF' } };
  totRow.getCell(2).numFmt = '"Q"#,##0.00';
  totRow.getCell(3).numFmt = '"Q"#,##0.00';
  totRow.getCell(4).numFmt = '"Q"#,##0.00';
  totRow.getCell(4).font = { bold: true, color: { argb: parseFloat(data.totalBalance) >= 0 ? GREEN : RED } };

  ws1.columns = [{ width: 26 }, { width: 16 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 14 }];

  // ── HOJA 2: Transacciones ──
  const txName = data.singleBusiness
    ? `${data.singleBusiness.slice(0,20)} - Movs`
    : 'Transacciones';

  const ws2 = wb.addWorksheet(txName, { properties: { tabColor: { argb: 'FF00875A' } } });

  ws2.mergeCells('A1:F1');
  const txTitle = ws2.getCell('A1');
  txTitle.value = `MOVIMIENTOS — ${data.period.toUpperCase()}`;
  txTitle.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  txTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00875A' } };
  txTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  ws2.getRow(1).height = 28;

  ws2.addRow([]);

  const txH = ws2.addRow(['Fecha', 'Negocio', 'Tipo', 'Descripción', 'Categoría', 'Monto']);
  txH.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  txH.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00875A' } };
  txH.height = 20;

  data.transactions.forEach((t, i) => {
    const isInc = t.type === 'income';
    const row = ws2.addRow([
      t.date ? String(t.date).slice(0, 10) : '',
      t.business,
      isInc ? 'Ingreso' : 'Gasto',
      t.description || '',
      t.category || '',
      isInc ? parseFloat(t.amount) : -parseFloat(t.amount)
    ]);
    if (i % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    row.getCell(6).numFmt = '"Q"#,##0.00';
    row.getCell(6).font = { color: { argb: isInc ? GREEN : RED } };
    row.getCell(3).font = { color: { argb: isInc ? GREEN : RED } };
  });

  ws2.columns = [{ width: 12 }, { width: 22 }, { width: 12 }, { width: 36 }, { width: 18 }, { width: 14 }];

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generatePDF, generateExcel, getReportData };
