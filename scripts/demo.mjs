import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderHtml } from '../src/document.mjs';
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/', root), { recursive: true });
for (const kind of ['quotation', 'bq']) {
  const doc = JSON.parse(await readFile(new URL(`examples/${kind}.json`, root), 'utf8'));
  const target = new URL(`artifacts/${kind}.html`, root);
  await writeFile(target, renderHtml(doc));
  console.log(`Printable HTML: ${fileURLToPath(target)}`);
}
const long = JSON.parse(await readFile(new URL('examples/quotation.json', root), 'utf8'));
long.number = 'EX-LONG-001';
long.sections = [{ title: 'Long fictional work schedule', items: Array.from({ length: 240 }, (_, i) => ({ description: `ROW-${String(i + 1).padStart(3, '0')} Fictional work item`, spec: i === 119 ? `${'Long unbroken text '.repeat(200)}\n${'X'.repeat(1600)}\nEND-OF-LONG-SPEC` : 'Example specification', quantity: '1.5', unit: 'piece', sellUnitPrice: '0.01' })) }];
const target = new URL('artifacts/long-quotation.html', root);
await writeFile(target, renderHtml(long));
console.log(`Printable HTML: ${fileURLToPath(target)} (240 rows; oversized specification)`);
