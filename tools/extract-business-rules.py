"""Convert the IEPD's NGRel1.7_Individual_BK_Business_Rules.xlsx into spokes/forms/business-rules.json.

The workbook ships in the public IEPD and maps every PDF form field to its XPath in the
bkcmecf petition, with the form line, datatype, definition, business rule, required flag,
allowed values, and the error message CM/ECF returns. The JSON output is committed so the
MCP server needs no spreadsheet library at runtime. Re-run only if the workbook changes:

    python tools/extract-business-rules.py
"""
import json
import re
import warnings

import openpyxl

SRC = "hub/iepd/NGRel1.7_Individual_BK_Business_Rules.xlsx"
OUT = "spokes/forms/business-rules.json"
COLS = ["rule", "xpath", "formLine", "datatype", "definition", "ruleText", "required", "values", "errorMessage"]

warnings.filterwarnings("ignore")
wb = openpyxl.load_workbook(SRC, read_only=True)


def clean(v):
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s or None


def parse_line(form, raw):
    """'106Sum Q3' -> '3'; '101 Header,Q7' -> 'Header, 7'; 'Part 2 Q4a' kept readable."""
    if not raw:
        return None
    s = raw.replace(form.lstrip("B"), "", 1).strip() if raw.startswith(form.lstrip("B")) else raw
    s = re.sub(r"\bQ(\d+[a-z]?)", r"\1", s)
    return s.strip(" ,") or None


forms = []
for row in wb["BK_FORMS"].iter_rows(min_row=2, values_only=True):
    if row and row[0] is not None:
        forms.append({"id": row[0], "name": clean(row[1]), "version": clean(row[2]), "since": clean(row[3])})

rows = []
for ws in wb.worksheets[1:]:
    form = ws.title if ws.title == "CreditorMatrix" else (ws.title if ws.title.startswith("B") else "B" + ws.title)
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not r or len(r) < 2 or not r[1]:
            continue
        rec = {k: clean(v) for k, v in zip(COLS, r)}
        rec["form"] = form
        steps = [s for s in rec["xpath"].split("/") if s]
        leaf = steps[-1].lstrip("@")
        rec["element"] = leaf.split(":")[-1]
        rec["prefix"] = leaf.split(":")[0] if ":" in leaf else None
        rec["parent"] = steps[-2].split(":")[-1] if len(steps) > 1 else None
        rec["line"] = parse_line(form, rec["formLine"])
        rows.append({k: v for k, v in rec.items() if v is not None})

json.dump(
    {
        "spoke": "forms",
        "source": "IEPD NGRel1.7 Individual BK Data Collection, documentation/NGRel1.7_Individual_BK_Business_Rules.xlsx (public, pacer.uscourts.gov)",
        "status": "confirmed",
        "forms": forms,
        "rows": rows,
    },
    open(OUT, "w", encoding="utf-8"),
    indent=1,
    ensure_ascii=False,
)
print(f"wrote {OUT}: {len(rows)} rows, {len({r['element'] for r in rows})} distinct elements, {len(forms)} forms")
