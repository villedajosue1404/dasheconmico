// ============================================================
// REPORTS.JS — Generación de PDF y Excel profesionales
// ============================================================

const PDFDocument = require('pdfkit');
const ExcelJS     = require('exceljs');
const { pool }    = require('./db/schema');
const { generateReport } = require('./ai');

// ── Colores y estilos ──
const COLORS = {
  primary:   '#1a1a2e',
  accent:    '#6c5ce7',
  green:     '#00b894',
  red:       '#e17055',
  gray:      '#636e72',
  lightGray: '#dfe6e9',
  white:     '#ffffff'
};

// ── Obtener datos para el informe ──
async function getReportData(filter) {
  const f = (filter || '').toLowerCase();

  // Determinar rango de fechas
  const now   = new Date();
  let dateFrom, dateTo, periodLabel;

  if (/enero|january/.test(f))   { dateFrom='2026-01-01'; dateTo='2026-01-31'; periodLabel='Enero 2026'; }
  else if (/febrero|february/.test(f)) { dateFrom='2026-02-01'; dateTo='2026-02-28'; periodLabel='Febrero 2026'; }
  else if (/marzo|march/.test(f))      { dateFrom='2026-03-01'; dateTo='2026-03-31'; periodLabel='Marzo 2026'; }
  else if (/abril|april/.test(f))      { dateFrom='2026-04-01'; dateTo='2026-04-30'; periodLabel='Abril 2026'; }
  else if (/mayo|may/.test(f))         { dateFrom='2026-05-01'; dateTo='2026-05-31'; periodLabel='Mayo 2026'; }
  else if (/junio|june/.test(f))       { dateFrom='2026-06-01'; dateTo='2026-06-30'; periodLabel='Junio 2026'; }
  else if (/semana|week/.test(f)) {
    const monday = new Date(now);
    monday.setDate(now.getDate() - now.getDay() + 1);
    dateFrom = monday.toISOString().split('T')[0];
    dateTo   = now.toISOString().split('T')[0];
    periodLabel = 'Esta semana';
  } else if (/ayer|yesterday/.test(f)) {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    dateFrom = dateTo = yesterday.toISOString().split('T')[0];
    periodLabel = 'Ayer';
  } else if (/hoy|today/.test(f)) {
    dateFrom = dateTo = now.toISOString().split('T')[0];
    periodLabel = 'Hoy';
  } else {
    // Por defecto: mes actual
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    dateFrom    = year + '-' + month + '-01';
    dateTo      = now.toISOString().split('T')[0];
    periodLabel = 'Mes actual';
  }

  // Negocios con totales
  const bizQ = await pool.query(
    'SELECT b.id, b.name, b.color,' +
    'COALESCE(SUM(CASE WHEN t.type=\'income\' AND (t.date BETWEEN $1 AND $2) THEN t.amount ELSE 0 END),0) as income,' +
    'COALESCE(SUM(CASE WHEN t.type=\'expense\' AND (t.date BETWEEN $1 AND $2) THEN t.amount ELSE 0 END),0) as expense,' +
    'COALESCE(SUM(CASE WHEN t.type=\'income\' AND (t.date BETWEEN $1 AND $2) THEN t.amount WHEN t.type=\'expense\' AND (t.date BETWEEN $1 AND $2) THEN -t.amount ELSE 0 END),0) as balance,' +
    'COUNT(CASE WHEN t.date BETWEEN $1 AND $2 THEN 1 END) as tx_count ' +
    'FROM businesses b LEFT JOIN transactions t ON t.business_id=b.id ' +
    'GROUP BY b.id,b.name,b.color ORDER BY balance DESC',
    [dateFrom, dateTo]
  );

  // Transacciones del período
  const txQ = await pool.query(
    'SELECT t.date,t.type,t.amount,t.description,t.category,b.name as business ' +
    'FROM transactions t JOIN businesses b ON b.id=t.business_id ' +
    'WHERE t.date BETWEEN $1 AND $2 ' +
    'ORDER BY t.date DESC, t.created_at DESC',
    [dateFrom, dateTo]
  );

  return {
    period: periodLabel,
    dateFrom: dateFrom,
    dateTo: dateTo,
    businesses: bizQ.rows,
    transactions: txQ.rows,
    totalIncome:  bizQ.rows.reduce(function(s,b) { return s + parseFloat(b.income); }, 0),
    totalExpense: bizQ.rows.reduce(function(s,b) { return s + parseFloat(b.expense); }, 0),
    totalBalance: bizQ.rows.reduce(function(s,b) { return s + parseFloat(b.balance); }, 0)
  };
}

