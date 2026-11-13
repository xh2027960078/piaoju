/* 金蝶《员工报销单》模板填充：直接改写原始 xlsx 的 sheet XML，完整保留模板格式与公式 */

const sheetNamePreferred = /报销/;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* 模板字段 → 列代码（对应第 3 行字段编码） */
export const FIELDS = [
  { key: 'costItem', code: 'FExpID#Name', label: '费用项目', type: 'text', pick: 'costItems' },
  { key: 'startDate', code: 'FTravelStartDate', label: '开始日期', type: 'date' },
  { key: 'endDate', code: 'FTravelEndDate', label: '结束日期', type: 'date' },
  { key: 'from', code: 'FTravelStartSite', label: '出发地', type: 'text' },
  { key: 'to', code: 'FTravelEndSite', label: '目的地', type: 'text' },
  { key: 'travelType', code: 'FTravelType#Name', label: '差旅费类型', type: 'text', pick: 'travelTypes' },
  { key: 'amount', code: 'FTravelAmount', label: '差旅费金额', type: 'number' },
  { key: 'invoiceType', code: 'FInvoiceType', label: '发票类型', type: 'text', pick: 'invoiceTypes' },
  { key: 'dept', code: 'FExpenseDeptEntryID#Name', label: '费用承担部门', type: 'text', pick: 'departments' },
  { key: 'project', code: 'F_DH_Project#Name', label: '项目中心', type: 'text', pick: 'projects' },
  { key: 'remark', code: 'FRemark', label: '备注', type: 'text' },
];

const unxml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

const xmlEsc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function colToNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function numToCol(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function dateToSerial(iso) {
  if (!iso) return null;
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const inner = m[1] || '';
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(inner))) text += t[1];
    out.push(unxml(text));
  }
  return out;
}

function parseCell(raw) {
  const selfClose = /\/>$/.test(raw);
  const attrStr = (raw.match(/^<c\b([^>]*?)\/?>/) || [])[1] || '';
  const ref = (attrStr.match(/\br="([A-Z]+)(\d+)"/) || []);
  const s = (attrStr.match(/\bs="(\d+)"/) || [])[1] || null;
  const t = (attrStr.match(/\bt="(\w+)"/) || [])[1] || null;
  let inner = '';
  if (!selfClose) {
    const idx = raw.indexOf('>');
    inner = raw.slice(idx + 1, raw.lastIndexOf('</c>'));
  }
  return {
    col: ref[1] ? colToNum(ref[1]) : 0,
    colLetters: ref[1] || '',
    row: ref[2] ? +ref[2] : 0,
    s, t, inner, selfClose, raw,
  };
}

