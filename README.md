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
npm test                                                     # 11 end-to-end tests over MCP stdio
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

All six tools are read-only and annotated `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`.

| Tool | What it does |
| --- | --- |
| `resolve` | Any handle in: a schema element, an FJC variable (`PRFILE`), a form line (`B101 Q9`, `Schedule I line 12`) or plain words (`pro se`). It returns all three spokes, with definition, provenance and `confirmed`/`inferred` status. Every answer says how it matched: `exact`, `synonym`, or, for anything else, ranked `candidates` with their official definitions (XSD, form-field and FJC codebook text, weighted by word rarity) so the agent chooses instead of the server guessing. |
| `describe_form` | An Official Form's fields in printed order, with line, element, definition, required flag and allowed values. Covers 30 forms. |
| `list_codes` | A coded field's allowed values beside the FJC's coding of the same field. It flags where they diverge. |
| `check_coverage` | `fjc`: which petition fields reach the statistics, per form, and an explicit list of what never does. |
| `query_fjc` | One read-only `SELECT` over table `fjc_bk` (plus `fjc_district`). Capped at 25 rows. |
| `validate_petition` | Full XSD validation against the IEPD (NIEM 2.0 imports included, libxml2 via WebAssembly). Also reports which fields reach the FJC statistics. |

Also exposed: resources `rosetta://overview`, `rosetta://fjc` and `rosetta://walkthrough/{total-liabilities,nature-of-debt,prior-filing}`, and prompts `trace`, `ask_fjc` and `coverage`. Prompt arguments are a single word in Claude Code (`/mcp__bk-rosetta__coverage fjc`); for longer questions, just ask in plain English.

## What joining them turned up

- **The codebook and the data disagree.** The FJC codebook says nature-of-business code `n` means Non-profit Organization. In FY2025, 62,104 cases carry `n`, 40,713 of them consumer cases, and 61,881 are marked not tax-exempt in the separate `TAXEXEMPT` field. In practice `n` means "None of the above". Filter on it to find non-profits and you get about 62,000 wrong rows. The petition schema adds a third scheme: `o` = Tax Exempt Entity, `O` = None of the above.
- **"Current" isn't "as filed".** The FJC keeps both the first record (`ORGFEESTS`) and the current record (`FEESTS`). The petition is the first record. For filing-fee status they differ in 48.0% of FY2025 filings, and the current value is blank for 173,709 cases filed as paid in full.
- **Null handling changes answers.** "Chapter 13 filers with under $50k in debt" is 25.3% using `TOTLBLTS` and 18.9% using `TOTDBT` across all 203,200 FY2025 chapter 13 filings, because 18,093 blank schedules become $0.
- **Snapshots overlap.** The FJC's rolling 06/30/2026 snapshot repeats 145,740 cases already in the FY2025 year-end snapshot. Counting FY2025 filings without deduping on `CASEKEY` gives 703,280 instead of 557,540. Both loaders keep only the latest snapshot per case.
- **Codebook line numbers are older than the forms.** The FJC cites "Schedule J line 22"; the current form splits it into 22a–22c.
- **The IEPD's own samples drift.** The NG1.6 involuntary sample petition fails validation against the NG1.7 schema. `validate_petition` reports exactly where.

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
│   ├── tools/                 # index.js registers the six tools; fjc.js is the SQL backend
│   ├── resources/             # rosetta:// resources
│   └── prompts/               # trace, ask_fjc, coverage
├── hub/
│   ├── schema/                # The IEPD (extension + NIEM 2.0 imports), directory shape preserved
│   ├── fixtures/              # The IEPD's seven synthetic sample petitions
│   ├── iepd/                  # IEPD README, changelog, document, business-rules workbook
│   └── rosetta.generated.json # Generated by `npm run build:rosetta` (git-ignored)
├── spokes/
│   ├── forms/business-rules.json  # 2,197 form fields -> XPath, line, rule (from the workbook)
│   ├── fjc/bindings.json      # 55 FJC variables -> hub element, with codebook page, status, cautions
│   ├── fjc/districts.json     # Codebook Appendix A
│   └── synonyms.json          # Curated plain-language phrases for resolve
├── tools/                     # build-rosetta.js (XSD walker), load-fjc.js, load-databricks.js, extract-business-rules.py
├── data/
│   ├── sample/                # First 20,000 FY2025 filings (bundled)
│   └── raw/                   # Full FJC download goes here (git-ignored)
├── docs/                      # Overview, FJC notes and caveats, three worked walkthroughs
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
