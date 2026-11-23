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
B101 coded fields, as filed and as currently recorded (chapter, Subchapter V, nature of debt, debtor type, joint, fee status, prior filing, estimated assets/liabilities/creditors, county FIPS, pro se) and the B106 Summary totals mandated by 28 U.S.C. 159(c): real and personal property, secured/priority/nonpriority claims, the six "certain liabilities" lines summed as NDSCHRGD, Schedule I line 12 income, Schedule J line 22 expenses, and means-test CMI.

## What it does not carry
Exemptions, line-item assets, individual creditors and claims, contracts/codebtors, SOFA answers, means-test deductions, attorney compensation, names, SSNs, or street addresses.

## Caveats
Schedule totals are debtor-reported, not validated, and required only for individuals with primarily consumer debt. Debtor-level fields for FY2008 to Jun 2021 were corrected in Nov 2021. TOTLBLTS treats nulls as zero; TOTDBT treats them as missing. Judge fields are not published.

**Found while building this server:**

- **NOB: the data does not follow the codebook.** The codebook (p.46) says `n` = Non-profit Organization, `o` = Other, blank = Consumer Debt. In FY2025, 62,104 cases carry `n`: 40,713 are consumer cases and 61,881 have `TAXEXEMPT` = N. No case carries `o`. In practice `n` behaves like "None of the above". Use `TAXEXEMPT` (codebook p.72, collected since January 2011) for non-profit status. The petition schema uses yet another scheme (`BkPetitionCodeLists.xsd`: `o` = Tax Exempt Entity, `O` = None of the above), so never compare NOB case-insensitively.
- **As filed vs current.** `ORG*` variables are the status "as reported on the first record submitted"; the unprefixed ones are the most current record. The petition is the first record, so every petition element binds to the `ORG*` variable first. Most pairs differ in under 1% of FY2025 filings, but filing-fee status differs in 48.0%: `FEESTS` "may be updated over the life of the case" (p.43) and is blank (unknown) for 173,709 cases that `ORGFEESTS` records as paid in full. Use `ORGFEESTS`.
- **The FJC universe is wider than the petition.** The IDB covers every bankruptcy case; this IEPD covers the individual petition (B101/B105). In FY2025, 12,841 cases are non-individual debtors (`DBTRTYP` u, p or n, who file Form B201) and 203 are chapter 9 or 15. For petition-level questions, filter `dbtrtyp = 'i'`.
- **Every code value has a label, and a test checks it.** For each coded variable, `bindings.json` holds the full code list from the codebook (`codeValues`, with page). A test queries every distinct value in the loaded data and fails on any value without a label. On the full FY2025 load it found three things the codebook explains but the bindings had missed. Final dispositions N–Z: discharge withheld, dismissed for missed plan payments, filed in error, split, closed in error (p.68–69). Retired range codes: liabilities `J` = "more than $1 billion – not valid for cases filed after 11/30/2015" (p.52), still on 1 filing. Pre-2006 numeric range codes 1–8 on about 50 filings each (p.53). Two traps: the codebook prints the "no financial-management course" disposition as zero (`0`), but the data uses the letter `O`; and circuit `00` is the D.C. Circuit, while district `00` is Maine.
- **Subchapter V.** `ORGFLSUBCHP` = V marks the 2,533 FY2025 chapter 11 cases filed under Subchapter V; it binds to the petition's `Subchapter` (B101 line 13).
- **y/n casing varies by column.** FY2025 `PRFILE` is `Y`/`N`; `JOINT` and `D1FPRSE` are lowercase. Compare with `lower()`.
- **TOTLBLTS vs TOTDBT changes answers.** Across all FY2025 new filings, the share of chapter 7 filers under $50,000 in total liabilities is 31.2% with `TOTLBLTS` (12,723 zero or blank totals counted as $0) and 29.5% with `TOTDBT` (missing values excluded). For chapter 13 it is 25.3% vs 18.9% (18,093 zero or blank).
- **Rolling snapshots overlap.** `cpbank18on.txt` (Sep 2026 release) has a 09/30/2025 year-end snapshot and a rolling 06/30/2026 snapshot. The second repeats 145,740 FY2025 cases filed Jul–Sep 2025, also with `SNAPFILE = 1`. Filtering on `FILEFY = 2025` and `SNAPFILE = 1` alone gives 703,280 rows; one row per `CASEKEY` gives 557,540. Both loaders dedupe, keeping the latest snapshot.
- **Districts are codes.** `DISTRICT` uses the FJC's codes (Appendix A); the loader builds `fjc_district(code, name)` from `spokes/fjc/districts.json`.
- **Codebook line numbers are older than the forms.** The codebook says Schedule J "line 22"; the current B106J splits it into 22a–22c. `resolve "Schedule J line 22"` returns the sub-lines.

## The bundled sample

`data/sample/cpbank_fy2025_sample.tsv` is the first 20,000 FY2025 new-filing rows of `cpbank18on.txt`, **not a random sample**. It's there so the demo runs out of the box. The figures in these docs come from the full year (557,540 FY2025 new filings). Load a full year before citing a number:

```
npm run load:fjc -- data/raw/cpbank18on.txt --fy 2025 --filed-only
npm run load:databricks -- data/raw/cpbank18on.txt --fy 2025 --filed-only
```

## Coverage of all 87 FJC columns

Every column in `cpbank18on.txt` is in `spokes/fjc/bindings.json` with the codebook's definition and page, and every coded column carries its full code list (`codeValues`). Tests check that each variable resolves and that every code value in the loaded data has a label. How the 87 relate to the petition schema:

| | Columns | Examples |
| --- | --- | --- |
| Bound to a petition element | 45 | `ORGFLCHP` → BankruptcyChapter, `ORGASSTCASE` → FundsAvailableIndicator (B101 line 17), `PREPACK` → Chapter11PlanCode, `CASETYP` (B101 vs B105) |
| Not on the petition, with related petition elements | 25 | current or closing values (`ASSTCASE`, `FEESTS`, `CRNTCHP`, `CLSUBCHPT`), court-filled slots (`FILEDATE`, `ORGFLDT` → nc:DocumentFiledDate; `FLCMECFV` → the filer's software version), case links (`GEN`, `SEQ`, `ORIGIN`, `SRCCASE`, `JNTLEAD` → CaseDocketID, pending cases) |
| FJC-only, no petition counterpart | 17 | snapshot flags, closing years, both debtors' outcomes and dates (`D1FDSP`, `D2FDSPDT`), chapter 11 dividend and future payments |

`resolve` answers every one: either with the petition element, or with `element: null`, the reason it isn't on the petition, and the related elements (with NIEM definitions where no form uses them).

**Why outcomes can't be on the petition.** Each form extends NIEM's `nc:DocumentType`; only cited cases (prior, pending, affiliated, lawsuits) are `j:CaseType` with disposition slots. The schema can describe how a cited case ended, never the case being filed.

