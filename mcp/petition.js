// Petition answers as EAV (entity-attribute-value) rows, and a plain-English reading of them.
//
//   entity     the petition submission and the Official Form the answer sits on (FormB101, FormB106D, ...)
//   attribute  the generic XPath of the question, which keys into the IEPD business-rules workbook
//              (spokes/forms/business-rules.json: form, line, rule, datatype, definition)
//   value      typed by the workbook's datatype: money, date, integer, boolean, short_text, long_text
//
// Repeats are nested (creditor 3's claim 2), so one sequence number is not enough. Each row carries the
// indexed instance path (.../bkcmecf:Creditor[3]/bkcmecf:Claim[2]/...) and `seq`, the list of indices for
// every repeatable step. Which elements repeat comes from maxOccurs in the extension schema.
import { XMLParser } from "fast-xml-parser";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { rosetta, path } from "./rosetta.js";

const local = (tag) => tag.split(":").pop();

let repeatable;
function repeatables() {
  if (repeatable) return repeatable;
  repeatable = new Set();
  const dir = path("hub/schema/extension");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".xsd"))) {
    const xsd = readFileSync(join(dir, f), "utf8");
    for (const [tag] of xsd.matchAll(/<xsd:element\b[^>]*>/g)) {
      const name = tag.match(/\b(?:ref|name)="([^"]+)"/)?.[1];
      const max = tag.match(/\bmaxOccurs="([^"]+)"/)?.[1];
      if (name && max && max !== "1") repeatable.add(local(name));
    }
  }
  return repeatable;
}

// generic XPath -> the workbook's row for that question
let catalog;
function fieldCatalog() {
  if (catalog) return catalog;
  catalog = new Map();
  for (const r of rosetta().rules.rows) if (!catalog.has(r.xpath)) catalog.set(r.xpath, r);
  return catalog;
}

const HUB_TYPE = { AmountType: "money", DateType: "date", IndicatorType: "boolean", integer: "integer", TextType: "short_text" };

function typed(datatype, text) {
  switch (datatype) {
    case "money": { const n = Number(text); return Number.isFinite(n) ? { value_money: n } : { value_text: text }; }
    case "integer": { const n = Number.parseInt(text, 10); return Number.isFinite(n) ? { value_int: n } : { value_text: text }; }
    case "boolean": return /^(true|false)$/i.test(text) ? { value_bool: text.toLowerCase() === "true" } : { value_text: text };
    case "date": return { value_date: text.slice(0, 10) };
    case "long_text": return { value_long_text: text };
    default: return { value_text: text };
  }
}

export function shredPetition(xml, submission = "petition") {
  const { hub } = rosetta();
  const rep = repeatables(), cat = fieldCatalog();
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: true, trimValues: true, parseTagValue: false, commentPropName: "#comment" });
  const rows = [];
  const tagOf = (node) => Object.keys(node).find((k) => k !== ":@" && k !== "#text" && k !== "#comment" && !k.startsWith("?"));

  const walk = (nodes, gp, ip, seq, form) => {
    const counts = {};
    for (const node of nodes) {
      const tag = tagOf(node);
      if (!tag) continue;
      const n = (counts[tag] = (counts[tag] ?? 0) + 1);
      const name = local(tag), isRep = rep.has(name);
      const g = `${gp}/${tag}`, i = `${ip}/${tag}${isRep ? `[${n}]` : ""}`;
      const s = isRep ? [...seq, { element: name, n }] : seq;
      const f = form ?? (/^Form[A-Z0-9]+|^CreditorMatrix$/.test(name) ? name : null);
      const kids = node[tag] ?? [];
      const text = kids.filter((k) => "#text" in k).map((k) => String(k["#text"])).join(" ").trim();
      if (!kids.some((k) => tagOf(k)) && text) {
        const c = cat.get(g), e = hub.elements[name];
        const datatype = c?.datatype ?? HUB_TYPE[e?.type] ?? "short_text";
        rows.push({
          submission, form: f ?? "(document)", line: c?.line ?? null, element: name, xpath: g, instance: i,
          seq: s.map((x) => x.n), repeats: s.map((x) => `${x.element} ${x.n}`).join(" > ") || null,
          datatype, ...typed(datatype, text), inCatalog: !!c, rule: c?.rule ?? null,
        });
      }
      walk(kids, g, i, s, f);
    }
  };
  walk(parser.parse(xml), "", "", [], null);
  return rows;
}

// ---- plain-English reading ---------------------------------------------------------------------------------
const money = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Even in synthetic samples, show identifiers the way a real reader should see them.
const SENSITIVE = /PersonSSNIdentification|OrganizationTaxIdentification|PersonTaxIdentification/;
const mask = (v) => v.replace(/[0-9A-Za-z](?=[^0-9A-Za-z]*(?:[0-9A-Za-z][^0-9A-Za-z]*){4})/g, "*");

function answer(row) {
  const { hub } = rosetta();
  if (SENSITIVE.test(row.xpath)) return mask(row.value_text ?? "");
  if (row.value_money !== undefined) return money(row.value_money);
  if (row.value_bool !== undefined) return row.value_bool ? "Yes" : "No";
  if (row.value_int !== undefined) return String(row.value_int);
  if (row.value_date !== undefined) return row.value_date;
  const v = row.value_text ?? row.value_long_text ?? "";
  const code = hub.elements[row.element]?.codeList?.find((c) => c.value === v);
  return code ? `${v} (${code.definition})` : v.length > 200 ? v.slice(0, 200) + "..." : v;
}

const question = (row) => {
  const { hub } = rosetta();
  return fieldCatalog().get(row.xpath)?.definition ?? hub.elements[row.element]?.definition ?? row.element;
};

