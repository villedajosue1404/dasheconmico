// ============================================================
// REPORTS.JS — PDF con PDFKit + Excel con ExcelJS
// ============================================================

const { execSync }  = require('child_process');
const fs            = require('fs');
const os            = require('os');
const path          = require('path');
const ExcelJS       = require('exceljs');
const { pool }      = require('./db/schema');

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

// ── IA genera contenido completo del informe ──
async function generateAIContent(data, userRequest) {
  var key = process.env.GROQ_API_KEY;
  if (!key) return null;

  var bizTable = data.businesses.map(function(b) {
    return b.name + ' | Ingresos Q' + parseFloat(b.income).toFixed(2) +
           ' | Gastos Q' + parseFloat(b.expense).toFixed(2) +
           ' | Balance Q' + parseFloat(b.balance).toFixed(2) +
           ' | Movimientos ' + b.tx_count;
  }).join('\n');

  var topProduct = data.businesses.slice().sort(function(a, b) {
    return parseFloat(b.income) - parseFloat(a.income);
  })[0];

  var dataSummary =
    'DATOS FINANCIEROS DEL PERIODO (' + data.dateFrom + ' al ' + data.dateTo + '):\n' +
    'Ingresos totales: Q' + parseFloat(data.totalIncome).toFixed(2) + '\n' +
    'Gastos totales: Q' + parseFloat(data.totalExpense).toFixed(2) + '\n' +
    'Balance neto: Q' + parseFloat(data.totalBalance).toFixed(2) + '\n' +
    'Total negocios: ' + data.businesses.length + '\n' +
    'Total transacciones: ' + data.transactions.length + '\n' +
    'Producto con mayores ingresos: ' + (topProduct ? topProduct.name + ' (Q' + parseFloat(topProduct.income).toFixed(2) + ')' : 'N/A') + '\n\n' +
    'DETALLE POR NEGOCIO:\n' + bizTable;

  var systemPrompt =
    'Eres un asesor financiero experto. Generas contenido para un informe financiero profesional. ' +
    'Basado en los datos y la solicitud del usuario, responde UNICAMENTE con JSON, sin markdown, sin explicaciones:\n\n' +
    '{\n' +
    '  "title": "Título del informe",\n' +
    '  "subtitle": "Subtítulo descriptivo",\n' +
    '  "executiveSummary": "Resumen ejecutivo de 3-4 oraciones sobre el rendimiento del período",\n' +
    '  "revenueAnalysis": "Análisis detallado de ingresos - menciona el producto que mas vendio, compara rendimientos, da contexto",\n' +
    '  "costStructure": "Análisis de estructura de costos y gastos operativos",\n' +
    '  "marginsAndProjections": "Análisis de márgenes de ganancia y proyecciones futuras si aplica",\n' +
    '  "conclusions": "Conclusiones y recomendaciones accionables - responde DIRECTAMENTE a la solicitud del usuario"\n' +
    '}\n\n' +
    'IMPORTANTE: Usa números concretos de los datos. Las secciones deben tener 2-4 oraciones cada una. ' +
    'La seccion "conclusions" debe responder específicamente a lo que el usuario pide. ' +
    'Si pide recomendaciones para aumentar ganancias, da recomendaciones específicas. ' +
    'Si pide el producto que mas vendio, mencionalo claramente. ' +
    'Si pide proyecciones, haz proyecciones basadas en los datos.';

  var fetch = require('node-fetch');
  var groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Solicitud del usuario: "' + userRequest + '"\n\n' + dataSummary }
      ],
      max_tokens: 800,
      temperature: 0.3
    })
  });
  var groqData = await groqRes.json();
  var raw = groqData.choices && groqData.choices[0] ? groqData.choices[0].message.content : null;
  if (!raw) return null;
  try { return JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch(_) { return null; }
}

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
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/'/g, "\\textquotesingle{}")
    .replace(/"/g, "\\textquotedbl{}");
}

function fmtQ(n) {
  return 'Q\\,' + parseFloat(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '{,}');
}

