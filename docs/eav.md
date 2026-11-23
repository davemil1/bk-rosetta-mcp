# Petition answers as EAV rows

The IEPD business-rules workbook already gives every question on the Official Forms an address: 2,197 rows of form, line, XPath, rule, required flag, allowed values and **datatype**. That makes the workbook a ready-made attribute catalog. A petition's answers can then be stored as entity-attribute-value rows without a table per form:

| EAV part | Here |
| --- | --- |
| Entity | The petition submission, and the Official Form the answer sits on (`FormB101`, `FormB106D`, ...) |
| Attribute | The question's **generic XPath**, e.g. `/bkcmecf:IndividualBankruptcyPetition/bkcmecf:FormB106D/.../bkcmecf:ClaimAmount`. It keys into the workbook for form, line, rule and definition. |
| Value | Typed by the workbook datatype: `money` (660 questions), `date` (63), `integer` (18), `boolean` (293), `short_text` (1,027), `long_text` (136) |

## Repeats are nested, so one sequence number isn't enough

The extension schema declares 457 elements with `maxOccurs` greater than 1. Repeats nest: Schedule D lists unlimited creditors, and each creditor can have several claims. "Creditor 3, claim 2" needs both indices. So each row carries two things:

- **`instance`**: the indexed path, `.../bkcmecf:Creditor[3]/bkcmecf:Claim[2]/bkcmecf:ClaimAmount`. Only steps that the schema says can repeat get an index.
- **`seq`**: the list of those indices, `[3, 2]`. Grouping on `xpath` gives "every claim amount"; filtering on a `seq` prefix gives "everything about creditor 3".

## Every petition belongs to a case

A petition is filed into a **case** in a federal bankruptcy court, so each submission carries a foreign key to that case. Three details shape the key:

- **The court is on the petition; the case number usually isn't.** The Form 101 header names the court (`j:CaseCourt/j:CourtName`). The docket number is assigned by the court *when* the petition is filed, so an original petition can't carry its own case number, and its `case_key` is null until docketing. Amended and supplemental filings belong to an existing case and carry its docket number in the header. The IEPD's amended Schedule A/B sample cites `18-BK-1234`.
- **Petitions cite other cases too.** Form 101 line 9 asks for prior bankruptcy cases within 8 years, and line 10 for pending cases of a spouse, partner or affiliate (Form 105 line 9 on an involuntary petition). The Statement of Financial Affairs (Form 107, lines 9 and 26) lists lawsuits and other proceedings. These are references to *other* cases, kept in their own table.
- **The case key is the bridge to the FJC.** The FJC's `CASEKEY` is circuit + district + office + docket number + generation + sequence. Once a submission's case is known, every answer in `petition_values` can be joined to the case's FJC record: chapter conversions, how it closed, and whether the debtor was discharged.

## People, cases and submissions

Three levels, each with its own key:

