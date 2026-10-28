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

## Release workflow

Cutting a release is one tag plus the version bump in `package.json`:

```sh
npm version 0.1.2 --no-git-tag-version   # or edit the field by hand
git add package.json
git commit -m "Release 0.1.2"
git tag -a v0.1.2 -m "business-doc-kit 0.1.2"
git push origin main && git push origin v0.1.2
```

The planned `Release` workflow publishes to the npm registry with `--provenance` and then creates the GitHub release
for that tag. It is prepared but not yet installed in this repository, because the local GitHub CLI token does not carry
the `workflow` scope that GitHub requires for adding a file under `.github/workflows`. Until the maintainer refreshes the
token (`gh auth refresh -s workflow`), publish from a local copy with `npm publish --access public` and cut the GitHub
release with `gh release create v0.1.2 --generate-notes`. The prepared workflow file is kept outside the repository
until that scope is available; it needs one repository secret, `NPM_TOKEN`, holding an npm automation token, and it does
nothing at all while that secret is absent.

Before publishing, check the version number, the changelog-worthy changes, and that `npm pack --dry-run` lists only
intended files. The npm package must keep the same version as the git tag it was cut from.
