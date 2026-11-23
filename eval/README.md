# Evaluation

[`evaluation.xml`](evaluation.xml) holds 10 gold questions in the format of the GSA MCP hackathon template's `mcp-builder` skill. Each question is read-only, independent and answerable with one value compared as a string. Each one is built to hit a specific trap that an agent without this server would likely fall into.

**Dataset.** The data answers assume the full FY2025 load: FJC IDB `cpbank18on.txt` (September 2026 release), FY2025 new filings, one record per case, 557,540 rows. Load it with `npm run load:databricks -- data/raw/cpbank18on.txt --fy 2025 --filed-only` (or `load:fjc` for local). The bundled 20,000-row sample gives different numbers.

## How each answer was derived

| # | Answer | Path through the server | The trap |
|---|---|---|---|
| 1 | 18.9 | `resolve "total debt"` → `TOTLBLTS`, with `TOTDBT` listed as related; `query_fjc` on `TOTDBT` | `TOTLBLTS` counts blank schedules as $0 and gives 25.3 |
| 2 | 32.5 | `resolve "B101 Q9"` → `PRFILE`; `lower(prfile) = 'y'` | `PRFILE` is uppercase `Y`/`N` in FY2025 although the codebook says lowercase |
| 3 | 258 | `resolve "non profit"` → `TAXEXEMPT` | Nature-of-business code `n` is "Non-profit" in the codebook, but 62,104 cases carry it |
| 4 | 14696 | `resolve "fee waiver"` → `ORGFEESTS` (as filed) | Current-record `FEESTS` gives 12,524 and is blank for 40% of cases |
| 5 | Florida - Middle | `resolve "subchapter v"` → `ORGFLSUBCHP`; join `fjc_district` | Subchapter V isn't a chapter value; district codes need the lookup table |
| 6 | $1,000,001 - $10,000,000 | `ORGEASST` mode for chapter 11 is `E`; `list_codes EstimatedAssetsCode` gives the range | The data holds a letter; the answer needs the schema's code list |
| 7 | Maryland | `resolve "pro se"` → `ORGD1FPRSE`; `orgdbtrtyp = 'i'`, `HAVING count(*) >= 1000` | Needs the individual filter, as-filed flag, and a minimum-size rule |
| 8 | 0 | `check_coverage fjc` → `byForm.B107.captured` | The FJC data has nothing from the 421 fields of the Statement of Financial Affairs |
| 9 | 148 | `validate_petition NG1.6_CH7_Involuntary_BK_Petition` | The judiciary's own sample fails the current schema |
| 10 | 11136 | `ORGNTRDBT = 'b'` with `ORGDBTRTYP = 'i'` | Without the individual filter the count includes corporations |

The SQL for the data answers, all `WHERE snapfile = 1`:

```sql
-- 1
select round(100.0*count_if(totdbt < 50000)/count(totdbt),1) from fjc_bk where snapfile = 1 and orgflchp = '13';
-- 2
select round(100.0*avg(case when lower(prfile)='y' then 1 else 0 end),1) from fjc_bk where snapfile = 1 and orgflchp = '13';
-- 3
select count_if(lower(taxexempt) = 'y') from fjc_bk where snapfile = 1;
-- 4
select count_if(orgfeests = 'w') from fjc_bk where snapfile = 1;
-- 5
select d.name, count(*) n from fjc_bk b join fjc_district d on d.code = b.district
where snapfile = 1 and orgflsubchp = 'V' group by 1 order by n desc limit 1;
-- 6
select orgeasst, count(*) n from fjc_bk where snapfile = 1 and orgflchp = '11' group by 1 order by n desc limit 1;
-- 7
select d.name, round(100.0*avg(case when lower(b.orgd1fprse)='y' then 1 else 0 end),1) pct
from fjc_bk b join fjc_district d on d.code = b.district
where snapfile = 1 and orgflchp = '7' and orgdbtrtyp = 'i' group by 1 having count(*) >= 1000 order by pct desc limit 1;
-- 10
select count_if(orgntrdbt = 'b') from fjc_bk where snapfile = 1 and orgdbtrtyp = 'i';
```

## Running it

Run by hand: give each question to an agent connected only to this server and compare its final answer with `<answer>`.

To automate it, the template's `mcp-eval` skill builds an Arize Phoenix harness that launches an MCP server over stdio, runs an agent over a question set and scores the answers. It points at `node mcp/server.js` unchanged.