- **Submission → case.** A case collects many submissions: the original petition, then amendments (the IEPD's amended Schedule A/B sample) and supplements (its supplemental Schedules I/J sample). A submission is keyed by its own id. It carries the case key once the case is docketed, a `kind`, and an `amendment_seq` within the case.
- **Case.** A case is keyed by **district + docket number**. The year is already inside the docket number (`3:12-bk-08893` = office 3, 2012, bankruptcy, case 08893), and a docket number is unique within a district, so date filed and year are attributes, not key parts. The FJC's `CASEKEY` adds circuit, office, generation and sequence to the same docket.
- **Person → cases.** One person can have several cases over the years, in different courts, as Debtor 1 in one and Debtor 2 (a spouse in a joint case) in another. A `case_party` table links them by role.

How often successive cases happen is shaped by the Bankruptcy Code. These rules limit the **discharge**, not the filing (stated from 11 U.S.C.; check the current text before relying on them):

| New case | Earlier discharge in | Barred if the earlier case was filed within | |
| --- | --- | --- | --- |
| Chapter 7 | chapter 7 or 11 | 8 years | § 727(a)(8) |
| Chapter 7 | chapter 12 or 13 | 6 years, unless that plan paid 100%, or at least 70% in good faith | § 727(a)(9) |
| Chapter 13 | chapter 7, 11 or 12 | 4 years | § 1328(f)(1) |
| Chapter 13 | chapter 13 | 2 years | § 1328(f)(2) |

Refiling soon after a dismissal is limited separately: there's a 180-day bar after certain dismissals (§ 109(g)), and a shorter or no automatic stay when earlier cases were dismissed within a year (§ 362(c)(3)–(4)). Form 101 line 9 asks about bankruptcy cases filed in the last 8 years, the longest look-back.

**What public data can't do.** The FJC publishes no person identifier, so a debtor's successive cases can't be linked. `PRFILE` is only the debtor's own yes/no answer to line 9. Linking people across cases needs the SSN on the petition, which only the courts hold. The `debtor` table below exists for that setting and is never populated from public data.

## Table layout

```sql
-- A case in a federal bankruptcy court. case_key follows the FJC CASEKEY layout so it joins to fjc_bk.
create table bankruptcy_case (
  case_key   text primary key,   -- circuit + district + office + docket + generation + sequence (FJC CASEKEY)
  district   text not null,      -- FJC district code; fjc_district gives the name
  office     text,
  docket     text not null,      -- e.g. 3:12-bk-08893; the year (12) is inside it
  chapter    text,               -- as filed
  filed_date date,
  unique (district, docket)      -- a docket number is unique within a district
);

-- A person who files. Identity resolution needs the SSN on the petition, which only the courts hold;
-- this table is never populated from public data (the FJC publishes no person identifier).
create table debtor (
  person_id text primary key       -- surrogate id assigned by the court system
);

-- Who is a party to which case, and in what role. One person, many cases, possibly in different courts.
create table case_party (
  case_key  text not null references bankruptcy_case(case_key),
  person_id text not null references debtor(person_id),
  role      text not null,         -- debtor1 | debtor2 (joint case)
  primary key (case_key, person_id)
);

-- One submitted petition package (original, amended or supplemental).
create table petition_submission (
  submission_id text primary key,
  case_key      text references bankruptcy_case(case_key),  -- null until the court dockets an original petition
  court_name    text,           -- from the B101 header
  kind          text not null,  -- original | amended | supplemental
  amendment_seq int not null default 0,  -- 0 = original; 1, 2, ... in filing order within the case
  iepd_release  text,           -- e.g. NG1.7
  submitted_at  timestamp,
  unique (case_key, kind, amendment_seq)
);

-- Other cases a petition cites: prior and pending bankruptcies (B101 lines 9-10, B105 line 9) and lawsuits (B107).
create table petition_case_reference (
  submission_id text not null references petition_submission(submission_id),
  instance      text not null,  -- where it was cited, e.g. .../bkcmecf:PendingBankruptcyCase[1]/nc:CaseDocketID
  docket        text not null,
  relation      text not null,  -- prior bankruptcy | pending bankruptcy | lawsuit or proceeding
  primary key (submission_id, instance)
);

-- The attribute catalog: one row per question, from the IEPD workbook (already loaded on Databricks as form_lines).
create table form_fields (
  xpath      text primary key,   -- generic XPath of the question
  form       text not null,      -- B101, B106D, ...
  line       text,               -- printed line, e.g. '9' or '16a-b'
  element    text not null,      -- hub element name
  datatype   text not null,      -- money | date | integer | boolean | short_text | long_text
  required   boolean,
  rule       text,               -- IEPD business rule id, e.g. BCO-101-0102
  definition text
);

-- The answers: one row per value on a filed petition.
create table petition_values (
  submission_id   text not null references petition_submission(submission_id),
  form            text not null,
  xpath           text not null,  -- attribute; joins form_fields(xpath) for ~98% of values (no FK: NIEM sub-fields
                                  -- such as an address's county name are not separate workbook questions)
  instance        text not null,  -- indexed path, unique within a submission
  seq             int[] not null, -- indices of repeatable steps, [] if none
  value_money     numeric(14,2),
  value_date      date,
  value_int       bigint,
  value_bool      boolean,
  value_text      varchar(255),
  value_long_text text,
  primary key (submission_id, instance)
);
```

Exactly one `value_*` column is set per row, chosen by the attribute's datatype. A submission's case link runs `petition_values` → `petition_submission` → `bankruptcy_case` → `fjc_bk.casekey`.

## In the server

- **`shred_petition`** produces these rows from petition XML or one of the IEPD's seven synthetic samples. Across the samples, 85–99% of values key into the workbook by generic XPath. The rest are generic NIEM sub-fields, such as an address's county name, that the workbook doesn't list as separate questions; they carry `inCatalog: false`.
- **`explain_petition`** reads the rows back through their questions. Each answer gets its form line and question text, coded values are decoded through the schema's code lists (`c` → Consumer), money and dates are formatted, and repeats are labelled. It starts with headline facts, each with the FJC variable that would count it.

The tools return rows; they don't store them. Only synthetic sample petitions ship with the repo.

## What it makes visible

The IEPD's "complete" chapter 7 sample estimates its liabilities on Form 101 line 20 as **$1,000,000,001 – $10,000,000,000**, while its Summary of Schedules line 3 totals **$303.00**. It's test data, but that cross-form inconsistency is exactly what reading answers through their questions brings out. A rules check over the EAV rows (see the README's next steps) would flag it automatically.
