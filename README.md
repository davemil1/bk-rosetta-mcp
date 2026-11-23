# bk-rosetta-mcp

**Three public records of the same bankruptcy case, finally joined, with every answer traceable to the official definition.**

An MCP server that resolves any U.S. bankruptcy concept across three public sources that have never been linked:

| Spoke | Source | Example |
| --- | --- | --- |
| Official Form line | Official Bankruptcy Forms | B106Sum line 3, "Your total liabilities" |
| Hub: NIEM element | Individual Bankruptcy Data Collection IEPD, the published `bkcmecf` petition schema | `bkcmecf:TotalLiabilitiesAmount`: "The sum of liabilities on the summary of schedules." |
| Statistical variable | FJC Integrated Database, bankruptcy (FY2008–present) | `TOTLBLTS` (nulls as zero) / `TOTDBT` (nulls as missing) |

Ask in plain English. Claude resolves the term, quotes the official definition, names the form line, runs the query against real FJC data, and tells you what the data *can't* answer.

## Quick start

Requires Node 20+.

```
npm install
npm run build:rosetta                                        # walk the IEPD schema -> hub/rosetta.generated.json
npm run load:fjc -- data/sample/cpbank_fy2025_sample.tsv     # 20,000 real FY2025 filings, bundled
npm test                                                     # 11 end-to-end tests over MCP stdio
```

Open the folder in Claude Code: `.mcp.json` starts the server. Or add it to any MCP client as `node mcp/server.js`.

### On Databricks

The FJC data and the rosetta itself can live in Unity Catalog. Copy `.env.example` to `.env` and fill in your workspace host, SQL warehouse HTTP path, token, catalog and schema. Then:

```
npm run load:databricks -- data/raw/cpbank18on.txt --fy 2025 --filed-only
```

The loader streams the FJC file down to the bound columns, uploads it to a UC volume, and builds these Delta tables with `read_files`:
- `fjc_bk` and `fjc_district`, the FJC data;
- `hub_elements`, `form_lines` and `fjc_bindings`, the rosetta itself.

Every `fjc_bk` column carries its codebook meaning, its petition element and any caution as a UC column comment, so the mapping is governed metadata and not just a file in this repo. With `BACKEND=databricks` set in `.env`, `query_fjc` runs on the SQL warehouse. The tool contract is unchanged, and PGlite stays the default so the repo runs anywhere. `--dry-run` writes the files and SQL without connecting.

## Try these

1. *Which form line captures total liabilities, what does the court call it, and what share of chapter 7 filers reported under $50,000?*
2. *What are the allowed values for nature of debt, how does the FJC code them, and what's the consumer share in the top five districts?*
3. *A debtor says they filed before. Where does that go on the petition, what does the FJC call it, and how many prior filers were there?*
4. *What does the FJC dataset NOT know about a petition?*

Question 4 matters most. The server knows the limits of its own data.

## Tools

| Tool | What it does |
| --- | --- |
| `resolve` | Any handle in: a schema element, an FJC variable (`PRFILE`), a form line (`B101 Q9`, `Schedule I line 12`) or plain words (`pro se`). It returns all three spokes, with definition, provenance and `confirmed`/`inferred` status. Every answer says how it matched: `exact`, `synonym`, or, for anything else, ranked `candidates` with their official definitions (XSD, form-field and FJC codebook text, weighted by word rarity) so the agent chooses instead of the server guessing. |
| `describe_form` | An Official Form's fields in printed order, with line, element, definition, required flag and allowed values. Covers 30 forms. |
| `list_codes` | A coded field's allowed values beside the FJC's coding of the same field. It flags where they diverge. |
| `check_coverage` | `fjc`: which petition fields reach the statistics, per form, and an explicit list of what never does. |
| `query_fjc` | One read-only `SELECT` over table `fjc_bk` (plus `fjc_district`). Capped at 25 rows. |
| `validate_petition` | Full XSD validation against the IEPD (NIEM 2.0 imports included, libxml2 via WebAssembly). Also reports which fields reach the FJC statistics. |