// ── Generar PDF profesional ──
async function generatePDF(filter, aiAnalysis) {
  const data = await getReportData(filter);
  const doc  = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks = [];

  doc.on('data', function(chunk) { chunks.push(chunk); });

  return new Promise(function(resolve, reject) {
    doc.on('end', function() { resolve(Buffer.concat(chunks)); });
    doc.on('error', reject);

    // ── PORTADA ──
    // Fondo oscuro en header
    doc.rect(0, 0, doc.page.width, 140).fill(COLORS.primary);

    // Logo/título
    doc.fontSize(28).fillColor(COLORS.white).font('Helvetica-Bold')
       .text('CENTRO DE MANDO', 50, 45, { align: 'center' });
    doc.fontSize(13).fillColor('#a29bfe').font('Helvetica')
       .text('Informe Financiero — ' + data.period, 50, 82, { align: 'center' });
    doc.fontSize(10).fillColor('#b2bec3')
       .text('Generado el ' + new Date().toLocaleDateString('es-GT') + ' · ' + data.dateFrom + ' al ' + data.dateTo,
             50, 108, { align: 'center' });

    // Línea decorativa
    doc.moveDown(4);
    doc.moveTo(50, 155).lineTo(doc.page.width - 50, 155).strokeColor(COLORS.accent).lineWidth(2).stroke();

    // ── RESUMEN EJECUTIVO ──
    doc.moveDown(1);
    doc.fontSize(14).fillColor(COLORS.primary).font('Helvetica-Bold')
       .text('RESUMEN EJECUTIVO', 50, 175);
    doc.moveDown(0.5);

    // Tarjetas de métricas
    const cardY   = 205;
    const cardW   = 155;
    const cardGap = 15;

    function drawCard(x, y, w, label, value, color) {
      doc.roundedRect(x, y, w, 65, 6).fill(color + '15').stroke(color + '60');
      doc.fontSize(9).fillColor(COLORS.gray).font('Helvetica')
         .text(label.toUpperCase(), x + 10, y + 12, { width: w - 20 });
      doc.fontSize(18).fillColor(color).font('Helvetica-Bold')
         .text('Q ' + parseFloat(value).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2}),
               x + 10, y + 28, { width: w - 20 });
    }

    drawCard(50,              cardY, cardW, 'Total Ingresos',  data.totalIncome,  COLORS.green);
    drawCard(50 + cardW + cardGap, cardY, cardW, 'Total Gastos', data.totalExpense, COLORS.red);
    drawCard(50 + (cardW + cardGap) * 2, cardY, cardW, 'Balance Neto', data.totalBalance,
             data.totalBalance >= 0 ? COLORS.accent : COLORS.red);

    // ── POR NEGOCIO ──
    doc.moveDown(1);
    const bizY = cardY + 90;
    doc.fontSize(14).fillColor(COLORS.primary).font('Helvetica-Bold')
       .text('DETALLE POR NEGOCIO', 50, bizY);

    // Tabla
    const tableY   = bizY + 25;
    const colWidths = [180, 100, 100, 100];
    const headers   = ['Negocio', 'Ingresos', 'Gastos', 'Balance'];
    const tableW    = colWidths.reduce(function(a,b){return a+b;},0);

    // Header de tabla
    doc.rect(50, tableY, tableW, 24).fill(COLORS.primary);
    let cx = 50;
    headers.forEach(function(h, i) {
      doc.fontSize(9).fillColor(COLORS.white).font('Helvetica-Bold')
         .text(h, cx + 6, tableY + 8, { width: colWidths[i] - 12, align: i > 0 ? 'right' : 'left' });
      cx += colWidths[i];
    });

    // Filas
    data.businesses.forEach(function(b, idx) {
      const rowY = tableY + 24 + idx * 28;
      if (idx % 2 === 0) doc.rect(50, rowY, tableW, 28).fill('#f8f9fa');
      doc.rect(50, rowY, tableW, 28).stroke(COLORS.lightGray);

      // Indicador de color del negocio
      doc.rect(50, rowY, 4, 28).fill(b.color || COLORS.accent);

      const bal = parseFloat(b.balance);
      cx = 50;
      const vals = [
        b.name,
        'Q ' + parseFloat(b.income).toFixed(2),
        'Q ' + parseFloat(b.expense).toFixed(2),
        'Q ' + bal.toFixed(2)
      ];
      vals.forEach(function(v, i) {
        const color = i === 3 ? (bal >= 0 ? COLORS.green : COLORS.red) : COLORS.primary;
        doc.fontSize(9).fillColor(color).font(i === 3 ? 'Helvetica-Bold' : 'Helvetica')
           .text(v, cx + 8, rowY + 10, { width: colWidths[i] - 16, align: i > 0 ? 'right' : 'left' });
        cx += colWidths[i];
      });
    });

    // ── ANÁLISIS IA ──
    const analysisY = tableY + 24 + data.businesses.length * 28 + 20;
    if (aiAnalysis && doc.y < 650) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 60).fill(COLORS.primary);
      doc.fontSize(16).fillColor(COLORS.white).font('Helvetica-Bold')
         .text('ANÁLISIS INTELIGENTE', 50, 22, { align: 'center' });

      doc.moveDown(1);
      doc.roundedRect(50, 80, doc.page.width - 100, 20).fill(COLORS.accent + '20');
      doc.fontSize(9).fillColor(COLORS.gray).font('Helvetica-Bold')
         .text('GENERADO POR IA — CENTRO DE MANDO', 50, 86, { align: 'center' });

      doc.fontSize(11).fillColor(COLORS.primary).font('Helvetica')
         .text(aiAnalysis, 50, 115, { width: doc.page.width - 100, lineGap: 4 });
    }

    // ── TRANSACCIONES DETALLADAS ──
    if (data.transactions.length > 0) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 60).fill(COLORS.primary);
      doc.fontSize(16).fillColor(COLORS.white).font('Helvetica-Bold')
         .text('TRANSACCIONES DETALLADAS', 50, 22, { align: 'center' });

      const txCols = [70, 60, 90, 220, 100];
      const txHeaders = ['Fecha', 'Tipo', 'Negocio', 'Descripción', 'Monto'];
      const txTableW  = txCols.reduce(function(a,b){return a+b;},0);

      doc.rect(50, 80, txTableW, 22).fill(COLORS.primary);
      cx = 50;
      txHeaders.forEach(function(h, i) {
        doc.fontSize(8).fillColor(COLORS.white).font('Helvetica-Bold')
           .text(h, cx + 4, 87, { width: txCols[i] - 8, align: i === 4 ? 'right' : 'left' });
        cx += txCols[i];
      });

      data.transactions.slice(0, 40).forEach(function(t, idx) {
        const rowY = 102 + idx * 22;
        if (rowY > 750) return;
        if (idx % 2 === 0) doc.rect(50, rowY, txTableW, 22).fill('#f8f9fa');
        doc.rect(50, rowY, txTableW, 22).stroke(COLORS.lightGray);

        const isIncome = t.type === 'income';
        cx = 50;
        const txVals = [
          t.date,
          isIncome ? 'Ingreso' : 'Gasto',
          t.business,
          t.description || t.category || '',
          (isIncome ? '+' : '-') + 'Q ' + parseFloat(t.amount).toFixed(2)
        ];
        txVals.forEach(function(v, i) {
          const color = i === 4 ? (isIncome ? COLORS.green : COLORS.red) : COLORS.primary;
          doc.fontSize(8).fillColor(color).font(i === 4 ? 'Helvetica-Bold' : 'Helvetica')
             .text(String(v).slice(0, 35), cx + 4, rowY + 7,
                   { width: txCols[i] - 8, align: i === 4 ? 'right' : 'left' });
          cx += txCols[i];
        });
      });
    }

    // ── PIE DE PÁGINA ──
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(8).fillColor(COLORS.gray)
         .text('Centro de Mando · Informe generado automaticamente · Pagina ' + (i+1) + ' de ' + range.count,
               50, doc.page.height - 30, { align: 'center', width: doc.page.width - 100 });
    }

    doc.end();
  });
}

