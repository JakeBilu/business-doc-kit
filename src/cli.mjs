#!/usr/bin/env node
import { open, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { renderHtml, limits } from './document.mjs';

const usage = 'Usage: node src/cli.mjs INPUT.json OUTPUT.html\nEmits printable HTML only. Use browser Print / Save as PDF for PDF output.\n';
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(usage); return; }
  if (args.length !== 2 || args.some(arg => arg.startsWith('-'))) throw new Error(usage.trim());
  const [inputPath, outputPath] = args.map(arg => resolve(arg));
  if (extname(inputPath).toLowerCase() !== '.json') throw new Error('Input must use .json extension.');
  if (extname(outputPath).toLowerCase() !== '.html') throw new Error('Output must use .html extension. PDF generation is not provided by this CLI.');
  const handle = await open(inputPath, 'r');
  let source;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limits.inputBytes) throw new Error('Input must be a regular JSON file of at most 5 MiB.');
    // Bounded read also prevents unbounded allocation if input grows after stat().
    const buffer = Buffer.alloc(limits.inputBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > limits.inputBytes) throw new Error('Input exceeds 5 MiB.');
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
  } finally { await handle.close(); }
  const html = renderHtml(JSON.parse(source));
  // Refuse existing outputs, including symlinks. Validation completes before creation.
  await writeFile(outputPath, html, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`Created printable HTML: ${outputPath}\n`);
}
main().catch(error => { process.stderr.write(`business-doc-kit: ${error.message}\n`); process.exitCode = 1; });