Also exposed: resources `rosetta://overview`, `rosetta://fjc` and `rosetta://walkthrough/{total-liabilities,nature-of-debt,prior-filing}`, and prompts `trace`, `ask_fjc` and `coverage`.

## What joining them turned up

- **The codebook and the data disagree.** The FJC codebook says nature-of-business code `n` means Non-profit Organization. In FY2025, 62,104 cases carry `n`, 40,713 of them consumer cases, and 61,881 are marked not tax-exempt in the separate `TAXEXEMPT` field. In practice `n` means "None of the above". Filter on it to find non-profits and you get about 62,000 wrong rows. The petition schema adds a third scheme: `o` = Tax Exempt Entity, `O` = None of the above.
- **"Current" isn't "as filed".** The FJC keeps both the first record (`ORGFEESTS`) and the current record (`FEESTS`). The petition is the first record. For filing-fee status they differ in 48.0% of FY2025 filings, and the current value is blank for 173,709 cases filed as paid in full.
- **Null handling changes answers.** "Chapter 13 filers with under $50k in debt" is 25.3% using `TOTLBLTS` and 18.9% using `TOTDBT` across all 203,200 FY2025 chapter 13 filings, because 18,093 blank schedules become $0.
- **Snapshots overlap.** The FJC's rolling 06/30/2026 snapshot repeats 145,740 cases already in the FY2025 year-end snapshot. Counting FY2025 filings without deduping on `CASEKEY` gives 703,280 instead of 557,540. Both loaders keep only the latest snapshot per case.
- **Codebook line numbers are older than the forms.** The FJC cites "Schedule J line 22"; the current form splits it into 22a–22c.
- **The IEPD's own samples drift.** The NG1.6 involuntary sample petition fails validation against the NG1.7 schema. `validate_petition` reports exactly where.

## Layout

```
hub/schema/        the IEPD (extension + NIEM 2.0 imports), directory shape preserved
hub/fixtures/      the IEPD's seven synthetic sample petitions
hub/iepd/          IEPD README, changelog, document, and business-rules workbook
spokes/forms/      business-rules.json: 2,197 form fields -> XPath, line, rule (from the workbook)
spokes/fjc/        bindings.json (IDB variable -> hub element), districts.json (codebook Appendix A)
spokes/synonyms.json   plain-language phrases for resolve
tools/             build-rosetta.js (XSD walker), load-fjc.js, extract-business-rules.py
mcp/               server, tools, resources, prompts, validator
docs/              overview, FJC notes and caveats, three worked walkthroughs
```

## Data and caveats

The figures in this README and in `docs/` come from **all 557,540 FY2025 new filings** (FJC `cpbank18on.txt`, released Sep 2026), loaded on Databricks.

The bundled FJC file is only the **first 20,000 FY2025 new-filing rows**, not a random sample, so the demo runs out of the box. Its numbers are illustrative. For real analysis, download the full file from the FJC (`textfiles/cpbank18on.zip`, 887 MB) and load it locally or on Databricks:

```
npm run load:fjc -- data/raw/cpbank18on.txt --fy 2025 --filed-only
npm run load:databricks -- data/raw/cpbank18on.txt --fy 2025 --filed-only
```

Schedule totals are debtor-reported, not validated, and required only for individuals with primarily consumer debts. See [docs/fjc.md](docs/fjc.md) for the full list of caveats.

Everything here is public: no CM/ECF internals, no real debtor data. Write-side features (generating or filing a petition) are out of scope.

## Sources

- IEPD and case upload spec: https://pacer.uscourts.gov/sites/default/files/files/Mar_2022_case_upload_spec.pdf
- FJC IDB, bankruptcy: https://www.fjc.gov/research/idb/bankruptcy-cases-filed-terminated-and-pending-fy-2008-present
- FJC codebook (rev. 02/28/2023): https://www.fjc.gov/sites/default/files/idb/codebooks/Bankruptcy%20IDB%20Online%20Codebook%20rev%2002282023.pdf

## License

MIT for the code. The IEPD and FJC materials are U.S. government works, included for convenience.
