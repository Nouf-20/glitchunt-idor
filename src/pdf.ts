/**
 * Minimal, dependency-free PDF invoice generator.
 * Produces a valid single-page PDF 1.4 document using built-in
 * Helvetica / Helvetica-Bold. Workers-compatible (no Node APIs).
 */

export interface InvoicePdfData {
  companyName: string;
  invoiceNumber: string;
  issuedAt: string;
  dueAt: string;
  customerName: string;
  customerEmail: string;
  ticketId: number;
  ticketSubject: string;
  ticketCategory: string;
  amountCents: number;
  currency: string;
  /** Printed only on the PDF (never exposed via JSON APIs). */
  internalNote: string;
}

/** Keep PDF literal strings valid: escape parens/backslash, strip non-WinAnsi. */
function pdfText(s: string): string {
  const flat = String(s ?? "").replace(/[\r\n]+/g, " ").trim();
  let out = "";
  for (const ch of flat) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") out += "\\\\";
    else if (ch === "(") out += "\\(";
    else if (ch === ")") out += "\\)";
    else if (code >= 32 && code <= 126) out += ch;
    else out += "?";
  }
  // PDF string length guard (single line content)
  return out.slice(0, 220);
}

function money(amountCents: number, currency: string): string {
  const major = (amountCents / 100).toFixed(2);
  const cur = (currency || "USD").toUpperCase();
  return `${cur} ${major}`;
}

export function buildInvoicePdf(d: InvoicePdfData): Uint8Array {
  const lines: { text: string; size: number; bold: boolean }[] = [
    { text: d.companyName, size: 20, bold: true },
    { text: "Customer Support Portal - Invoice", size: 11, bold: false },
    { text: `Invoice: ${d.invoiceNumber}`, size: 13, bold: true },
    { text: `Issued: ${d.issuedAt}    Due: ${d.dueAt}`, size: 10, bold: false },
    { text: `Billed to: ${d.customerName} <${d.customerEmail}>`, size: 10, bold: false },
    { text: `Ticket #${d.ticketId} - ${d.ticketSubject} [${d.ticketCategory}]`, size: 10, bold: false },
    { text: `Description: Billable support work for ticket #${d.ticketId}.`, size: 10, bold: false },
    { text: `Amount due: ${money(d.amountCents, d.currency)}`, size: 13, bold: true },
    { text: `Status: PAID - Thank you for your business.`, size: 10, bold: false },
  ];

  // Internal support reference is part of the official document only.
  if (d.internalNote && d.internalNote.trim().length > 0) {
    lines.push({ text: `Support reference: ${d.internalNote.trim()}`, size: 9, bold: false });
  }
  lines.push({ text: "Questions? Contact billing@acme-support.example", size: 9, bold: false });

  // Build content stream
  let y = 770;
  let stream = "";
  for (const line of lines) {
    const font = line.bold ? "/F2" : "/F1";
    const gap = line.size >= 18 ? 30 : line.size >= 13 ? 24 : 17;
    stream += `BT ${font} ${line.size} Tf 56 ${y} Td (${pdfText(line.text)}) Tj ET\n`;
    y -= gap;
  }
  // thin divider line under header
  stream += `0.6 w 0.6 0.6 0.6 RG 56 700 m 556 700 l S\n`;

  const enc = new TextEncoder();
  const streamBytes = enc.encode(stream);

  // Objects
  const objects: string[] = [];
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`;
  objects[3] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  objects[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;
  // object 6 (stream) handled specially because of binary length

  const header = `%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n`;
  const parts: Uint8Array[] = [enc.encode(header)];
  const offsets: number[] = [0];
  let pos = parts[0].length;

  const push = (bytes: Uint8Array) => {
    parts.push(bytes);
    pos += bytes.length;
  };

  for (let n = 1; n <= 5; n++) {
    offsets[n] = pos;
    push(enc.encode(`${n} 0 obj\n${objects[n]}\nendobj\n`));
  }

  offsets[6] = pos;
  push(enc.encode(`6 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`));
  push(streamBytes);
  push(enc.encode(`\nendstream\nendobj\n`));

  const xrefPos = pos;
  let xref = `xref\n0 7\n0000000000 65535 f \n`;
  for (let n = 1; n <= 6; n++) {
    xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  push(enc.encode(xref));

  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
