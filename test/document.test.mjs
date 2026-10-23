import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, readFileSync as read, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderHtml, prepareDocument, escapeHtml, htmlFilename, limits } from '../src/document.mjs';
const quotation = JSON.parse(readFileSync(new URL('../examples/quotation.json', import.meta.url), 'utf8'));
const bq = JSON.parse(readFileSync(new URL('../examples/bq.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
const one = (quantity, sellUnitPrice, currency = 'USD', taxRate = '0') => ({ ...copy(quotation), currency, taxRate, sections: [{ title: 'Example', items: [{ description: 'Sample', quantity, sellUnitPrice, unit: 'piece' }] }] });
const row = doc => doc.sections[0].items[0];

test('fictional quotation totals match displayed line values and section totals', () => {
  const doc = prepareDocument(quotation);
  assert.deepEqual(doc.totals, { subtotal: '27.85', tax: '1.39', total: '29.24' });
  assert.equal(doc.sections[0].subtotal, '27.85');
  assert.equal(doc.sections[1].subtotal, '0.00');
  assert.equal(doc.rowCount, 3);
  assert.match(renderHtml(quotation), /USD 29\.24/);
});

test('decimal half-up is applied to each line then subtotal tax, including currency precision', () => {
  assert.equal(prepareDocument(one('1.5', '0.01')).totals.total, '0.02');
  assert.equal(prepareDocument(one('0.5', '2.01')).totals.total, '1.01');
  assert.deepEqual(prepareDocument(one('1', '0.10', 'USD', '5')).totals, { subtotal: '0.10', tax: '0.01', total: '0.11' });
  assert.equal(prepareDocument(one('1.5', '1', 'JPY')).totals.total, '2');
  assert.equal(prepareDocument(one('1.5', '0.001', 'KWD')).totals.total, '0.002');
  for (const currency of ['USD', 'EUR', 'GBP', 'MYR', 'SGD']) assert.equal(prepareDocument(one('1', '2', currency)).totals.total, '2.00');
  const doc = one('0.5', '0.01');
  doc.sections[0].items.push(copy(row(doc)));
  assert.equal(prepareDocument(doc).totals.total, '0.02');
});

test('maximum supported operands stay exact beyond Number safe integer', () => {
  assert.equal(prepareDocument(one('1000000000', '999999999999')).totals.total, '999999999999000000000.00');
});

test('independent integer reference checks 500 seeded line rounding cases', () => {
  let seed = 37;
  for (let i = 0; i < 500; i++) {
    seed = (seed * 16807) % 2147483647;
    const q = seed % 100000;
    const p = (seed >>> 4) % 100000;
    const quantity = `${Math.floor(q / 10000)}.${String(q % 10000).padStart(4, '0')}`;
    const price = `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;
    const cents = Math.floor((q * p + 5000) / 10000);
    const expected = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
    assert.equal(prepareDocument(one(quantity, price)).totals.total, expected);
  }
});

test('zero quantities, zero rates, empty documents and empty sections are explicit', () => {
  assert.equal(prepareDocument(one('0', '45')).totals.total, '0.00');
  assert.equal(prepareDocument(one('25', '0')).totals.total, '0.00');
  for (const original of [quotation, bq]) {
    const doc = copy(original); doc.sections = [];
    assert.match(renderHtml(doc), /No items\./);
    if (doc.kind === 'quotation') assert.equal(prepareDocument(doc).totals.total, '0.00');
    doc.sections = [{ title: 'Empty example', items: [] }];
    assert.match(renderHtml(doc), /No items in this section/);
  }
});

test('BQ has no prices or totals and does not sum unlike units', () => {
  const prepared = prepareDocument(bq);
  assert.equal(Object.hasOwn(prepared, 'totals'), false);
  assert.equal(Object.hasOwn(prepared.sections[0], 'subtotal'), false);
  const html = renderHtml(bq);
  assert.equal((html.match(/class="bid-rate"><\/td>/g) || []).length, 3);
  assert.match(html, /different units are not added together/);
  assert.doesNotMatch(html, /Sell unit price|Section subtotal/);
});

test('cost, profit, totals, hidden fields and nested unknown fields are rejected by construction', () => {
  for (const key of ['costUnitPrice', 'cost', 'profit', 'hidden', 'isSubItem', 'price', 'amount', 'markupRate']) {
    const doc = copy(quotation); row(doc)[key] = 'PRIVATE-CANARY';
    assert.throws(() => renderHtml(doc), /unknown field/);
  }
  for (const mutate of [doc => { doc.totals = {}; }, doc => { doc.issuer.logo = 'x'; }, doc => { doc.customer.email = 'x'; }, doc => { doc.sections[0].internal = 'x'; }]) {
    const doc = copy(quotation); mutate(doc); assert.throws(() => renderHtml(doc), /unknown field/);
  }
  const doc = copy(bq); row(doc).sellUnitPrice = '1'; assert.throws(() => renderHtml(doc), /unknown field/);
});

test('all untrusted text slots escape HTML, quotes, style closing and event payloads', () => {
  const attack = `<img src=x onerror="alert(1)"><script>alert('x')</script></style>&`;
  const doc = copy(quotation);
  doc.number = doc.project = doc.notes = attack;
  doc.issuer = doc.customer = { name: attack, address: attack };
  doc.sections[0].title = attack;
  row(doc).description = row(doc).spec = row(doc).unit = attack;
  const html = renderHtml(doc);
  assert.doesNotMatch(html, /<img|<script|<\/style>&/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&#39;x&#39;/);
  const bid = copy(bq); row(bid).description = attack;
  assert.doesNotMatch(renderHtml(bid), /<img|<script/);
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('no runtime remote assets, scripts or dynamic CSS injection; print structure included', () => {
  for (const original of [quotation, bq]) {
    const html = renderHtml(original);
    assert.doesNotMatch(html, /<script|<link|<img|@import|url\(|https?:\/\/|onclick=/i);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /<thead>/);
    assert.match(html, /display: table-header-group/);
    assert.match(html, /@page \{ size: A4/);
    assert.match(html, /tr\.long-row \{ break-inside: auto/);
    assert.match(html, /overflow-wrap: anywhere/);
  }
});

test('rejects NaN, infinity, negatives, missing, exponent, whitespace, excess precision and oversized decimals', () => {
  const invalid = [NaN, Infinity, -Infinity, -1, 0, 1.25, null, undefined, '', ' ', '-1', '-0', '+1', '1e2', '01', '.5', '1.', 'NaN', 'Infinity', ' 1', '1,000', '1.00001', '9'.repeat(100000)];
  for (const value of invalid) {
    const doc = one('1', '2'); row(doc).quantity = value;
    assert.throws(() => prepareDocument(doc), TypeError);
    const priced = one('1', '2'); row(priced).sellUnitPrice = value;
    assert.throws(() => prepareDocument(priced), TypeError);
  }
  assert.throws(() => prepareDocument(one('1000000000.0001', '1')), /maximum/);
  assert.throws(() => prepareDocument(one('1', '1000000000000')), /maximum/);
  assert.throws(() => prepareDocument(one('1', '1.001')), /decimal places/);
  assert.throws(() => prepareDocument(one('1', '1.1', 'JPY')), /decimal places/);
  for (const tax of ['-1', '100.0001', '101', NaN, '0.00001']) assert.throws(() => prepareDocument(one('1', '1', 'USD', tax)), TypeError);
});

test('validates currencies and real dates with leap years and chronology', () => {
  for (const value of ['usd', 'ZZZ', 'US', '<img>', null, 840, '__proto__', { toString: () => 'USD' }, ['USD']]) {
    const doc = copy(quotation); doc.currency = value; assert.throws(() => prepareDocument(doc), /currency/);
  }
  for (const value of ['2026-02-29', '2026-13-01', '2026-04-31', '0000-01-01', '2026-01-01T00:00:00Z', '', null]) {
    const doc = copy(quotation); doc.date = value; assert.throws(() => prepareDocument(doc), /date/);
  }
  const leap = copy(quotation); leap.date = '2024-02-29'; assert.equal(prepareDocument(leap).date, '2024-02-29');
  leap.validUntil = '2024-02-28'; assert.throws(() => prepareDocument(leap), /validUntil/);
  for (const key of ['validUntil', 'taxRate']) { const doc = copy(bq); doc[key] = '0'; assert.throws(() => prepareDocument(doc), /BQ/); }
});

test('invalid shapes, sparse arrays, controls and text bounds fail predictably', () => {
  for (const value of [null, [], 'string', {}, new Date()]) assert.throws(() => prepareDocument(value), TypeError);
  for (const mutate of [doc => { doc.issuer.name = ''; }, doc => { doc.number = '  '; }, doc => { doc.notes = '\u0000'; }, doc => { doc.notes = '\ud800'; }, doc => { doc.project = 5; }, doc => { doc.sections = [null]; }, doc => { doc.sections = Array(2); }, doc => { doc.sections[0].items = Array(2); }, doc => { doc.sections[0].items = [null]; }, doc => { doc.kind = 'invoice'; }, doc => { doc.notes = 'x'.repeat(50001); }]) {
    const doc = copy(quotation); mutate(doc); assert.throws(() => prepareDocument(doc), TypeError);
  }
  const sections = copy(bq); sections.sections = Array.from({ length: 1001 }, () => ({ title: 'Empty', items: [] }));
  assert.throws(() => prepareDocument(sections), /1000/);
  const manyText = copy(bq); manyText.sections = [{ title: 'Lots of text', items: Array.from({ length: 41 }, () => ({ description: 'x'.repeat(50000), quantity: '1', unit: 'piece' })) }];
  assert.throws(() => prepareDocument(manyText), /total text/);
});

test('10000 rows render without truncation; 10001 total rows across sections fail', () => {
  const doc = one('1', '0.01');
  doc.sections[0].items = Array.from({ length: 10000 }, (_, i) => ({ description: `UniqueRow${i + 1}`, quantity: '1', sellUnitPrice: '0.01', unit: 'piece' }));
  const prepared = prepareDocument(doc);
  assert.equal(prepared.totals.total, '100.00');
  const html = renderHtml(doc);
  assert.equal((html.match(/class="item-row"/g) || []).length, 10000);
  assert.match(html, /UniqueRow10000/);
  doc.sections.push({ title: 'Overflow', items: [copy(row(doc))] });
  assert.throws(() => prepareDocument(doc), /total rows/);
});

test('multiline and oversized descriptions survive intact and can split on print', () => {
  const doc = one('1', '1');
  row(doc).description = `START\n${'x'.repeat(49000)}\nEND`;
  row(doc).spec = 'Example\nSpecification';
  const html = renderHtml(doc);
  assert.match(html, /class="long-row"/);
  assert.ok(html.includes(escapeHtml(row(doc).description)));
  assert.ok(html.includes('Example\nSpecification'));
});

test('render is deterministic and does not mutate DTO or share prepared state', () => {
  const doc = copy(quotation); const before = copy(doc);
  const a = renderHtml(doc); const b = renderHtml(doc);
  assert.equal(a, b); assert.deepEqual(doc, before);
  const prepared = prepareDocument(doc); prepared.issuer.name = 'Changed';
  assert.equal(doc.issuer.name, 'Example Studio');
});

test('download filenames use portable sanitized stems and truthful HTML extension', () => {
  assert.equal(htmlFilename('../EX:Q/1.pdf', 'quotation'), 'quotation_EX_Q_1_pdf.html');
  assert.equal(htmlFilename('CON', 'bq'), 'bq_CON.html');
  assert.equal(htmlFilename(''), 'document_document.html');
  assert.equal(htmlFilename('😀'), 'document_document.html');
  assert.throws(() => htmlFilename(null), TypeError);
  assert.throws(() => htmlFilename('x', '../pdf'), TypeError);
});

test('CLI emits HTML; rejects PDF, bad JSON, bad UTF-8, big inputs, invalid DTOs and overwrite', () => {
  // Test workspace lives inside this package; no OS temp files or external writes.
  const dir = mkdtempSync(fileURLToPath(new URL('./.cli-', import.meta.url)));
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
  try {
    const input = join(dir, 'input.json'); const output = join(dir, 'result.html');
    writeFileSync(input, JSON.stringify(quotation));
    assert.equal(run('--help').status, 0);
    const result = run(input, output); assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Created printable HTML/);
    assert.match(read(output, 'utf8'), /^<!doctype html>/);
    assert.equal(run(input, output).status, 1);
    assert.equal(run(input, join(dir, 'fake.pdf')).status, 1); assert.equal(existsSync(join(dir, 'fake.pdf')), false);
    const bad = join(dir, 'bad.json'); const absent = join(dir, 'absent.html');
    for (const bytes of ['{', JSON.stringify({ ...quotation, cost: 'CANARY' }), Buffer.from([0xff, 0xfe])]) {
      writeFileSync(bad, bytes); assert.equal(run(bad, absent).status, 1); assert.equal(existsSync(absent), false);
    }
    writeFileSync(bad, ' '.repeat(limits.inputBytes + 1));
    const large = run(bad, absent); assert.equal(large.status, 1); assert.match(large.stderr, /5 MiB/);
    assert.equal(run(join(dir, 'missing.json'), absent).status, 1);
    assert.equal(run().status, 1);
    assert.equal(run(dir, absent).status, 1);
    assert.equal(run(input, join(dir, 'missing', 'output.html')).status, 1);
    // Invalid input never changes an existing target.
    assert.match(read(output, 'utf8'), /^<!doctype html>/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