// ── Generar LaTeX del informe ──
function buildLatex(data, content) {
  var reportTitle = esc(content && content.title ? content.title : 'Reporte Financiero y Operativo');
  var reportSub = esc(content && content.subtitle ? content.subtitle : 'Análisis de Ingresos, Costos y Márgenes de Ganancia');
  var execSummary = esc(content && content.executiveSummary || 'No hay datos suficientes para generar un resumen ejecutivo.');
  var revenueAnalysis = esc(content && content.revenueAnalysis || '');
  var costStructure = esc(content && content.costStructure || '');
  var marginsText = esc(content && content.marginsAndProjections || '');
  var conclusions = esc(content && content.conclusions || '');
  var period = esc(data.period);
  var dateFrom = esc(data.dateFrom);
  var dateTo = esc(data.dateTo);
  var today = new Date().toLocaleDateString('es-GT');
  var grossMargin = data.totalIncome > 0
    ? ((data.totalIncome - data.totalExpense) / data.totalIncome * 100).toFixed(1)
    : '0.0';

  var bizRows = data.businesses.map(function(b) {
    var bal = parseFloat(b.balance);
    return '        ' + esc(b.name) + ' & ' + fmtQ(b.income) + ' & ' + fmtQ(b.expense) + ' & ' +
      (bal >= 0 ? '' : '$\\color{red}$') + fmtQ(bal) + ' & ' + b.tx_count + ' \\\\';
  }).join('\n');

  return '\\documentclass[12pt, a4paper]{article}\n' +
    '\\usepackage[utf8]{inputenc}\n' +
    '\\usepackage[spanish]{babel}\n' +
    '\\usepackage{geometry}\n' +
    '\\usepackage{graphicx}\n' +
    '\\usepackage{booktabs}\n' +
    '\\usepackage{xcolor}\n' +
    '\\usepackage{fancyhdr}\n' +
    '\\usepackage{titlesec}\n' +
    '\\usepackage{tabularx}\n' +
    '\\usepackage{amsmath}\n' +
    '\\usepackage{longtable}\n' +
    '\\usepackage{enumitem}\n' +
    '\\geometry{top=2.5cm, bottom=2.5cm, left=2.5cm, right=2.5cm}\n' +
    '\\definecolor{primary}{RGB}{0, 51, 102}\n' +
    '\\definecolor{secondary}{RGB}{102, 102, 102}\n' +
    '\\pagestyle{fancy}\n' +
    '\\fancyhf{}\n' +
    '\\fancyhead[L]{\\textcolor{secondary}{\\small Reporte Financiero Mensual}}\n' +
    '\\fancyhead[R]{\\textcolor{secondary}{\\small ' + today + '}}\n' +
    '\\fancyfoot[C]{\\thepage}\n' +
    '\\titleformat{\\section}\n' +
    '  {\\normalfont\\Large\\bfseries\\color{primary}}{\\thesection}{1em}{}\n' +
    '\\titleformat{\\subsection}\n' +
    '  {\\normalfont\\large\\bfseries\\color{secondary}}{\\thesubsection}{1em}{}\n' +
    '\\begin{document}\n' +
    '\\begin{center}\n' +
    '    \\vspace*{2cm}\n' +
    '    {\\Huge \\textbf{\\textcolor{primary}{' + reportTitle + '}}}\\\\[0.5cm]\n' +
    '    {\\Large ' + reportSub + '}\\\\[1.5cm]\n' +
    '    {\\large \\textbf{Per\\u00edodo:} ' + period + '}\\\\[0.5cm]\n' +
    '    {\\large \\textbf{Preparado por:} Centro de Mando}\\\\[2cm]\n' +
    '\\end{center}\n' +
    '\\newpage\n' +
    '\\section{Resumen Ejecutivo}\n' +
    execSummary + '\n\n' +
    '\\vspace{0.5cm}\n' +
    '\\begin{center}\n' +
    '\\begin{tabular}{ccc}\n' +
    '    \\textbf{\\textcolor{primary}{Total Ingresos}} & \\textbf{\\textcolor{secondary}{Total Gastos}} & \\textbf{\\textcolor{primary}{Balance Neto}} \\\\[4pt]\n' +
    '    \\LARGE\\textcolor{primary}{' + fmtQ(data.totalIncome) + '} & \\LARGE\\textcolor{secondary}{' + fmtQ(data.totalExpense) + '} & \\LARGE\\textcolor{' + (data.totalBalance >= 0 ? 'primary' : 'red') + '}{' + fmtQ(data.totalBalance) + '} \\\\\n' +
    '\\end{tabular}\n' +
    '\\end{center}\n' +
    '\\vspace{0.5cm}\n' +
    '\\section{An\\\'{a}lisis de Ingresos}\n' +
    (revenueAnalysis ? revenueAnalysis + '\n\n' : '') +
    '\\begin{table}[h]\n' +
    '    \\centering\n' +
    '    \\renewcommand{\\arraystretch}{1.3}\n' +
    '    \\begin{tabular}{lrrrr}\n' +
    '        \\toprule\n' +
    '        \\textbf{Negocio} & \\textbf{Ingresos} & \\textbf{Gastos} & \\textbf{Balance} & \\textbf{Movs} \\\\\n' +
    '        \\midrule\n' +
    bizRows + '\n' +
    '        \\midrule\n' +
    '        \\textbf{TOTAL} & \\textbf{' + fmtQ(data.totalIncome) + '} & \\textbf{' + fmtQ(data.totalExpense) + '} & \\textbf{' + fmtQ(data.totalBalance) + '} & \\textbf{' + data.transactions.length + '} \\\\\n' +
    '        \\bottomrule\n' +
    '    \\end{tabular}\n' +
    '    \\caption{Desglose de ingresos por negocio.}\n' +
    '\\end{table}\n' +
    '\\section{Estructura de Costos}\n' +
    (costStructure ? costStructure + '\n\n' : '') +
    '\\section{M\\\'{a}rgenes de Ganancia y Rentabilidad}\n' +
    'El margen de ganancia bruta del per\\u00edodo es del \\textbf{' + grossMargin + '\\%}. ' +
    (marginsText ? marginsText : '') + '\n\n' +
    'La f\\\'{o}rmula utilizada para el c\\\'{a}lculo de la Utilidad Neta es:\n' +
    '\\begin{equation}\n' +
    '    \\text{Utilidad Neta} = \\text{Ingresos Totales} - (\\text{COGS} + \\text{OPEX} + \\text{Impuestos})\n' +
    '\\end{equation}\n' +
    '\\section{Conclusiones y Pr\\\'{o}ximos Pasos}\n' +
    (conclusions ? conclusions : '') + '\n' +
    '\\end{document}';
}