// ── Generar Excel profesional ──
async function generateExcel(filter) {
  const data = await getReportData(filter);
  const wb   = new ExcelJS.Workbook();
  wb.creator  = 'Centro de Mando';
  wb.created  = new Date();

  // ── HOJA 1: Resumen ──
  const ws1 = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: '6C5CE7' } } });

  // Título
  ws1.mergeCells('A1:F1');
  ws1.getCell('A1').value = 'CENTRO DE MANDO — ' + data.period.toUpperCase();
  ws1.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  ws1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
  ws1.getCell('A1').alignment = { horizontal: 'center' };
  ws1.getRow(1).height = 35;

  // Período
  ws1.mergeCells('A2:F2');
  ws1.getCell('A2').value = 'Período: ' + data.dateFrom + ' al ' + data.dateTo;
  ws1.getCell('A2').font = { size: 10, color: { argb: 'FF636E72' } };
  ws1.getCell('A2').alignment = { horizontal: 'center' };

  ws1.addRow([]);

  // Headers de tabla
  const headerRow = ws1.addRow(['Negocio', 'Ingresos (Q)', 'Gastos (Q)', 'Balance (Q)', 'Transacciones', 'Estado']);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6C5CE7' } };
  headerRow.height = 22;
  headerRow.alignment = { horizontal: 'center' };

  // Datos por negocio
  data.businesses.forEach(function(b) {
    const bal = parseFloat(b.balance);
    const row = ws1.addRow([
      b.name,
      parseFloat(b.income),
      parseFloat(b.expense),
      bal,
      parseInt(b.tx_count),
      bal >= 0 ? 'Positivo' : 'Negativo'
    ]);
    row.getCell(2).numFmt = '"Q"#,##0.00';
    row.getCell(3).numFmt = '"Q"#,##0.00';
    row.getCell(4).numFmt = '"Q"#,##0.00';
    row.getCell(4).font = { bold: true, color: { argb: bal >= 0 ? 'FF00B894' : 'FFE17055' } };
    row.getCell(6).font = { color: { argb: bal >= 0 ? 'FF00B894' : 'FFE17055' } };
  });

  // Totales
  ws1.addRow([]);
  const totalRow = ws1.addRow(['TOTAL', data.totalIncome, data.totalExpense, data.totalBalance, '', '']);
  totalRow.font = { bold: true };
  totalRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
  totalRow.getCell(2).numFmt = '"Q"#,##0.00';
  totalRow.getCell(3).numFmt = '"Q"#,##0.00';
  totalRow.getCell(4).numFmt = '"Q"#,##0.00';
  totalRow.getCell(4).font = { bold: true, color: { argb: data.totalBalance >= 0 ? 'FF00B894' : 'FFE17055' } };

  // Anchos de columna
  ws1.columns = [
    { width: 25 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 12 }
  ];

  // ── HOJA 2: Transacciones ──
  const ws2 = wb.addWorksheet('Transacciones', { properties: { tabColor: { argb: '00B894' } } });

  const txHeader = ws2.addRow(['Fecha', 'Negocio', 'Tipo', 'Descripción', 'Categoría', 'Monto (Q)']);
  txHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  txHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00B894' } };
  txHeader.height = 22;

  data.transactions.forEach(function(t) {
    const isIncome = t.type === 'income';
    const row = ws2.addRow([
      t.date,
      t.business,
      isIncome ? 'Ingreso' : 'Gasto',
      t.description || '',
      t.category || '',
      isIncome ? parseFloat(t.amount) : -parseFloat(t.amount)
    ]);
    row.getCell(6).numFmt = '"Q"#,##0.00';
    row.getCell(6).font = { color: { argb: isIncome ? 'FF00B894' : 'FFE17055' } };
    row.getCell(3).font = { color: { argb: isIncome ? 'FF00B894' : 'FFE17055' } };
  });

  ws2.columns = [
    { width: 12 }, { width: 22 }, { width: 12 }, { width: 35 }, { width: 18 }, { width: 14 }
  ];

  // Devolver como buffer
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generatePDF, generateExcel, getReportData };
