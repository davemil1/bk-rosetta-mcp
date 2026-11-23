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

## Table layout

```sql
-- A case in a federal bankruptcy court. case_key follows the FJC CASEKEY layout so it joins to fjc_bk.
create table bankruptcy_case (
  case_key   text primary key,   -- circuit + district + office + docket + generation + sequence (FJC CASEKEY)
  district   text not null,      -- FJC district code; fjc_district gives the name
  office     text,
  docket     text not null,      -- e.g. 3:12-bk-08893
  filed_date date
);

-- One submitted petition package (original, amended or supplemental).
create table petition_submission (
  submission_id text primary key,
  case_key      text references bankruptcy_case(case_key),  -- null until the court dockets an original petition
  court_name    text,           -- from the B101 header
  kind          text not null,  -- original | amended | supplemental
  iepd_release  text,           -- e.g. NG1.7
  submitted_at  timestamp
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
