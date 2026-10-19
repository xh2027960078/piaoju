/* 极简 PDF 生成器：把若干张 JPEG 拼成 A4 页面，不依赖任何第三方库 */

const A4_W = 595.28;
const A4_H = 841.89;

function bytesOf(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function concat(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * @param {Array<{data: Uint8Array, width: number, height: number}>} pages JPEG 数据
 * @returns {Blob} application/pdf
 */
export function buildPdfFromJpegs(pages) {
  const chunks = [];
  let size = 0;
  const push = (u8) => { chunks.push(u8); size += u8.length; };
  const offsets = [];

  const startObj = (num) => {
    offsets[num] = size;
    push(bytesOf(`${num} 0 obj\n`));
  };
  const endObj = () => push(bytesOf('\nendobj\n'));

  push(bytesOf('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'));

  const objCount = 2 + pages.length * 3;

  // 1: Catalog
  startObj(1);
  push(bytesOf('<< /Type /Catalog /Pages 2 0 R >>'));
  endObj();

  // 2: Pages
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  startObj(2);
  push(bytesOf(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  endObj();

  pages.forEach((pg, i) => {
    const pageNum = 3 + i * 3;
    const imgNum = pageNum + 1;
    const contNum = pageNum + 2;

    const scale = Math.min((A4_W - 48) / pg.width, (A4_H - 48) / pg.height);
    const w = pg.width * scale;
    const h = pg.height * scale;
    const x = (A4_W - w) / 2;
    const y = (A4_H - h) / 2;

    startObj(pageNum);
    push(bytesOf(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] `
      + `/Resources << /XObject << /Im0 ${imgNum} 0 R >> >> /Contents ${contNum} 0 R >>`));
    endObj();

    startObj(imgNum);
    push(bytesOf(`<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.data.length} >>\nstream\n`));
    push(pg.data);
    push(bytesOf('\nendstream'));
    endObj();

    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    const cb = bytesOf(content);
    startObj(contNum);
    push(bytesOf(`<< /Length ${cb.length} >>\nstream\n`));
    push(cb);
    push(bytesOf('\nendstream'));
    endObj();
  });

  // xref
  const xrefAt = size;
  let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objCount; i++) {
    xref += `${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`;
  }
  push(bytesOf(xref));
  push(bytesOf(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`));

  return new Blob([concat(chunks)], { type: 'application/pdf' });
}