function formTitle(form) {
  const key = form.replace(/^Form/, "");
  return rosetta().rules.forms.find((f) => f.name.replace(/\W/g, "").startsWith(key))?.name ?? form;
}

// The headline facts a reader wants first, each traced to its form line.
const HEADLINE = [
  ["BankruptcyChapter", "FormB101"], ["Subchapter", "FormB101"], ["DebtorTypeCode", "FormB101"], ["NatureOfDebtsCode", "FormB101"],
  ["PriorBankruptcyCaseIndicator", "FormB101"], ["FilingFeeStatusCode", "FormB101"], ["SmallBusinessIndicator", "FormB101"],
  ["EstimatedCreditorsCode", "FormB101"], ["EstimatedAssetsCode", "FormB101"], ["EstimatedLiabilitiesCode", "FormB101"],
  ["TotalPropertyValueAmount", "FormB106Sum"], ["TotalLiabilitiesAmount", "FormB106Sum"],
  ["HouseholdMonthlyIncomeAmount", "FormB106Sum"], ["HouseholdMonthlyExpenseAmount", "FormB106Sum"],
];

export function explainPetition(xml, { name = "petition", form, limit } = {}) {
  const rows = shredPetition(xml, name);
  const facts = [];
  for (const [el, f] of HEADLINE) {
    const r = rows.find((x) => x.element === el && x.form === f);
    if (r) facts.push({ fact: el, form: f, line: r.line, question: question(r), answer: answer(r), fjc: [].concat(rosetta().hub.elements[el]?.bindings.fjc ?? []).map((b) => b.variable) });
  }
  const byForm = new Map();
  for (const r of rows) (byForm.get(r.form) ?? byForm.set(r.form, []).get(r.form)).push(r);
  const wanted = form ? [...byForm.keys()].filter((f) => f.toLowerCase().replace(/^form/, "") === form.toLowerCase().replace(/^form/, "")) : [...byForm.keys()];
  const per = form ? (limit ?? 150) : (limit ?? 8);
  const forms = wanted.map((f) => {
    const rs = byForm.get(f);
    const repeated = {};
    for (const r of rs) for (const step of r.seq.length ? r.repeats.split(" > ") : []) {
      const [el, n] = [step.replace(/ \d+$/, ""), Number(step.match(/\d+$/)[0])];
      repeated[el] = Math.max(repeated[el] ?? 0, n);
    }
    return {
      form: f, title: formTitle(f), answers: rs.length, inCatalog: rs.filter((r) => r.inCatalog).length,
      repeatedItems: Object.fromEntries(Object.entries(repeated).filter(([, n]) => n > 1)),
      lines: rs.slice(0, per).map((r) => ({ line: r.line, question: question(r), answer: answer(r), ...(r.repeats ? { item: r.repeats } : {}) })),
      more: rs.length > per ? `${rs.length - per} more answers; call explain_petition with form: "${f}" to see them` : undefined,
    };
  });
  return {
    petition: name, totalAnswers: rows.length, forms: forms.length,
    case: caseReference(rows),
    headline: facts,
    byForm: forms,
    note: "Each answer is a petition value read back through its question: the generic XPath keys into the IEPD business-rules workbook for form, line and definition. Coded values are decoded through the schema's code lists. Use shred_petition for the raw EAV rows.",
  };
}

// The case this petition belongs to, and the other cases it points at. An original petition names its court
// (B101 header) but not its own docket number: the court assigns that on filing, so the link to the case,
// and through CASEKEY to the FJC record, is made after docketing. Lines 9 and 10 cite prior and pending cases.
// What a cited docket number is, by where it sits on the forms.
function relation(r) {
  if (r.xpath.includes("PendingBankruptcyCase")) return "pending bankruptcy case (spouse, partner or affiliate)";
  if (r.form === "FormB101" && r.line === "9") return "prior bankruptcy case within 8 years";
  if (r.form === "FormB107") return "lawsuit, court action or other legal proceeding (Statement of Financial Affairs)";
  return "other case";
}

function caseReference(rows) {
  const header = (r) => /Header/.test(r.line ?? "");
  const court = rows.find((r) => r.element === "CourtName" && header(r))?.value_text ?? null;
  const docket = rows.find((r) => r.element === "CaseDocketID" && header(r))?.value_text ?? null;
  const refs = rows.filter((r) => r.element === "CaseDocketID" && !header(r))
    .map((r) => ({ docket: r.value_text, form: r.form, line: r.line, relation: relation(r) }));
  return {
    court, docket,
    status: docket ? "references an existing case (amendment or later filing)" : "original filing: the court assigns the case number on docketing",
    relatedCases: refs,
    fjcLink: "case = court + docket number; the FJC CASEKEY is circuit + district + office + docket + generation + sequence",
  };
}

// EAV rows, trimmed for an MCP response: all rows for one form, or per-form counts and a sample.
export function shredForTool(xml, { name = "petition", form, limit = 200 } = {}) {
  const rows = shredPetition(xml, name);
  const pick = form ? rows.filter((r) => r.form.toLowerCase().replace(/^form/, "") === form.toLowerCase().replace(/^form/, "")) : rows;
  const counts = {};
  for (const r of rows) counts[r.form] = (counts[r.form] ?? 0) + 1;
  return {
    petition: name, totalRows: rows.length, inCatalog: rows.filter((r) => r.inCatalog).length, rowsByForm: counts,
    columns: "submission, form, line, element, xpath (attribute), instance (indexed path), seq (indices of repeatable steps), datatype, value_money | value_date | value_int | value_bool | value_text | value_long_text, inCatalog, rule",
    rows: pick.slice(0, form ? limit : 40),
    truncated: pick.length > (form ? limit : 40) ? `${pick.length - (form ? limit : 40)} more rows; pass form to page by form` : undefined,
  };
}
