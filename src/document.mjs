// Independently implemented DTO renderer. Architectural attribution: ../ATTRIBUTION.md.
const CURRENCIES = Object.freeze({ USD: 2, EUR: 2, GBP: 2, MYR: 2, SGD: 2, JPY: 0, KWD: 3 });
export const limits = Object.freeze({ sections: 1000, rows: 10000, textLength: 50000, totalTextLength: 2000000, inputBytes: 5 * 1024 * 1024 });
const fail = (path, rule) => { throw new TypeError(`${path}: ${rule}`); };
function object(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(path, 'expected a plain object');
  if (Object.keys(value).some(key => !keys.includes(key))) fail(path, 'unknown field (only customer-facing DTO fields are accepted)');
}
function list(value, maximum, path) {
  if (!Array.isArray(value) || value.length > maximum) fail(path, `expected an array of at most ${maximum} entries`);
  for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) fail(path, 'sparse arrays are not accepted');
  return value;
}
function decimal(value, places, maxWhole, path) {
  if (typeof value !== 'string' || value.length > 32 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) fail(path, 'expected an unsigned plain decimal string');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > places) fail(path, `at most ${places} decimal places allowed`);
  const scale = 10n ** BigInt(places);
  const scaled = BigInt(whole) * scale + BigInt(fraction.padEnd(places, '0') || '0');
  if (scaled > maxWhole * scale) fail(path, 'exceeds supported maximum');
  return scaled;
}
function fixed(value, places) {
  const raw = value.toString().padStart(places + 1, '0');
  return places ? `${raw.slice(0, -places)}.${raw.slice(-places)}` : raw;
}
const trimDecimal = value => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
const halfUp = (numerator, denominator) => (numerator + denominator / 2n) / denominator;
function date(value, path) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(path, 'expected YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!year || month < 1 || month > 12 || day < 1 || day > days[month - 1]) fail(path, 'invalid calendar date');
  return value;
}
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

/** Validate, project and calculate only customer-facing fields; never accepts costs or internal totals. */
export function prepareDocument(input) {
  object(input, ['kind', 'number', 'date', 'currency', 'issuer', 'customer', 'project', 'validUntil', 'taxRate', 'notes', 'sections'], 'document');
  if (!['quotation', 'bq'].includes(input.kind)) fail('kind', 'expected quotation or bq');
  if (typeof input.currency !== 'string' || !Object.hasOwn(CURRENCIES, input.currency)) fail('currency', 'supported codes: USD, EUR, GBP, MYR, SGD, JPY, KWD');
  const digits = CURRENCIES[input.currency];
  let textCount = 0;
  const text = (value, path, optional = false) => {
    if (value === undefined && optional) return '';
    if (typeof value !== 'string' || value.length > limits.textLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || !value.isWellFormed()) fail(path, 'expected valid text without control characters, at most 50000 characters');
    if (!optional && !value.trim()) fail(path, 'must not be blank');
    textCount += value.length;
    if (textCount > limits.totalTextLength) fail('document', 'total text exceeds limit');
    return value;
  };
  const party = (value, path) => {
    object(value, ['name', 'address'], path);
    return { name: text(value.name, `${path}.name`), address: text(value.address, `${path}.address`, true) };
  };
  const result = {
    kind: input.kind, number: text(input.number, 'number'), date: date(input.date, 'date'), currency: input.currency,
    issuer: party(input.issuer, 'issuer'), customer: party(input.customer, 'customer'), project: text(input.project, 'project', true),
    notes: text(input.notes, 'notes', true), sections: []
  };
  if (input.kind === 'bq' && (Object.hasOwn(input, 'taxRate') || Object.hasOwn(input, 'validUntil'))) fail('document', 'BQ does not accept quotation tax or validity fields');
  if (input.validUntil !== undefined) {
    result.validUntil = date(input.validUntil, 'validUntil');
    if (result.validUntil < result.date) fail('validUntil', 'must be on or after date');
  }
  const taxRate = input.kind === 'quotation' ? decimal(input.taxRate ?? '0', 4, 100n, 'taxRate') : 0n;
  let subtotal = 0n;
  let rowCount = 0;
  for (const [sectionIndex, section] of list(input.sections, limits.sections, 'sections').entries()) {
    const path = `sections[${sectionIndex}]`;
    object(section, ['title', 'items'], path);
    const title = text(section.title, `${path}.title`);
    const items = list(section.items, limits.rows, `${path}.items`);
    rowCount += items.length;
    if (rowCount > limits.rows) fail('sections', 'total rows exceeds 10000');
    let sectionTotal = 0n;
    const rows = items.map((item, index) => {
      const rowPath = `${path}.items[${index}]`;
      object(item, input.kind === 'quotation' ? ['description', 'spec', 'quantity', 'unit', 'sellUnitPrice'] : ['description', 'spec', 'quantity', 'unit'], rowPath);
      const quantity = decimal(item.quantity, 4, 1000000000n, `${rowPath}.quantity`);
      const row = { description: text(item.description, `${rowPath}.description`), spec: text(item.spec, `${rowPath}.spec`, true), quantity: trimDecimal(fixed(quantity, 4)), unit: text(item.unit, `${rowPath}.unit`) };
      if (input.kind === 'quotation') {
        const rate = decimal(item.sellUnitPrice, digits, 999999999999n, `${rowPath}.sellUnitPrice`);
        const total = halfUp(rate * quantity, 10000n);
        row.sellUnitPrice = fixed(rate, digits);
        row.amount = fixed(total, digits);
        sectionTotal += total;
      }
      return row;
    });
    result.sections.push({ title, items: rows, ...(input.kind === 'quotation' ? { subtotal: fixed(sectionTotal, digits) } : {}) });
    subtotal += sectionTotal;
  }
  result.rowCount = rowCount;
  if (input.kind === 'quotation') {
    const tax = halfUp(subtotal * taxRate, 1000000n);
    result.taxRate = trimDecimal(fixed(taxRate, 4));
    result.totals = { subtotal: fixed(subtotal, digits), tax: fixed(tax, digits), total: fixed(subtotal + tax, digits) };
  }
  return result;
}

