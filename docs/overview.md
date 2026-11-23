# Overview

The same fact about a bankruptcy, such as total liabilities, exists in three public places, each with its own vocabulary:

1. **The Official Form line** the debtor fills in (B106Sum line 3).
2. **The NIEM element** in the judiciary's published petition schema, the Individual Bankruptcy Data Collection IEPD (`bkcmecf:TotalLiabilitiesAmount`).
3. **The variable** in the Federal Judicial Center's Integrated Database (`TOTLBLTS`, and its sibling `TOTDBT`).

Each is documented on its own; none points at the others. This server is the join.

**Hub and spokes.** The hub is the petition schema: every element has an official definition, and its form containers *are* the Official Forms. Two spokes bind to it:

- **forms**: the IEPD's business-rules workbook, mapping 2,197 form fields to XPaths.
- **fjc**: the IDB variables, checked against the FJC codebook.

Spokes never map to each other. A form-to-FJC answer is always a composition through the hub, so every answer carries the official definition and its provenance.

**What it's for.**

- Researchers and journalists get correct interpretation of a heavily used, often misread dataset: nulls-as-zero, codes that differ between sources, codebook lines that are older than the forms.
- Legal-aid tool builders get the court's data model without reverse-engineering it.
- An AI agent gets provenance instead of fluency: it resolves the term, quotes the definition, runs the query, and says what the data cannot tell you.

**What it is not.** It files nothing, advises no one, and generates no petitions. It's a correct, public, machine-readable statement of what a bankruptcy filing contains and how its three public representations relate.
