# business-doc-kit

Offline, customer-facing quotation and bill-of-quantities (BQ) documents from small JSON DTOs. This release candidate generates **printable HTML**, with a shared layout and no network requests or package dependencies. Version 0.1.0 is a small, MIT-licensed source release. All examples contain fictional data; external adoption has not yet been established.

**PDF behavior:** the library and CLI return HTML, never PDF bytes. Open an emitted `.html` in a browser, choose Print, then Save as PDF. Browser pagination, installed-font coverage and print settings affect the result. The CLI refuses `.pdf` filenames. There is no server PDF renderer in this candidate.

## Run

Requires Node.js 22 or later. No install, build, database, server, credentials or environment file is needed. Run these commands from this directory:

```sh
node --test test/document.test.mjs
node scripts/check.mjs
node scripts/demo.mjs
node src/cli.mjs examples/quotation.json artifacts/cli-quotation.html
node src/cli.mjs examples/bq.json artifacts/cli-bq.html
```

The demo creates `artifacts/quotation.html`, `artifacts/bq.html` and `artifacts/long-quotation.html`. The long example has 240 fictional rows and an oversized specification. Open these local files in a browser. `artifacts/` is ignored and excluded from the package. The demo overwrites its three generated files when rerun; the CLI refuses to overwrite any output. An output parent directory must already exist.

Equivalent npm commands are `npm test`, `npm run check` and `npm run demo`; the direct Node commands work without npm shell configuration. `node src/cli.mjs --help` prints usage. CLI errors use stderr and exit code 1; success uses stdout and exit code 0. Input must be UTF-8 JSON, a regular file at most 5 MiB. Validation occurs before the output is created.

## Install from source

```sh
git clone https://github.com/JakeBilu/business-doc-kit.git
cd business-doc-kit
node src/cli.mjs --help
```

No npm registry package is published. To use the library from another local Node project, install this checked-out directory with `npm install /path/to/business-doc-kit`, then import `business-doc-kit`. Installation adds no third-party dependencies. To generate one document without running the demo, create an output directory first:

```sh
mkdir output
node src/cli.mjs examples/quotation.json output/quotation.html
```

## Library

```js
import { renderHtml, prepareDocument, htmlFilename } from './src/document.mjs';
import { readFile, writeFile } from 'node:fs/promises';
const input = JSON.parse(await readFile('examples/quotation.json', 'utf8'));
const checked = prepareDocument(input);
console.log(checked.totals); // { subtotal: '27.85', tax: '1.39', total: '29.24' }
await writeFile(htmlFilename(input.number, input.kind), renderHtml(input), { flag: 'wx' });
```

The ES module API is also declared in `src/index.d.ts`. `prepareDocument` returns a fresh validated model with canonical decimal strings; `renderHtml` validates the raw DTO itself. Do not pass the prepared model back to `renderHtml`, since computed fields are intentionally excluded from the input contract. There is no trusted raw HTML extension point.

## Input contract

See [examples/quotation.json](examples/quotation.json) and [examples/bq.json](examples/bq.json). All fields are case-sensitive. Arrays preserve input order; sections do not merge by name. Each row is an independent billable quotation line or BQ quantity; pre-filter internal/hidden rows before constructing the DTO.

| Field | Rule |
| --- | --- |
| `kind` | `quotation` or `bq` |
| `number`, `date`, `currency` | Required document reference, real `YYYY-MM-DD` calendar date, supported currency code |
| `issuer`, `customer` | `{ name, address? }`; nonblank name required |
| `project`, `notes` | Optional plain text; preserved line breaks |
| `sections` | Required array of `{ title, items }`; nonblank title; empty arrays are valid |
| `items` | `{ description, spec?, quantity, unit }`; nonblank description and unit |
| `sellUnitPrice` | Required on every quotation row; prohibited on BQ rows |
| `validUntil` | Quotation only; optional real date on/after `date` |
| `taxRate` | Quotation only; optional unsigned decimal percent from 0 to 100, at most 4 decimal places; defaults to `"0"` |

Unknown fields at every DTO level are rejected. Costs, profit, markup, hidden flags, nested sub-items, database identities and caller-supplied totals have no input slot. A consumer must explicitly construct this customer DTO from its internal model. Plain text can still contain anything its caller writes, so the renderer cannot detect confidential prose or an intentionally mislabelled price.

## Decimal and business rules

Every quantity, selling price and tax rate is an **unsigned plain decimal string**, such as `"0"`, `"1.5"` or `"12.35"`. JSON numbers are rejected, including non-finite values through the library. Signs, leading zeros (except `0`), exponent notation, separators, spaces, negatives and excess precision are rejected. Use an explicit decimal conversion at your application boundary; this renderer does not infer missing values or silently round input precision.

Quantities allow up to 4 decimal places and range from 0 to **1,000,000,000 inclusive**. Zero quantities and zero prices are valid. Unit selling prices range from 0 to **999,999,999,999 inclusive**, with currency precision:

| Currency codes | Decimal places |
| --- | --- |
| USD, EUR, GBP, MYR, SGD | 2 |
| JPY | 0 |
| KWD | 3 |

Other currency codes are rejected. The small allowlist defines precision only; no exchange conversion or currency-policy updates are performed. Arithmetic uses BigInt scaled integers. Multiply the exact entered selling price by quantity, round each line half up to the currency's minor unit, sum the displayed line amounts, then compute and round tax half up once on the subtotal. Section subtotals, document subtotal and displayed total share this calculation. For example, `"0.01" × "1.5"` becomes `0.02` in USD. Two `"0.01" × "0.5"` lines sum to `0.02` because each rounds first. Tax labels are generic and provide no jurisdiction-specific treatment.

A BQ deliberately has blank bid-rate cells. It never includes quotation amounts, tax, section money totals or a grand quantity total across incompatible units. This candidate has no discounts, deposits, payment schedules, cost-to-selling conversion, parent-child rollups, signatures, bundled business terms or legal/compliance guarantees.

## Text, printing and resource limits

All variable text is escaped, including document titles and section headings. No user input is interpolated into CSS, scripts or URLs. A restrictive Content Security Policy blocks scripts, remote assets, forms and base URLs. There are no embedded or remote fonts, images or JavaScript. CSS uses local system fonts, so font availability and glyph coverage remain the browser's responsibility.

A4 print CSS repeats table headings, wraps long/unbroken text, keeps ordinary rows together and allows oversized rows to split. Notes may span pages; totals are kept together. It does not truncate descriptions to one line. Pagination varies by browser; inspect the print preview when integrating a new template or very long content. Print helpers are hidden in printed output.

Limits are 1,000 sections, 10,000 total rows, 50,000 UTF-16 code units per text field, 2,000,000 combined text code units and 5 MiB CLI input. Invalid control characters, malformed Unicode, sparse arrays and non-plain objects are rejected. The library limits structured content; only the CLI bounds raw input bytes. Rendering is synchronous and intended for these bounded local documents.

## Verify and provenance

Tests cover exact totals and rounding, zero/empty cases, currency/date and decimal validation, invalid shapes, cost-field rejection, text escaping, 10,000 rows, oversized content, CLI UTF-8/size failures, honest output extensions and overwrite protection. Tests are deterministic and use only Node built-ins. The generated documents and all fixtures use Example Studio / Example Customer and invented data.

The implementation extracts a small display architecture from an existing private business application and replaces the application boundary with independent DTOs. It does not bundle that application. See [ATTRIBUTION.md](ATTRIBUTION.md) for scope and attribution and [LICENSE](LICENSE) for the MIT license on this independent implementation. The source release excludes the private application and all operational records. No external adoption is claimed.