const CSS = `
@page { size: A4 portrait; margin: 15mm 12mm 17mm; }
* { box-sizing: border-box; }
:root { color-scheme: light; --ink: #202d40; --muted: #52647a; --line: #c4ceda; --paper: #fff; --wash: #eef3f8; }
body { font: 11px/1.5 Arial, sans-serif; color: var(--ink); background: var(--paper); margin: 0; }
main { max-width: 960px; margin: 36px auto; padding: 0 24px; }
header { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; border-top: 6px solid var(--ink); padding-top: 18px; margin-bottom: 24px; }
h1 { margin: 0; font: bold 28px/1.15 Georgia, serif; }
.issuer { font-weight: bold; font-size: 17px; }
.identity { text-align: right; }
.number { font: 12px/1.5 Consolas, monospace; margin-top: 8px; }
.address, .text, .description { white-space: pre-wrap; overflow-wrap: anywhere; }
.address { color: var(--muted); }
.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin-bottom: 24px; }
.label { display: block; text-transform: uppercase; font-size: 9px; letter-spacing: 1px; color: var(--muted); }
h2 { font-size: 13px; margin: 22px 0 8px; overflow-wrap: anywhere; break-after: avoid; page-break-after: avoid; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
caption { text-align: left; color: var(--muted); padding: 0 0 6px; }
th { background: var(--wash); font-weight: bold; text-align: left; border-top: 1px solid var(--line); }
th, td { padding: 7px 5px; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.spec { color: var(--muted); margin-top: 3px; white-space: pre-wrap; overflow-wrap: anywhere; }
.summary { margin: 20px 0 20px auto; width: 55%; break-inside: avoid; page-break-inside: avoid; }
.summary td:last-child { text-align: right; }
.total { font-size: 14px; font-weight: bold; border-top: 2px solid var(--ink); }
.section-total { text-align: right; font-weight: bold; margin: 8px 0 18px; }
.empty { color: var(--muted); padding: 16px 0; }
.notes { margin-top: 24px; }
footer { margin-top: 30px; padding-top: 8px; border-top: 1px solid var(--line); color: var(--muted); }
.print-help { background: var(--wash); padding: 12px; margin-bottom: 24px; }
header, .meta, .number, .issuer, h1 { overflow-wrap: anywhere; }
@media print {
 main { margin: 0; padding: 0; max-width: none; }
 .print-help { display: none; }
 thead { display: table-header-group; }
 tr { break-inside: avoid; page-break-inside: avoid; }
 tr.long-row { break-inside: auto; page-break-inside: auto; }
 header { break-inside: auto; }
 .notes, .text, .description { orphans: 2; widows: 2; }
 th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
@media screen and (max-width: 600px) { main { padding: 0 12px; } header, .meta { grid-template-columns: 1fr; } .identity { text-align: left; } .summary { width: 100%; } th, td { padding: 5px 3px; } }
`;

