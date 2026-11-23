# Hub: the Individual Bankruptcy Data Collection IEPD

Copied from the public IEPD (NGRel1.7), with the directory shape preserved so every `schemaLocation` resolves:

```
hub/schema/extension/BankruptcyPetition.xsd    the petition schema (bkcmecf)
hub/schema/extension/BkPetitionCodeLists.xsd   code lists: chapter, debtor type, fee status, nature of debts/business, estimates
hub/schema/niem-core/2.0, jxdm/4.0, structures/2.0, proxy/xsd/2.0, appinfo/2.0, county_codes/1.0, usps_states/2.0
hub/fixtures/*.xml                              the IEPD's seven synthetic sample petitions (no real debtor data)
hub/iepd/                                       IEPD README, changelog, IEPD document, and the business rules workbook
```

- `npm run build:rosetta` walks the XSD and writes `hub/rosetta.generated.json`: one row per element with its definition, type, code list, and form containers.
- `python tools/extract-business-rules.py` turns `hub/iepd/NGRel1.7_Individual_BK_Business_Rules.xlsx` into `spokes/forms/business-rules.json`. That workbook is the IEPD's own map from every PDF form field to its XPath, with form line, datatype, definition, business rule, required flag, allowed values and error message: 2,197 fields across 30 forms.

Only reviewer-initial comment lines were removed from three schema files. Nothing else was changed.
