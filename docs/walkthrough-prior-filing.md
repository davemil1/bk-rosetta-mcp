# Walkthrough: prior filing

**Form.** B101 line 9: "Have you filed for bankruptcy within the last 8 years?" The same element appears on B103B (fee waiver application) line 20.

**Hub element.** `bkcmecf:PriorBankruptcyCaseIndicator`: *"Indicator set to true if the debtor had a prior Bankruptcy case."* Required, `true`/`false`. The IEPD rule adds that on B105 (involuntary) it cannot be true.

**FJC variable.** `PRFILE`: y/n, prior bankruptcy in the previous 8 years **as reported on the petition**. It's the debtor's own answer, not a docket match. In FY2025 the values are uppercase `Y`/`N` although the codebook documents lowercase, so compare with `lower()`.

**A real number** (bundled sample, new filings):

```sql
select orgflchp, count(*) n,
       round(100.0*avg(case when lower(prfile)='y' then 1 else 0 end),1) prior_pct
from fjc_bk where snapfile = 1 and orgflchp in ('7','13') group by 1;
```

| Chapter | Filings | Reported a prior filing |
| --- | --- | --- |
| 7 | 12,389 | 6.3% |
| 13 | 7,259 | 32.7% |
| All | 20,000 | 16.0% |

A third of chapter 13 filers say they have filed before, five times the chapter 7 rate.

**What the FJC data cannot say.** The petition asks for each prior case's court, filing date and case number (B101 line 9). The IDB keeps only the flag, so you can't link a filer to the earlier case, measure the gap between filings, or check the self-report against the docket.
