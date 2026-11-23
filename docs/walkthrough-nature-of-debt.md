# Walkthrough: nature of debt

**Form.** B101 *Voluntary Petition for Individuals*, line 16 ("What kind of debts do you have?"): 16a consumer, 16b business, 16c other. The workbook cites it as `101 Q16a-b`. The same element is on B105 (involuntary petition) line 8.

**Hub element.** `bkcmecf:NatureOfDebtsCode`: *"A code representation that describes the debts incurred by the debtor."* Allowed values from `BkPetitionCodeLists.xsd`: `b` Business, `c` Consumer, `o` Other.

The IEPD business rule for B101: *"a) Nature of debts code is required. b) Nature of debt must be: b, c, o c) If BankruptcyChapter is 12, NatureOfDebtsCode must be 'b'."* On B105 only `b` and `c` are allowed.

**FJC variable.** `NTRDBT`, with the **same codes**: b, c, o; blank for chapter 15. This is one of several fields where the IDB carries the petition's code values unchanged.

**A real number** (bundled sample, top five districts by filings):

```sql
select d.name, count(*) n,
       round(100.0*avg(case when lower(b.ntrdbt)='c' then 1 else 0 end),1) consumer_pct
from fjc_bk b join fjc_district d on d.code = b.district
group by 1 order by n desc limit 5;
```

| District | Filings | Consumer |
| --- | --- | --- |
| California - Central | 1,000 | 93.8% |
| Florida - Middle | 904 | 94.0% |
| Illinois - Northern | 832 | 95.4% |
| Georgia - Northern | 690 | 95.2% |
| Michigan - Eastern | 666 | 98.5% |

Nationally in the sample: 19,064 consumer, 881 business, 50 other.

**Watch out: the neighbouring field doesn't line up.** `NOB` (nature of *business*) does **not** share the hub's codes. In the schema, `o` = Tax Exempt Entity and `O` = None of the above. In the IDB, `o` = Other and `n` = Non-profit. `list_codes NatureOfBusinessCode` shows both side by side.
