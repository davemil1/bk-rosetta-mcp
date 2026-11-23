# Walkthrough: total liabilities

**Form.** B106Sum, *Summary of Your Assets and Liabilities and Certain Statistical Information*, line 3 ("Your total liabilities"). It totals Schedule D (line 2a) and Schedule E/F (lines 3a and 3b).

**Hub element.** `bkcmecf:TotalLiabilitiesAmount`. Definition, verbatim from the XSD: *"The sum of liabilities on the summary of schedules."* XPath: `/bkcmecf:IndividualBankruptcyPetition/bkcmecf:FormB106Sum/bkcmecf:TotalLiabilitiesAmount`.

**FJC variable.** `TOTLBLTS`: secured + priority + nonpriority, **nulls treated as zero**. A sibling, `TOTDBT`, is derived as `DSCHRGD + NDSCHRGD` and treats nulls as **missing**. Both are `confirmed` against the codebook.

**A real number** (all 557,540 FY2025 new filings):

```sql
select orgflchp,
       round(100.0*count(*) filter (where totlblts<50000)/count(*),1)               as naive_totlblts,
       round(100.0*count(*) filter (where totdbt<50000)/nullif(count(totdbt),0),1)   as totdbt
from fjc_bk where snapfile = 1 and orgflchp in ('7','13') group by 1;
```

| Chapter | Under $50k, `TOTLBLTS` | Under $50k, `TOTDBT` |
| --- | --- | --- |
| 7 | 31.2% | 29.5% |
| 13 | 25.3% | 18.9% |

The difference is 12,723 chapter 7 and 18,093 chapter 13 filers whose totals were zero or blank and count as $0 in `TOTLBLTS`. Pick a variable with that choice in mind, and say which one you used.

**What the FJC data cannot say.** It has no individual creditors or claims (Schedules D and E/F line items), so it can't tell you *whose* debt it is or of what kind, beyond the six "certain liabilities" totals summed as `NDSCHRGD` (B106Sum lines 9a–9f). Schedule totals are debtor-reported, not validated, and required only for individuals with primarily consumer debts.
