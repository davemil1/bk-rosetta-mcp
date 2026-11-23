# bk-rosetta-mcp

**Three public records of the same bankruptcy case, finally joined, with every answer traceable to the official definition.**

An MCP server that resolves any U.S. bankruptcy concept across three public sources that have never been linked:

| Spoke | Source | Example |
| --- | --- | --- |
| Official Form line | Official Bankruptcy Forms | B106Sum line 3, "Your total liabilities" |
| Hub: NIEM element | Individual Bankruptcy Data Collection IEPD, the published `bkcmecf` petition schema | `bkcmecf:TotalLiabilitiesAmount`: "The sum of liabilities on the summary of schedules." |
| Statistical variable | FJC Integrated Database, bankruptcy (FY2008–present) | `TOTLBLTS` (nulls as zero) / `TOTDBT` (nulls as missing) |

Ask in plain English. Claude resolves the term, quotes the official definition, names the form line, runs the query against real FJC data, and tells you what the data *can't* answer.

Built for the GSA MCP Hackathon. See [Relation to the GSA template](#relation-to-the-gsa-mcp-hackathon-template).

## Quick start

Requires Node 20+.

```
npm install
npm run build:rosetta                                        # walk the IEPD schema -> hub/rosetta.generated.json
npm run load:fjc -- data/sample/cpbank_fy2025_sample.tsv     # 20,000 real FY2025 filings, bundled
npm test                                                     # 16 end-to-end tests over MCP stdio
```

Open the folder in Claude Code: `.mcp.json` starts the server. Or add it to any MCP client as `node mcp/server.js`. The server speaks MCP over stdio.

## Getting the FJC data

The bundled sample lets everything run out of the box. For real numbers, load a full fiscal year.

**1. Download.** The FJC publishes the bankruptcy IDB on its [dataset page](https://www.fjc.gov/research/idb/bankruptcy-cases-filed-terminated-and-pending-fy-2008-present). Under *Text files*, take **FY2018–present** (`cpbank18on.zip`, 887 MB; it unzips to `cpbank18on.txt`, about 3.6 GB, tab-delimited, 87 columns). Direct link: <https://www.fjc.gov/sites/default/files/idb/textfiles/cpbank18on.zip>. The [codebook](https://www.fjc.gov/sites/default/files/idb/codebooks/Bankruptcy%20IDB%20Online%20Codebook%20rev%2002282023.pdf) defines every variable.

```bash
mkdir -p data/raw
curl -L -o data/raw/cpbank18on.zip https://www.fjc.gov/sites/default/files/idb/textfiles/cpbank18on.zip
unzip data/raw/cpbank18on.zip -d data/raw          # -> data/raw/cpbank18on.txt
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force data/raw
Invoke-WebRequest https://www.fjc.gov/sites/default/files/idb/textfiles/cpbank18on.zip -OutFile data/raw/cpbank18on.zip
Expand-Archive data/raw/cpbank18on.zip -DestinationPath data/raw
```

`data/raw/` is git-ignored.

**2. Load one fiscal year of new filings**, locally (PGlite) or on Databricks:

```
npm run load:fjc        -- data/raw/cpbank18on.txt --fy 2025 --filed-only
npm run load:databricks -- data/raw/cpbank18on.txt --fy 2025 --filed-only
```

`--fy 2025` keeps cases filed in federal fiscal year 2025 (Oct 2024–Sep 2025). `--filed-only` keeps new filings (`SNAPFILE = 1`). Both loaders keep the columns bound in `spokes/fjc/bindings.json` and **one row per case**: the FJC's rolling snapshots repeat cases, so each `CASEKEY` keeps its latest snapshot. Expect 557,540 rows for FY2025 from the September 2026 release. The Databricks load takes about 5 minutes end to end; the local load of a full year has not been timed.

**3. Check** with `select count(*) from fjc_bk` through `query_fjc`, or ask Claude "how many FY2025 filings are loaded?"

### Loading other years

- **Several years from one file.** `cpbank18on.txt` holds every fiscal year from FY2018 on. Pass a list, `--fy 2023,2024,2025`, or omit `--fy` to load every year in the file. Then filter or group on `filefy` in SQL. The one-row-per-case rule still holds: a case that appears in several snapshots keeps its latest one.
- **FY2008–FY2017.** These are in a separate file, `cpbank08to17.zip`, on the same [dataset page](https://www.fjc.gov/research/idb/bankruptcy-cases-filed-terminated-and-pending-fy-2008-present). Each load **replaces** `fjc_bk`, so load one file at a time. Codes changed over the years (see the codebook's "Code Changes Over Time"), and the `ORG*` and Subchapter V columns don't exist for early years. Check `resolve` before comparing across them.
- **Size.** One year of new filings is about 140 MB before upload (43 MB gzipped), so several years scale roughly linearly. Without `--filed-only` the loader also keeps pending and closed cases, which are much larger.

### On Databricks

The FJC data and the rosetta itself can live in Unity Catalog. Copy `.env.example` to `.env` and fill in your workspace host, SQL warehouse HTTP path, token, catalog and schema. Then run the Databricks loader above.

The loader streams the FJC file down to the bound columns, gzips it, uploads it to a UC volume, and builds these Delta tables with `read_files`:
- `fjc_bk` and `fjc_district`, the FJC data;
- `hub_elements`, `form_lines` and `fjc_bindings`, the rosetta itself.

Every `fjc_bk` column carries its codebook meaning, its petition element and any caution as a UC column comment, so the mapping is governed metadata and not just a file in this repo. With `BACKEND=databricks` set in `.env`, `query_fjc` runs on the SQL warehouse. The tool contract is unchanged, and PGlite stays the default so the repo runs anywhere. `--dry-run` writes the files and SQL without connecting.

For querying, use a credential that can only `SELECT` on the FJC schema; see [SECURITY.md](SECURITY.md).

## Try these

1. *Which form line captures total liabilities, what does the court call it, and what share of chapter 7 filers reported under $50,000?*
2. *What are the allowed values for nature of debt, how does the FJC code them, and what's the consumer share in the top five districts?*
3. *A debtor says they filed before. Where does that go on the petition, what does the FJC call it, and how many prior filers were there?*
4. *What does the FJC dataset NOT know about a petition?*

Question 4 matters most. The server knows the limits of its own data.

## Tools

All eight tools are read-only and annotated `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`.

| Tool | What it does |
| --- | --- |
| `resolve` | Any handle in: a schema element, an FJC variable (`PRFILE`), a form line (`B101 Q9`, `Schedule I line 12`) or plain words (`pro se`). It returns all three spokes, with definition, provenance and `confirmed`/`inferred` status. Every answer says how it matched: `exact`, `synonym`, or, for anything else, ranked `candidates` with their official definitions (XSD, form-field and FJC codebook text, weighted by word rarity) so the agent chooses instead of the server guessing. |
| `describe_form` | An Official Form's fields in printed order, with line, element, definition, required flag and allowed values. Covers 30 forms. |
| `list_codes` | A coded field's allowed values beside the FJC's coding of the same field. It flags where they diverge. |
| `check_coverage` | `fjc`: which petition fields reach the statistics, per form, and an explicit list of what never does. |
| `query_fjc` | One read-only `SELECT` over table `fjc_bk` (plus `fjc_district`). Capped at 25 rows. |
| `validate_petition` | Full XSD validation against the IEPD (NIEM 2.0 imports included, libxml2 via WebAssembly). Also reports which fields reach the FJC statistics. |
| `explain_petition` | Reads a petition back in plain English. Every answer appears with the form line and question it answers, coded values are decoded through the schema's code lists, and repeated items are labelled (Creditor 3). Headline facts come first, each with the FJC variable that counts it. |
| `shred_petition` | Turns a petition into EAV rows. The entity is the form within the submission, the attribute is the question's XPath, and the value sits in a column typed by the workbook (money, date, integer, boolean, text). Nested repeats carry an indexed path and `seq`, e.g. `[3,2]` for creditor 3, claim 2. See [docs/eav.md](docs/eav.md). |

Also exposed: resources `rosetta://overview`, `rosetta://fjc` and `rosetta://walkthrough/{total-liabilities,nature-of-debt,prior-filing}`, and prompts `trace`, `ask_fjc` and `coverage`. Prompt arguments are a single word in Claude Code (`/mcp__bk-rosetta__coverage fjc`); for longer questions, just ask in plain English.

## What joining them turned up

- **The codebook and the data disagree.** The FJC codebook says nature-of-business code `n` means Non-profit Organization. In FY2025, 62,104 cases carry `n`, 40,713 of them consumer cases, and 61,881 are marked not tax-exempt in the separate `TAXEXEMPT` field. In practice `n` means "None of the above". Filter on it to find non-profits and you get about 62,000 wrong rows. The petition schema adds a third scheme: `o` = Tax Exempt Entity, `O` = None of the above.
- **"Current" isn't "as filed".** The FJC keeps both the first record (`ORGFEESTS`) and the current record (`FEESTS`). The petition is the first record. For filing-fee status they differ in 48.0% of FY2025 filings, and the current value is blank for 173,709 cases filed as paid in full.
- **Asset status changes after filing too.** 22,254 FY2025 cases have a different asset-case status (funds for unsecured creditors, Form 101 line 17) on the current record than on the petition as filed (`ORGASSTCASE` vs `ASSTCASE`).
- **The petition's own case is a document, not a case.** In the schema every form extends NIEM's `nc:DocumentType`. Only *cited* cases (prior, pending, affiliated, lawsuits) are `j:CaseType`, with disposition and status slots. So the XSD can say how a prior case ended but never how this one does. That's why 11 of the FJC's 87 columns (closing years, both debtors' outcomes and dates, chapter 11 dividend and future payments) have no petition counterpart.
- **The schema carries dead and mislabelled elements.** `BankruptcyCaseVoluntaryInvoluntaryCode`, `Chapter11PlanCode`, `Chapter11PlanFiledIndicator` and `PlanAcceptedIndicator` are declared but used by no petition type. `Chapter11PlanCode` has exactly the FJC's prepackaged-plan codes (Y/P/B), and the voluntary/involuntary code list labels its codes "v = Business, i = Consumer". `CourtDivisionalOfficeCode` is defined as "an entity to whom money is owed".
- **The codebook doesn't always match the data.** Case outcome "discharge withheld, no financial-management course" is printed as zero (`0`) but stored as the letter `O`. Liabilities range `J` ("not valid after 11/30/2015") still appears on an FY2025 filing. Circuit `00` is the D.C. Circuit, while district `00` is Maine.
- **Null handling changes answers.** "Chapter 13 filers with under $50k in debt" is 25.3% using `TOTLBLTS` and 18.9% using `TOTDBT` across all 203,200 FY2025 chapter 13 filings, because 18,093 blank schedules become $0.
- **Snapshots overlap.** The FJC's rolling 06/30/2026 snapshot repeats 145,740 cases already in the FY2025 year-end snapshot. Counting FY2025 filings without deduping on `CASEKEY` gives 703,280 instead of 557,540. Both loaders keep only the latest snapshot per case.
- **Codebook line numbers are older than the forms.** The FJC cites "Schedule J line 22"; the current form splits it into 22a–22c.
- **The IEPD's own samples drift.** The NG1.6 involuntary sample petition fails validation against the NG1.7 schema. `validate_petition` reports exactly where.

## Business rules as Schematron

`npm run build:schematron` turns the IEPD business-rules workbook into ISO Schematron, [`hub/rules/business-rules.sch`](hub/rules/business-rules.sch), so any XML toolchain can check a petition against the rules the XSD can't express. It uses XPath 1.0, so any processor runs it (Saxon, schxslt, `node-schematron`). It contains:

- **Generated asserts:** 27 required-field and 159 allowed-value asserts, in one pattern per form. Where several workbook rows share an XPath (one per printed item, such as federal, state and local tax refunds on Schedule A/B line 28), their value lists are merged into one assert. Each carries the workbook rule id (`BCO-101-0064-values`) and the workbook's own error message. For value lists written as "code = label", only tokens that are real codes in the schema's code list are kept; 2 lists that can't be parsed safely are skipped and named in the file header.
- **Hand-translated cross-field rules:** chapter 12 must be business debt (BCO-101-0102 c), and the SSN/ITIN and EIN formats.
- **Consistency warnings:** the Form 101 estimate ranges are checked against the Form 106Sum schedule totals. On the IEPD's own samples this flags three petitions that estimate $1–10 billion in liabilities against a $303 schedule total.

Of the 181 absolute rule contexts, 152 occur in the seven sample petitions.

**Tested with a real Schematron engine.** The tests run the rules with `node-schematron` (a dev dependency) on the two small IEPD samples, and on a tiny petition built from the workbook's own XPaths. On all seven samples the rules report only genuine findings:

| Samples | Finding |
| --- | --- |
| Chapter 11 Subchapter V (NG1.6.1 and NG1.7), chapter 7 "complete" | Estimated assets and liabilities on Form 101 contradict the Form 106Sum totals ($1–10 billion vs $303) |
| Five of seven | BCO-101-0047 / BCO-105-0021: the workbook requires the county on a business address, but the samples omit it and the XSD doesn't enforce it |

The largest sample takes about 85 seconds in `node-schematron`, so the tests use the small ones; Saxon is much faster for bulk checking.

## Repo structure

```
bk-rosetta-mcp/
├── README.md                  # This file
├── SECURITY.md                # Vulnerability reporting + hackathon security notes
├── CLAUDE.md                  # Instructions for coding agents working in this repo
├── package.json               # Scripts: build:rosetta, load:fjc, load:databricks, test
├── .mcp.json                  # Claude Code launches the server from here
├── .env.example               # Databricks settings; copy to .env (git-ignored)
├── .github/workflows/ci.yml   # Build the rosetta, load the sample, run the tests
├── mcp/
│   ├── server.js              # Entry point: stdio transport, server instructions
│   ├── rosetta.js             # Loads hub + spokes, joins them, resolve/search logic
│   ├── databricks.js          # Databricks connection (query path and loader)
│   ├── validate.js            # libxml2 (WebAssembly) XSD validation
│   ├── petition.js            # Petition XML -> EAV rows -> plain-English reading
│   ├── tools/                 # index.js registers the eight tools; fjc.js is the SQL backend
│   ├── resources/             # rosetta:// resources
│   └── prompts/               # trace, ask_fjc, coverage
├── hub/
│   ├── schema/                # The IEPD (extension + NIEM 2.0 imports), directory shape preserved
│   ├── fixtures/              # The IEPD's seven synthetic sample petitions
│   ├── iepd/                  # IEPD README, changelog, document, business-rules workbook
│   ├── rules/business-rules.sch  # ISO Schematron, generated by `npm run build:schematron`
│   └── rosetta.generated.json # Generated by `npm run build:rosetta` (git-ignored)
├── spokes/
│   ├── forms/business-rules.json  # 2,197 form fields -> XPath, line, rule (from the workbook)
│   ├── fjc/bindings.json      # All 87 FJC variables -> hub element or related elements, codebook page, code lists, cautions
│   ├── fjc/districts.json     # Codebook Appendix A
│   └── synonyms.json          # Curated plain-language phrases for resolve
├── tools/                     # build-rosetta.js (XSD walker), build-schematron.js, load-fjc.js, load-databricks.js, extract-business-rules.py
├── data/
│   ├── sample/                # First 20,000 FY2025 filings (bundled)
│   └── raw/                   # Full FJC download goes here (git-ignored)
├── docs/                      # Overview, FJC notes and caveats, EAV design, three worked walkthroughs
├── eval/                      # 10 gold questions (evaluation.xml) + how each answer was derived
└── test/                      # End-to-end tests over MCP stdio
```

## Evaluation

[`eval/evaluation.xml`](eval/evaluation.xml) holds 10 gold questions in the hackathon template's `mcp-builder` format. Each has a single verifiable answer from the full FY2025 load, and each is built around a trap an agent would fall into without this server: blank schedules counted as $0, as-filed vs current fee status, the NOB code that doesn't mean what the codebook says, non-individual debtors in the counts, and so on. [`eval/README.md`](eval/README.md) shows the tool path and SQL behind every answer.

## Relation to the GSA MCP hackathon template

The [GSA MCP hackathon template](https://github.com/GSA-TTS/mcp-hackathon-template) is a Python/FastMCP starter. This server is written in Node with the official MCP TypeScript SDK, because its two heaviest pieces are JavaScript: XSD validation runs libxml2 compiled to WebAssembly, and the local database is PGlite (Postgres in WebAssembly). It follows the template's conventions where they apply:

- **Read-only tool annotations** on every tool.
- **Tool design tips for federal data:**
  - Results are structured JSON with consistent keys, not prose.
  - The `query_fjc` description states the data's as-of release and fiscal year.
  - Errors return a `hint`, and results are capped at 25 rows.
  - No tool fetches a caller-supplied URL.
  - No personal data exists to leak: the FJC publishes no names, SSNs or addresses.
- **`SECURITY.md`** with a hackathon note.
- **CI** on every push.
- **An `eval/` directory** with gold questions in the `mcp-builder` format. The template's `mcp-eval` Phoenix harness can run them against `node mcp/server.js` unchanged.

## Next steps

- **Deploy as a Databricks App.** The template's `deploy/databricks/` kit runs an MCP server as a Databricks App over streamable HTTP at `/mcp`, with a `/health` check. For this server that means three things:
  1. Add the SDK's `StreamableHTTPServerTransport` when `DATABRICKS_APP_PORT` is set.
  2. Add an `app.yaml` that runs `node mcp/server.js`.
  3. Have the SQL backend use the app's injected service principal (`DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET`) instead of a personal token.

  The server would then run inside the workspace next to the data, behind workspace authentication. This needs Databricks Apps enabled on the workspace.
- **Semantic search in `resolve`.** Precompute embeddings of each element's XSD definition, form-field text and codebook meaning at build time. Rank candidates by meaning as well as by words, so "does the debtor rent" finds `DebtorRentsResidenceIndicator` without a synonym.
- **A `check_rules` tool, and the rest of the rules.** The Schematron is tested but not yet exposed as a tool; a faster engine (Saxon) would make that practical on large petitions. About 25 of the workbook's conditional rules are still English only.
- **Store petition values.** `shred_petition` returns rows; a `petition_values` table on Databricks (DDL in [docs/eav.md](docs/eav.md)) would hold them for querying across submissions.
- **MCP registry.** Add `server.json` once the repository has its public home.
- **More FJC columns.** Case outcomes (`D1FDSP`, discharge dates) are loaded but not yet joined to the petition's eventual fate; `CASETYP` (voluntary vs involuntary) would tie cases to B101 vs B105.

## Data and caveats

The figures in this README and in `docs/` come from **all 557,540 FY2025 new filings** (FJC `cpbank18on.txt`, released September 2026), loaded on Databricks. The bundled sample is the **first 20,000 FY2025 new-filing rows**, not a random sample, so numbers from it are illustrative.

Schedule totals are debtor-reported, not validated, and required only for individuals with primarily consumer debts. The FJC covers every bankruptcy case, while this IEPD covers the individual petition, so filter `dbtrtyp = 'i'` for petition-level questions. See [docs/fjc.md](docs/fjc.md) for the full list of caveats.

Everything here is public: no CM/ECF internals, no real debtor data. Write-side features (generating or filing a petition) are out of scope.

## Sources

- IEPD and case upload spec: https://pacer.uscourts.gov/sites/default/files/files/Mar_2022_case_upload_spec.pdf
- FJC IDB, bankruptcy (dataset page): https://www.fjc.gov/research/idb/bankruptcy-cases-filed-terminated-and-pending-fy-2008-present
- FJC IDB, FY2018–present text file: https://www.fjc.gov/sites/default/files/idb/textfiles/cpbank18on.zip
- FJC codebook (rev. 02/28/2023): https://www.fjc.gov/sites/default/files/idb/codebooks/Bankruptcy%20IDB%20Online%20Codebook%20rev%2002282023.pdf

## Security and license

See [SECURITY.md](SECURITY.md). MIT for the code. The IEPD and FJC materials are U.S. government works, included for convenience.
