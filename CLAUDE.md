# bk-rosetta-mcp

A rosetta stone for U.S. bankruptcy filing data. The hub is the judiciary's published NIEM petition schema (`hub/schema/extension/BankruptcyPetition.xsd`). Every element in it has an official definition.

Two spokes bind to the hub, never to each other:
- `forms`: `spokes/forms/business-rules.json`, extracted from the IEPD's own business-rules workbook. It maps every Official Form field to its XPath, with form line, rule, required flag and allowed values.
- `fjc`: `spokes/fjc/bindings.json`. Federal Judicial Center Integrated Database variables, checked against the FJC codebook (rev. 02/28/2023).

## When answering questions
- Call `resolve` on every term before guessing a field, line or variable. Quote the definition verbatim.
- `query_fjc` returns at most 25 rows, so aggregate in SQL. Filter new filings with `snapfile = 1`. Compare y/n flags with `lower()`. Join `fjc_district` on `district = code` for district names.
- For what the petition said, use the as-filed `ORG*` variable that `resolve` lists first (`orgfeests`, not `feests`: they differ in 48.0% of filings). For petition-level questions filter `dbtrtyp = 'i'`. NOB code `n` is not "non-profit" in practice; use `taxexempt`. When `resolve` returns `match: candidates`, choose from their official definitions or say none fits; treat `match: fuzzy` as a guess.
- Say which liabilities variable you used: `TOTLBLTS` counts blank schedules as $0, `TOTDBT` excludes them.
- Always say what the FJC data cannot answer (`check_coverage fjc`).
- Check `count(*)` on `fjc_bk` first. The bundled sample (local PGlite default) is the first 20,000 FY2025 filings, not a random sample, so present its numbers as illustrative. The Databricks load is all 557,540 FY2025 new filings and can be cited.

## When working on the code
- Regenerate, don't hand-edit: `npm run build:rosetta` writes `hub/rosetta.generated.json`; `python tools/extract-business-rules.py` writes `spokes/forms/business-rules.json`.
- `npm test` runs the server over stdio and exercises every tool.
- The sample petitions in `hub/fixtures/` are synthetic. There is no real debtor data in this repo.
- `_private/` is gitignored working notes and must never be committed.
