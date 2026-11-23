# FJC Integrated Database (bankruptcy)

Dataset page: https://www.fjc.gov/research/idb/bankruptcy-cases-filed-terminated-and-pending-fy-2008-present
Codebook (Feb 2023): https://www.fjc.gov/sites/default/files/idb/codebooks/Bankruptcy%20IDB%20Online%20Codebook%20rev%2002282023.pdf
Research guide: https://www.fjc.gov/sites/default/files/IDB-Research-Guide.pdf

## Files
- `textfiles/cpbank08to17.zip` and `textfiles/cpbank18on.zip`: tab-delimited text, header row of 87 SAS short names, one row per case per fiscal-year snapshot. `cpbank18on.txt` is ~3.6 GB uncompressed.
- `datasets/cpbankfy26.zip` etc.: the same data as one SAS `.sas7bdat` per fiscal year (~300 MB each).
- Formally the Bankruptcy Petition NewSTATS Snapshots (BPNS) database.

## Structure
Each fiscal-year snapshot (SNAPSHOT = Sept 30) carries every case filed, pending, or closed in that year (SNAPFILE / SNAPPEND / SNAPCLOS). A case appears once per snapshot it is active in, so dedupe on CASEKEY keeping the latest SNAPSHOT before combining years. ORGFLCHP is the chapter on the first record; CRNTCHP and CLCHPT change on conversion.

## What it carries from the petition
B101 coded fields (chapter, nature of debt, debtor type, joint, fee status, prior filing, estimated assets/liabilities/creditors, county FIPS, pro se) and the B106 Summary totals mandated by 28 U.S.C. 159(c): real and personal property, secured/priority/nonpriority claims, the six "certain liabilities" lines summed as NDSCHRGD, Schedule I line 12 income, Schedule J line 22 expenses, and means-test CMI.

## What it does not carry
Exemptions, line-item assets, individual creditors and claims, contracts/codebtors, SOFA answers, means-test deductions, attorney compensation, names, SSNs, or street addresses.

## Caveats
Schedule totals are debtor-reported, not validated, and required only for individuals with primarily consumer debt. Debtor-level fields for FY2008 to Jun 2021 were corrected in Nov 2021. TOTLBLTS treats nulls as zero; TOTDBT treats them as missing. Judge fields are not published.

**Found while building this server:**

- **NOB codes do not match the petition schema.** In `BkPetitionCodeLists.xsd`, `o` = Tax Exempt Entity and `O` = None of the above. In the IDB (codebook p.45), `o` = Other and `n` = Non-profit Organization. A case-insensitive join conflates them.
- **y/n casing varies by column.** FY2025 `PRFILE` is `Y`/`N`; `JOINT` and `D1FPRSE` are lowercase. Compare with `lower()`.
- **TOTLBLTS vs TOTDBT changes answers.** In the bundled sample, the share of chapter 7 filers under $50,000 in total liabilities is 32.2% with `TOTLBLTS` (497 non-reporters counted as $0) and 30.2% with `TOTDBT` (non-reporters excluded). For chapter 13 it is 25.3% vs 18.4%.
- **Districts are codes.** `DISTRICT` uses the FJC's codes (Appendix A); the loader builds `fjc_district(code, name)` from `spokes/fjc/districts.json`.
- **Codebook line numbers are older than the forms.** The codebook says Schedule J "line 22"; the current B106J splits it into 22a–22c. `resolve "Schedule J line 22"` returns the sub-lines.

## The bundled sample

`data/sample/cpbank_fy2025_sample.tsv` is the first 20,000 FY2025 new-filing rows of `cpbank18on.txt`, **not a random sample**. It's there so the demo runs out of the box. Load a full year before citing a number:

```
npm run load:fjc -- data/raw/cpbank18on.txt --fy 2025 --filed-only
```
