# Reproducible local run

From a clean source copy, use Node.js22+; no dependency installation is needed:

```sh
node scripts/demo.mjs
node src/cli.mjs examples/quotation.json artifacts/cli-quotation.html
node src/cli.mjs examples/bq.json artifacts/cli-bq.html
```

The demo creates the `artifacts` directory. Open the generated HTML in a browser. The quotation has a total of USD29.24; BQ bid-rate cells are intentionally empty. The long quotation demonstrates240synthetic rows and a large multiline specification. Use Print / Save as PDF for browser-rendered PDF; the CLI itself only emits HTML.

The CLI refuses existing output files. Use a new output name or deliberately remove only your generated file before another run. A `.pdf` output name is rejected rather than writing HTML under a misleading extension. Invalid input is rejected before creating output. Input must be UTF-8 JSON with explicit unsigned decimal strings and a customer-facing DTO; internal costs/markup and unknown fields are rejected. Confidential prose supplied in an allowed text field cannot be detected automatically.

```sh
node --test test/document.test.mjs
node scripts/check.mjs
```

These tests exercise rounding, escaping, bounds and CLI failures, not every browser's pagination or font coverage. An independent review also rendered the long example through an external Chromium browser and inspected the PDF text/pages; that is one environment, not a universal print guarantee.

Generated artifacts are not source. Public source should contain only the explicit release manifest, not private documents or browser profiles. License/attribution scope is in LICENSE and ATTRIBUTION.md.
