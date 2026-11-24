# Evaluation report: bk-rosetta-mcp

**Score: 9 / 10 exact-match with the server, 1 / 10 without it.** The one miss is off by 8 cases (0.07%) and traces to a single variable choice, explained below.

The full evaluation document, with methodology, metrics, security and lessons learned, is [`bk-rosetta-mcp-evaluation.pdf`](bk-rosetta-mcp-evaluation.pdf) ([.docx](bk-rosetta-mcp-evaluation.docx)). The slide deck is [`bk-rosetta-mcp-deck.pdf`](bk-rosetta-mcp-deck.pdf) ([.pptx](bk-rosetta-mcp-deck.pptx)), and the demo video is [`bk-rosetta-mcp-demo.mp4`](bk-rosetta-mcp-demo.mp4).

| | |
|---|---|
| Date | 2026-11-23 |
| Question set | [`evaluation.xml`](evaluation.xml): 10 gold questions, mcp-builder format from the GSA MCP hackathon template |
| Data | FJC IDB `cpbank18on.txt` (September 2026 release), FY2025 new filings, one row per case: **557,540 rows** in Databricks Unity Catalog (`users.david_milstein.fjc_bk`), queried on a serverless SQL warehouse |
| Agent | Claude (Opus 5.5), a fresh sub-agent with no prior context |
| Scoring | Exact string match against `<answer>`, as in the mcp-builder evaluation format |

## Method

The agent was given only the 10 questions, not the answers. It was told to answer using only the bk-rosetta MCP tools and not to read any repository files. It worked from the server's own instructions and tool descriptions. It first checked the row count of `fjc_bk` (557,540, so it cited full-year numbers) and called `resolve` before choosing each variable. The answers were then compared with the gold answers.

This was one run by hand, not the automated Arize Phoenix harness that the template's `mcp-eval` skill builds. The harness would point at the same server unchanged (`node mcp/server.js`).

## Results

| # | Question (short) | Gold | Agent | Result | Tool path | The trap the agent avoided |
|---|---|---|---|---|---|---|
| 1 | Ch.13 filers under $50k debt, blanks excluded (%) | 18.9 | 18.9 | ✅ | `resolve "total debt"` → `resolve TOTDBT` → `query_fjc` | Used `TOTDBT`; `TOTLBLTS` counts blank schedules as $0 and gives 25.3 |
| 2 | Ch.13 filers with a prior filing in 8 years (%) | 32.5 | 32.5 | ✅ | `resolve "filed before"` → `query_fjc` | `PRFILE` is uppercase in FY2025; compared with `lower()` |
| 3 | Tax-exempt (non-profit) filers | 258 | 258 | ✅ | `resolve "tax-exempt"` → `query_fjc` | Used `TAXEXEMPT`, not NOB code `n` (62,104 cases, mostly consumers) |
| 4 | Fee waived, as originally filed | 14696 | 14696 | ✅ | `resolve "fee waived"` (candidates) → `resolve FilingFeeStatusCode` → `query_fjc` | Picked as-filed `ORGFEESTS`; current `FEESTS` gives 12,524 |
| 5 | District with most Subchapter V cases | Florida - Middle | Florida - Middle | ✅ | `resolve "subchapter V small business"` → `query_fjc` with district join | Subchapter V is a flag (`ORGFLSUBCHP`), not a chapter value; names need `fjc_district` |
| 6 | Most common Ch.11 estimated-assets range | $1,000,001 - $10,000,000 | $1,000,001 - $10,000,000 | ✅ | `resolve "estimated assets"` → `list_codes EstimatedAssetsCode` → `query_fjc` | The data holds letter `E`; the answer needed the schema's code list |
| 7 | District with highest Ch.7 pro se share (≥1,000 individual cases) | Maryland | Maryland | ✅ | `resolve "pro se"` → `query_fjc` | Applied the individual filter and the as-filed `ORGD1FPRSE` (Maryland 29.8%, next 18.2%) |
| 8 | Form 107 (SOFA) fields in the FJC data | 0 | 0 | ✅ | `check_coverage fjc` | B107 has 421 fields, none captured |
| 9 | First error line, NG1.6 involuntary sample | 148 | 148 | ✅ | `validate_petition NG1.6_CH7_Involuntary_BK_Petition` | The judiciary's own sample fails the current schema |
| 10 | Individuals reporting primarily business debts | 11136 | 11144 | ❌ | `resolve "nature of debts"` (candidates) → `resolve NatureOfDebtsCode` → `resolve "debtor type"` → `query_fjc` | Used as-filed `ORGNTRDBT` correctly, but current-record `DBTRTYP` for the individual filter |

## The miss, explained

Question 10 asks what debtors *said on their petition*, so both the nature-of-debts code and the debtor type should be the as-filed `ORG*` values. The agent used `ORGNTRDBT` but filtered with the current-record `DBTRTYP`, noting that `resolve` reports the two differ in under 1% of filings. Verified on the same table:

| Debtor-type variable | Count |
|---|---|
| `ORGDBTRTYP = 'i'` (as filed) | **11,136** (gold) |
| `DBTRTYP = 'i'` (current record) | 11,144 |

The gold answer stands. The fix is in the server, not the question: the server instructions say "filter `dbtrtyp = 'i'`" for petition-level questions, and the agent followed that wording literally. Changing that instruction to `orgdbtrtyp = 'i'` should close the gap.

## No-tool baseline

A second fresh agent got the same 10 questions with no tools at all and had to give its best answer. It scored **1 / 10**. Its one correct answer, question 8 (0 SOFA fields), was a reasoned guess about coverage. Its other answers were plausible but wrong: 22.4, 34.5, 120, 9500, Florida - Southern, "$1,000,001-$10 million" (not the code list's wording), Georgia - Northern, 2 and 11000.

## Observations

- **Tools used.** `resolve` was called before every data query (14 calls). `query_fjc` was used for 8 questions and `list_codes`, `check_coverage` and `validate_petition` once each.
- **Ambiguous phrases.** `resolve` returned ranked candidates twice ("fee waived", "nature of debts"). Both times the agent picked the right element from its official definition.
- **Errors.** One retry: a shortened sample name for `validate_petition` was rejected with the list of valid names, and the agent retried with the full name.
- **Limits.** Following the server's instructions, without being asked in the prompt, the agent ended by saying what the FJC data cannot answer: no SOFA answers, no individual creditors, no way to link a debtor's repeat filings.

## Reproducing

The SQL behind every gold answer is in [`README.md`](README.md). To rerun the evaluation, give each question in `evaluation.xml` to an agent connected only to this server, with the full FY2025 load (`npm run load:databricks -- data/raw/cpbank18on.txt --fy 2025 --filed-only`). The bundled 20,000-row sample gives different numbers.