function cellText(cell, sst) {
  if (cell.t === 'inlineStr') {
    let text = '';
    const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = re.exec(cell.inner))) text += m[1];
    return unxml(text);
  }
  if (cell.t === 's') {
    const v = (cell.inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    return v != null ? (sst[+v] || '') : '';
  }
  const v = (cell.inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
  const f = (cell.inner.match(/<f\b[^>]*>([\s\S]*?)<\/f>/) || [])[1];
  if (v != null) return unxml(v);
  if (f != null) return unxml(f);
  return '';
}

function parseRows(sheetXml) {
  const rows = [];
  const re = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
  let m;
  while ((m = re.exec(sheetXml))) {
    const attrs = m[1] || '';
    const rn = (attrs.match(/\br="(\d+)"/) || [])[1];
    const inner = m[3] || '';
    const cells = [];
    const cRe = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
    let c;
    while ((c = cRe.exec(inner))) cells.push(parseCell(c[0]));
    rows.push({ rowNum: rn ? +rn : 0, attrs, inner, cells, raw: m[0] });
  }
  return rows;
}

function cellXml({ col, row, style, value, type }) {
  const ref = numToCol(col) + row;
  const sAttr = style != null ? ` s="${style}"` : '';
  if (value == null || value === '') return `<c r="${ref}"${sAttr}/>`;
  if (type === 'number') return `<c r="${ref}"${sAttr}><v>${value}</v></c>`;
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
}

/** 保留原有 <f> 公式，只替换/补写缓存值 */
function setCellRaw(raw, value, isString) {
  const attrStr = (raw.match(/^<c\b([^>]*?)(?:\/>|>)/) || [])[1] || '';
  const ref = (attrStr.match(/\br="([A-Z]+\d+)"/) || [])[1];
  if (!ref) return raw;
  const s = (attrStr.match(/\bs="(\d+)"/) || [])[1];
  const sAttr = s != null ? ` s="${s}"` : '';
  const f = (raw.match(/<f\b[^>]*>[\s\S]*?<\/f>/) || [''])[0];
  if (isString) {
    if (f) return `<c r="${ref}"${sAttr} t="str">${f}<v>${xmlEsc(value)}</v></c>`;
    return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
  }
  return `<c r="${ref}"${sAttr}>${f}<v>${value}</v></c>`;
}

/**
 * 读取模板结构，返回 { sheetName, sheetPath, headerRow, dataStartRow, columns }
 */
export async function inspectTemplate(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rels = {};
  {
    const re = /<Relationship\b([^>]*)\/>/g;
    let m;
    while ((m = re.exec(relsXml))) {
      const id = (m[1].match(/Id="([^"]+)"/) || [])[1];
      const target = (m[1].match(/Target="([^"]+)"/) || [])[1];
      if (id && target) rels[id] = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    }
  }
  const sheets = [];
  {
    const re = /<sheet\b([^>]*)\/>/g;
    let m;
    while ((m = re.exec(wbXml))) {
      const name = (m[1].match(/name="([^"]*)"/) || [])[1];
      const rid = (m[1].match(/r:id="([^"]+)"/) || [])[1];
      if (name && rid) sheets.push({ name: unxml(name), path: 'xl/' + rels[rid] });
    }
  }
  const sstXml = zip.file('xl/sharedStrings.xml') ? await zip.file('xl/sharedStrings.xml').async('string') : '';
  const sst = parseSharedStrings(sstXml);

  let picked = null;
  const ordered = [...sheets.filter((s) => sheetNamePreferred.test(s.name)), ...sheets.filter((s) => !sheetNamePreferred.test(s.name))];
  for (const sh of ordered) {
    const f = zip.file(sh.path);
    if (!f) continue;
    const xml = await f.async('string');
    const rows = parseRows(xml);
    for (const r of rows) {
      if (r.cells.some((c) => cellText(c, sst).trim() === 'FExpID')) {
        picked = { ...sh, xml, rows };
        break;
      }
    }
    if (picked) break;
  }
  if (!picked) throw new Error('未在模板中找到「FExpID」字段行，请确认这是金蝶员工报销单模板');

  const headerRow = picked.rows.find((r) => r.cells.some((c) => cellText(c, sst).trim() === 'FExpID'));
  const columns = {};
  for (const c of headerRow.cells) {
    const txt = cellText(c, sst).trim();
    if (txt) columns[txt] = { col: c.col, letters: c.colLetters };
  }
  const dataStartRow = headerRow.rowNum + 2;
  return {
    zip, sst, sheetName: picked.name, sheetPath: picked.path,
    headerRow: headerRow.rowNum, dataStartRow, columns,
    rows: picked.rows, xml: picked.xml,
  };
}

/**
 * 用数据行填充模板并返回 xlsx Blob
 * @param {ArrayBuffer} buffer 模板文件
 * @param {Array<object>} dataRows 每行字段（key 见 FIELDS）
 * @param {object} opts { traveler }
 */
export async function fillTemplate(buffer, dataRows, opts = {}) {
  const info = await inspectTemplate(buffer);
  const { zip, sst, sheetPath, rows, xml } = info;

  const colMap = {};
  for (const f of FIELDS) {
    const c = info.columns[f.code];
    if (c) colMap[f.key] = { col: c.col, field: f };
  }
  if (!Object.keys(colMap).length) throw new Error('模板字段不匹配，无法填充');

  // 公式列：写入缓存值，保证不重算的读取端也能看到编码/金额
  const fcol = (code) => (info.columns[code] ? info.columns[code].col : null);
  const formulaCols = {
    costCode: fcol('FExpID'),
    travelCode: fcol('FTravelType'),
    deptCode: fcol('FExpenseDeptEntryID'),
    projectCode: fcol('F_DH_Project'),
    applyAmt: fcol('FExpenseAmount'),
    submitAmt: fcol('FTaxSubmitAmt'),
  };
  const headerCols = {
    date: fcol('FDate'),
    orgCode: fcol('FOrgID'),
    deptCode: fcol('FRequestDeptID'),
    empCode: fcol('FProposerID'),
    empName: fcol('FProposerID#Name'),
    deptName: fcol('FRequestDeptID#Name'),
    orgName: fcol('FOrgID#Name'),
    causa: fcol('FCausa'),
  };

  const start = info.dataStartRow;
  const sample = rows.find((r) => r.rowNum === start);
  if (!sample) throw new Error('模板缺少数据起始行');

  const styleOf = {};
  for (const c of sample.cells) styleOf[c.col] = c.s;
  for (const f of FIELDS) {
    const col = colMap[f.key] && colMap[f.key].col;
    if (col && styleOf[col] == null) {
      const any = sample.cells[0];
      styleOf[col] = any ? any.s : null;
    }
  }

  const rowByNum = new Map(rows.map((r) => [r.rowNum, r]));
  const patches = new Map(); // rowNum -> new inner xml
  const appended = [];

  dataRows.forEach((data, i) => {
    const rowNum = start + i;
    const existing = rowByNum.get(rowNum);
    let cells;
    if (existing) {
      cells = existing.cells.slice();
    } else {
      // 超出模板预留行：克隆样本行并平移公式引用
      cells = sample.cells.map((c) => {
        const shift = rowNum - start;
        const raw = c.raw.replace(new RegExp(`(<f\\b[^>]*>[\\s\\S]*?)(\\b[A-Z]{1,3})${start}(?![0-9])`, 'g'),
          (m0, pre, colRef) => `${pre}${colRef}${start + shift}`);
        return parseCell(raw.replace(new RegExp(`r="[A-Z]+${start}"`), `r="${c.colLetters}${rowNum}"`));
      });
    }

    const used = new Set(cells.map((c) => c.col));
    for (const [key, meta] of Object.entries(colMap)) {
      const field = meta.field;
      let value = data[key];
      if (value == null || value === '') {
        // 保留空单元格，避免出现 0
        const idx = cells.findIndex((c) => c.col === meta.col);
        if (idx >= 0) cells[idx] = { col: meta.col, colLetters: numToCol(meta.col), row: rowNum, s: cells[idx].s, t: null, inner: '', selfClose: true, raw: '' };
        continue;
      }
      let type = field.type;
      if (type === 'date') {
        const serial = dateToSerial(value);
        value = serial == null ? null : serial;
        type = 'number';
      }
      if (type === 'number') {
        const n = Number(String(value).replace(/[^\d.\-]/g, ''));
        if (!isFinite(n) || n === 0 && !/0/.test(String(value))) { value = null; }
        else value = n;
      }
      const newNode = { col: meta.col, colLetters: numToCol(meta.col), row: rowNum, s: styleOf[meta.col], t: null };
      const idx = cells.findIndex((c) => c.col === meta.col);
      if (idx >= 0) {
        const s = cells[idx].s != null ? cells[idx].s : styleOf[meta.col];
        cells[idx] = { ...newNode, s };
      } else {
        cells.push(newNode);
        used.add(meta.col);
      }
      cells[cells.findIndex((c) => c.col === meta.col)].value = value;
      cells[cells.findIndex((c) => c.col === meta.col)].type = type;
      cells[cells.findIndex((c) => c.col === meta.col)].dirty = true;
    }

    /** 就地改写某个单元格：保留样式，字符串公式用 t="str" 写入缓存值 */
    const applyCell = (col, value, isString) => {
      if (!col || value == null || value === '') return;
      const idx = cells.findIndex((c) => c.col === col);
      let baseRaw = idx >= 0 ? (cells[idx].raw || '') : '';
      if (!baseRaw) {
        const sc = sample.cells.find((c) => c.col === col);
        baseRaw = sc ? (sc.raw || '') : '';
      }
      if (!baseRaw) {
        const st = idx >= 0 ? cells[idx].s : (styleOf[col] != null ? styleOf[col] : null);
        baseRaw = cellXml({ col, row: rowNum, style: st, value: null });
      }
      const fixed = baseRaw.replace(/\br="[A-Z]+\d+"/, `r="${numToCol(col)}${rowNum}"`);
      const patched = setCellRaw(fixed, value, isString);
      if (idx >= 0) cells[idx] = { ...cells[idx], raw: patched, selfClose: false, dirty: false };
      else cells.push({ col, colLetters: numToCol(col), row: rowNum, s: null, raw: patched, selfClose: false });
    };

    const c = data.codes || {};
    applyCell(formulaCols.costCode, c.costItem, true);
    applyCell(formulaCols.travelCode, c.travelType, true);
    applyCell(formulaCols.deptCode, c.dept, true);
    applyCell(formulaCols.projectCode, c.project, true);
    applyCell(formulaCols.applyAmt, data.amount, false);
    applyCell(formulaCols.submitAmt, data.amount, false);

    if (i === 0) {
      const serial = dateToSerial(opts.dateISO || new Date().toISOString().slice(0, 10));
      applyCell(headerCols.date, serial, false);
      applyCell(headerCols.empCode, opts.empCode, true);
      applyCell(headerCols.empName, opts.traveler, true);
      applyCell(headerCols.deptName, opts.dept, true);
      applyCell(headerCols.orgName, opts.org, true);
      applyCell(headerCols.orgCode, opts.headerCodes && opts.headerCodes.org, true);
      applyCell(headerCols.deptCode, opts.headerCodes && opts.headerCodes.dept, true);
      applyCell(headerCols.causa, opts.causa, true);
    }

    cells.sort((a, b) => a.col - b.col);
    const inner = cells.map((c) => {
      if (c.dirty) return cellXml({ col: c.col, row: rowNum, style: c.s, value: c.value, type: c.type });
      if (c.selfClose && !c.raw) return `<c r="${numToCol(c.col)}${rowNum}"${c.s != null ? ` s="${c.s}"` : ''}/>`;
      return c.raw || cellXml({ col: c.col, row: rowNum, style: c.s, value: null });
    }).join('');
    const newRowXml = `<row${existing ? existing.attrs : sample.attrs.replace(/r="\d+"/, `r="${rowNum}"`)}>${inner}</row>`;
    if (existing) patches.set(rowNum, newRowXml);
    else appended.push(newRowXml);
  });

  let newXml = xml.replace(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (whole, attrs, _c, inner) => {
    const rn = (attrs.match(/\br="(\d+)"/) || [])[1];
    if (!rn) return whole;
    const p = patches.get(+rn);
    return p || whole;
  });
  if (appended.length) newXml = newXml.replace('</sheetData>', appended.join('') + '</sheetData>');

  // 报销人姓名（表头 AC1 单元格）
  if (opts.traveler) {
    const cellRe = /<c\b[^>]*\br="AC1"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/;
    const m = newXml.match(cellRe);
    if (m) {
      const s = (m[0].match(/\bs="(\d+)"/) || [])[1];
      newXml = newXml.replace(cellRe, `<c r="AC1"${s != null ? ` s="${s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(opts.traveler)}</t></is></c>`);
    }
  }

  zip.file(sheetPath, newXml);

  // 打开时强制重算，保证 VLOOKUP / 合计等公式结果正确
  const wbPath = 'xl/workbook.xml';
  const wb = await zip.file(wbPath).async('string');
  let newWb;
  if (/<calcPr\b[^>]*\/>/.test(wb)) {
    newWb = wb.replace(/<calcPr\b([^>]*?)\/>/, (m0, attrs) => {
      const cleaned = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, '');
      return `<calcPr${cleaned} fullCalcOnLoad="1"/>`;
    });
  } else {
    newWb = wb.replace('</workbook>', '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  }
  zip.file(wbPath, newWb);

  const out = await zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return out;
}

/* ---------------- 兜底：无模板时生成一个简单的报销单工作簿 ---------------- */

function simpleSheetXml(rows) {
  const codes = FIELDS.map((f) => f.code);
  const xmlRows = [];
  xmlRows.push(`<row r="3">${codes.map((c, i) => `<c r="${numToCol(i + 1)}3" t="inlineStr"><is><t>${xmlEsc(c)}</t></is></c>`).join('')}</row>`);
  xmlRows.push(`<row r="4">${FIELDS.map((f, i) => `<c r="${numToCol(i + 1)}4" t="inlineStr"><is><t>${xmlEsc(f.label)}</t></is></c>`).join('')}</row>`);
  rows.forEach((data, i) => {
    const rn = i + 5;
    const cells = FIELDS.map((f, ci) => {
      let v = data[f.key];
      if (v == null || v === '') return '';
      if (f.type === 'date') {
        const s = dateToSerial(v);
        return s == null ? '' : `<c r="${numToCol(ci + 1)}${rn}"><v>${s}</v></c>`;
      }
      if (f.type === 'number') {
        const n = Number(v);
        return isFinite(n) ? `<c r="${numToCol(ci + 1)}${rn}"><v>${n}</v></c>` : '';
      }
      return `<c r="${numToCol(ci + 1)}${rn}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('');
    xmlRows.push(`<row r="${rn}">${cells}</row>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows.join('')}</sheetData></worksheet>`;
}

export async function buildSimpleWorkbook(rows, { traveler = '' } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="员工报销单模板" sheetId="1" r:id="rId1"/></sheets>
<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);
  zip.file('xl/worksheets/sheet1.xml', simpleSheetXml(rows));
  return zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' });
}