/** Returns a complete offline HTML document. This function does not return PDF bytes. */
export function renderHtml(input) {
  const doc = prepareDocument(input);
  const e = escapeHtml;
  const quotation = doc.kind === 'quotation';
  const title = quotation ? 'Quotation' : 'Bill of quantities';
  const money = value => `${doc.currency} ${value}`;
  let serial = 0;
  const sectionHtml = doc.sections.map(section => {
    const columns = quotation ? '<col style="width:6%"><col style="width:36%"><col style="width:16%"><col style="width:10%"><col style="width:10%"><col style="width:22%">' : '<col style="width:6%"><col style="width:44%"><col style="width:12%"><col style="width:16%"><col style="width:22%">';
    const headings = quotation ? '<th scope="col" class="num">Sell unit price</th><th scope="col" class="num">Qty</th><th scope="col">Unit</th><th scope="col" class="num">Amount</th>' : `<th scope="col">Unit</th><th scope="col" class="num">Qty</th><th scope="col">Bid rate (${doc.currency})</th>`;
    const rows = section.items.map(item => {
      serial++;
      // Large cells must be allowed to split when taller than a printed page.
      const long = [item.description, item.spec, item.unit].some(value => value.length > 700 || value.split('\n').length > 10);
      return `<tr class="${long ? 'long-row' : 'item-row'}"><td>${serial}</td><td class="description">${e(item.description)}${item.spec ? `<div class="spec">${e(item.spec)}</div>` : ''}</td>${quotation ? `<td class="num">${e(item.sellUnitPrice)}</td><td class="num">${e(item.quantity)}</td><td class="text">${e(item.unit)}</td><td class="num">${e(item.amount)}</td>` : `<td class="text">${e(item.unit)}</td><td class="num">${e(item.quantity)}</td><td class="bid-rate"></td>`}</tr>`;
    }).join('\n');
    return `<section><h2>${e(section.title)}</h2><table><caption>${quotation ? 'Selling prices in' : 'Bid rates to be completed in'} ${doc.currency}</caption><colgroup>${columns}</colgroup><thead><tr><th scope="col">No.</th><th scope="col">Description / specification</th>${headings}</tr></thead><tbody>${rows || `<tr><td colspan="${quotation ? 6 : 5}" class="empty">No items in this section.</td></tr>`}</tbody></table>${quotation ? `<p class="section-total">Section subtotal: ${money(section.subtotal)}</p>` : ''}</section>`;
  }).join('\n');
  const meta = (label, value) => `<div><span class="label">${label}</span><div class="text">${e(value)}</div></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${title} ${e(doc.number)}</title><style>${CSS}</style></head>
<body><main><aside class="print-help">Printable HTML. Use your browser's Print command to print or save as PDF.</aside>
<header><div><div class="issuer text">${e(doc.issuer.name)}</div><div class="address">${e(doc.issuer.address)}</div></div><div class="identity"><h1>${title}</h1><div class="number">${e(doc.number)}</div></div></header>
<div class="meta">${meta('Customer', doc.customer.name)}${meta('Date', doc.date)}${meta('Customer address', doc.customer.address)}${meta('Project', doc.project)}${doc.validUntil ? meta('Valid until', doc.validUntil) : ''}</div>
${sectionHtml || '<p class="empty">No items.</p>'}
${quotation ? `<table class="summary"><tbody><tr><th scope="row">Subtotal</th><td>${money(doc.totals.subtotal)}</td></tr><tr><th scope="row">Tax (${e(doc.taxRate)}%)</th><td>${money(doc.totals.tax)}</td></tr><tr class="total"><th scope="row">Total</th><td>${money(doc.totals.total)}</td></tr></tbody></table>` : '<p>Bid rate cells are intentionally blank. Quantities with different units are not added together.</p>'}
${doc.notes ? `<section class="notes"><h2>Notes</h2><div class="text">${e(doc.notes)}</div></section>` : ''}
<footer>${doc.rowCount} line item${doc.rowCount === 1 ? '' : 's'} · ${e(doc.issuer.name)}</footer></main></body></html>\n`;
}

/** Portable HTML download filename; does not imply PDF generation. */
export function htmlFilename(number, kind = 'document') {
  if (typeof number !== 'string' || !number.isWellFormed()) fail('number', 'expected valid text');
  if (!['document', 'quotation', 'bq'].includes(kind)) fail('kind', 'unsupported filename kind');
  const stem = number.normalize('NFKC').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'document';
  return `${kind}_${stem}.html`;
}