// ── Compilar LaTeX → PDF buffer ──
async function compileLatex(texSource) {
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-report-'));
  var texFile = path.join(tmpDir, 'report.tex');
  var pdfFile = path.join(tmpDir, 'report.pdf');
  try {
    fs.writeFileSync(texFile, texSource, 'utf8');
    var cmd = 'pdflatex -interaction=nonstopmode -output-directory="' + tmpDir + '" "' + texFile + '"';
    execSync(cmd, { timeout: 30000, stdio: 'pipe' });
    execSync(cmd, { timeout: 30000, stdio: 'pipe' });
    if (!fs.existsSync(pdfFile)) throw new Error('PDF no generado');
    return fs.readFileSync(pdfFile);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {}
  }
}
function buildPDF(data, content) {
  var PDFDocument = require('pdfkit');
  var doc = new PDFDocument({ size: 'A4', margin: 60 });
  var buffers = [];
  doc.on('data', function(b) { buffers.push(b); });

  var primary = '#003366';
  var secondary = '#666666';
  var black = '#222222';
  var lightGray = '#F5F5F5';

  function Q(n) { return 'Q' + parseFloat(n || 0).toFixed(2); }

  function sectionTitle(text) {
    if (doc.y > 680) { addPageFooter(); doc.addPage(); }
    doc.y += 6;
    doc.fontSize(16).font('Helvetica-Bold').fillColor(primary).text(text, 60, doc.y);
    doc.moveTo(60, doc.y + 4).lineTo(doc.page.width - 60, doc.y + 4).lineWidth(1).stroke(primary);
    doc.y += 16;
  }

  function bodyText(text) {
    if (!text) return;
    doc.fontSize(10).font('Helvetica').fillColor(black);
    doc.text(text, 60, doc.y, { width: doc.page.width - 120, align: 'justify', lineGap: 4 });
    doc.y += 6;
  }

  function metricBox(label, value, x, y, color) {
    doc.roundedRect(x, y, 140, 50, 4).fill(lightGray);
    doc.fillColor(secondary).fontSize(8).font('Helvetica').text(label, x + 10, y + 6, { width: 120, align: 'center' });
    doc.fillColor(color).fontSize(16).font('Helvetica-Bold').text(value, x + 10, y + 22, { width: 120, align: 'center' });
  }

  function drawTable(rows) {
    var tableX = 60;
    var colW = [80, 100, 80, 80, 60];
    var tableW = doc.page.width - 120;
    var rowH = 20;

    if (doc.y + 40 + (rows.length + 2) * rowH > doc.page.height - 60) {
      addPageFooter(); doc.addPage();
    }

    // Header
    doc.rect(tableX, doc.y, tableW, 22).fill(primary);
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
    var xOff = tableX;
    ['Negocio', 'Ingresos', 'Gastos', 'Balance', 'Movs'].forEach(function(h, i) {
      doc.text(h, xOff + 6, doc.y + 5, { width: colW[i] - 12, align: i === 0 ? 'left' : 'right' });
      xOff += colW[i];
    });
    doc.y += 22;

    rows.forEach(function(row, i) {
      if (doc.y + rowH > doc.page.height - 60) { addPageFooter(); doc.addPage(); }
      if (i % 2 === 0) doc.rect(tableX, doc.y, tableW, rowH).fill(lightGray);
      xOff = tableX;
      doc.fontSize(9).font('Helvetica');
      row.forEach(function(cell, j) {
        var isBal = j === 3;
        doc.fillColor(isBal ? (parseFloat(cell) >= 0 ? primary : '#C0392B') : black);
        doc.font(isBal ? 'Helvetica-Bold' : 'Helvetica');
        doc.text(isBal ? Q(cell) : String(cell), xOff + 6, doc.y + 4, { width: colW[j] - 12, align: j === 0 ? 'left' : 'right' });
        xOff += colW[j];
      });
      doc.y += rowH;
    });

    // Total row
    if (doc.y + rowH > doc.page.height - 60) { addPageFooter(); doc.addPage(); }
    doc.rect(tableX, doc.y, tableW, rowH).fill(lightGray);
    xOff = tableX;
    doc.fontSize(9).font('Helvetica-Bold');
    [['TOTAL', primary], [Q(data.totalIncome), primary], [Q(data.totalExpense), primary], [Q(data.totalBalance), data.totalBalance >= 0 ? primary : '#C0392B']].forEach(function(pair, j) {
      doc.fillColor(pair[1]);
      doc.text(pair[0], xOff + 6, doc.y + 4, { width: colW[j] - 12, align: j === 0 ? 'left' : 'right' });
      xOff += colW[j];
    });
    doc.y += rowH + 10;
  }

  function addPageFooter() {
    var y = doc.page.height - 40;
    doc.fontSize(8).font('Helvetica').fillColor(secondary);
    doc.text('Reporte Financiero Mensual', 50, y, { align: 'left', width: 200 });
    doc.text('Pág. ' + doc.bufferedPageRange().count, doc.page.width - 80, y, { align: 'right', width: 30 });
    doc.moveTo(50, y - 6).lineTo(doc.page.width - 50, y - 6).lineWidth(0.5).stroke(secondary);
  }

  // ── PORTADA ──
  doc.rect(0, 0, doc.page.width, 160).fill(primary);

  doc.fillColor('#FFFFFF').fontSize(30).font('Helvetica-Bold')
     .text('Reporte Financiero y Operativo', 60, 40, { align: 'center', width: doc.page.width - 120 });

  doc.fillColor('#CCCCCC').fontSize(14).font('Helvetica')
     .text(content && content.subtitle ? content.subtitle : 'Análisis de Ingresos, Costos y Márgenes de Ganancia',
           60, 85, { align: 'center', width: doc.page.width - 120 });

  doc.y = 130;
  doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica')
     .text('Período: ' + data.period, 60, doc.y, { align: 'center', width: doc.page.width - 120 });
  doc.y += 18;
  doc.fillColor('#CCCCCC').fontSize(10).font('Helvetica')
     .text('Preparado por: Centro de Mando · ' + new Date().toLocaleDateString('es-GT'),
           60, doc.y, { align: 'center', width: doc.page.width - 120 });

  doc.y = doc.page.height - 60;
  doc.fillColor('#999999').fontSize(8).font('Helvetica')
     .text('Documento generado automáticamente · ' + data.dateFrom + ' al ' + data.dateTo,
           60, doc.y, { align: 'center', width: doc.page.width - 120 });

  // ── RESUMEN EJECUTIVO ──
  addPageFooter();
  doc.addPage();
  doc.y = 60;

  sectionTitle('Resumen Ejecutivo');
  bodyText(content && content.executiveSummary);

  var boxY = doc.y + 6;
  var boxW = (doc.page.width - 160) / 3;
  metricBox('Total Ingresos', Q(data.totalIncome), 60, boxY, primary);
  metricBox('Total Gastos', Q(data.totalExpense), 60 + boxW + 20, boxY, secondary);
  var balColor = data.totalBalance >= 0 ? primary : '#C0392B';
  metricBox('Balance Neto', Q(data.totalBalance), 60 + 2 * (boxW + 20), boxY, balColor);
  doc.y = boxY + 70;

  // ── ANÁLISIS DE INGRESOS ──
  sectionTitle('Análisis de Ingresos');
  bodyText(content && content.revenueAnalysis);

  drawTable(data.businesses.map(function(b) {
    return [b.name, parseFloat(b.income), parseFloat(b.expense), parseFloat(b.balance), parseInt(b.tx_count)];
  }));

  // ── ESTRUCTURA DE COSTOS ──  
  sectionTitle('Estructura de Costos');
  bodyText(content && content.costStructure);

  // ── MÁRGENES Y PROYECCIONES ──
  sectionTitle('Márgenes de Ganancia y Rentabilidad');
  var grossMargin = data.totalIncome > 0
    ? ((data.totalIncome - data.totalExpense) / data.totalIncome * 100).toFixed(1)
    : '0.0';
  doc.fontSize(10).font('Helvetica').fillColor(black);
  doc.text('Margen de ganancia bruta del período: ', 60, doc.y, { continued: true });
  doc.font('Helvetica-Bold').fillColor(parseFloat(grossMargin) >= 30 ? primary : '#C0392B')
     .text(grossMargin + '%', { continued: true });
  doc.font('Helvetica').fillColor(black).text('.');
  doc.y += 16;
  bodyText(content && content.marginsAndProjections);

  // ── CONCLUSIONES ──
  sectionTitle('Conclusiones y Próximos Pasos');
  bodyText(content && content.conclusions);

  addPageFooter();
  doc.end();
  return new Promise(function(resolve) {
    doc.on('end', function() {
      resolve(Buffer.concat(buffers));
    });
  });
}

// ── generatePDF: intenta LaTeX, fallback PDFKit ──
async function generatePDF(filter, aiAnalysis, userId, userRequest) {
  const data = await getReportData(filter, userId);
  var content = null;
  if (userRequest) {
    try { content = await generateAIContent(data, userRequest); } catch(_) {}
  }
  var tex = buildLatex(data, content);
  try {
    return await compileLatex(tex);
  } catch(e) {
    console.error('LaTeX error:', e.message);
    return await buildPDF(data, content);
  }
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
