// Shared loader: hub + spokes, joined in memory. Regenerate the hub with `npm run build:rosetta`.
//
//   hub        hub/rosetta.generated.json        every element of BankruptcyPetition.xsd, with definition + code list
//   forms      spokes/forms/business-rules.json  the IEPD's own form-field -> XPath workbook (2,197 rows, 30 forms)
//   fjc        spokes/fjc/bindings.json          FJC IDB variable -> hub element, checked against the FJC codebook
//   synonyms   spokes/synonyms.json              plain-language phrases -> hub element (for resolve)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

export const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
export const path = (p) => resolvePath(ROOT, p);
const read = (p) => JSON.parse(readFileSync(path(p), "utf8"));
const strip = (n) => (n ?? "").replace(/^[a-z]+:/, "");

let cache;
export function rosetta() {
  if (cache) return cache;
  const hub = read("hub/rosetta.generated.json");
  const fjc = read("spokes/fjc/bindings.json");
  const rules = read("spokes/forms/business-rules.json");
  const synonyms = read("spokes/synonyms.json").phrases;

  // NIEM-core / jxdm elements the petition reuses (PersonGivenName, USCountyCode, ...) are not
  // declared in the extension schema; give them a hub row so every form field resolves.
  for (const r of rules.rows) {
    if (hub.elements[r.element]) continue;
    hub.elements[r.element] = {
      name: r.element, type: r.datatype ?? null, namespace: r.prefix, definition: r.definition ?? null,
      forms: [], codeList: null, lineCitation: null, bindings: { forms: null, fjc: null, experian: null },
      note: `NIEM ${r.prefix === "j" ? "Justice (jxdm 4.0)" : "Core 2.0"} element reused by the petition`,
    };
  }

  // forms spoke: every workbook row for an element, so a field used on many forms lists them all
  for (const r of rules.rows) {
    const e = hub.elements[r.element];
    const b = { form: r.form, line: r.line ?? null, formLine: r.formLine ?? null, xpath: r.xpath, rule: r.rule,
      required: r.required === "y" || undefined, values: r.values, businessRule: r.ruleText, errorMessage: r.errorMessage,
      status: "confirmed", source: "IEPD business rules workbook" };
    (e.bindings.forms ??= []).push(Object.fromEntries(Object.entries(b).filter(([, v]) => v != null)));
    if (!e.definition && r.definition) e.definition = r.definition;
  }
  // containers (BankruptcyDebtor2, DebtorAttorney, ...): one binding per form, from the XPaths of the fields beneath them
  for (const e of Object.values(hub.elements)) {
    if (e.bindings.forms) continue;
    const seg = `:${e.name}/`, seen = new Set();
    const under = rules.rows.filter((r) => r.xpath.includes(seg) && !seen.has(r.form) && seen.add(r.form));
    if (under.length) e.bindings.forms = under.map((r) => ({ form: r.form, formLine: r.formLine, line: r.line,
      xpath: r.xpath.slice(0, r.xpath.indexOf(seg) + seg.length - 1), container: true, status: "confirmed", source: "IEPD business rules workbook" }));
  }
  for (const e of Object.values(hub.elements))
    if (!e.bindings.forms && e.lineCitation) e.bindings.forms = [{ citation: e.lineCitation, status: "confirmed", source: "XSD documentation" }];

  // NIEM containers the FJC binds to (j:Attorney, j:CaseCourt): build a row from the workbook XPaths beneath them
  for (const b of Object.values(fjc.variables)) for (const h of [].concat(b.hub ?? [])) {
    if (hub.elements[strip(h)] || !h.includes(":")) continue;
    const under = rules.rows.filter((r) => r.xpath.includes(`/${h}/`));
    if (!under.length) continue;
    const seen = new Set();
    hub.elements[strip(h)] = {
      name: strip(h), namespace: h.split(":")[0], type: "container", forms: [], codeList: null, lineCitation: null,
      definition: h === "j:Attorney" ? "An attorney representing the debtor (NIEM jxdm 4.0). On B101 its presence is the attorney signature block; its absence means the debtor filed pro se." : `NIEM ${h} container reused by the petition`,
      note: `NIEM container; fields beneath it: ${[...new Set(under.map((r) => r.element))].slice(0, 8).join(", ")}`,
      bindings: { forms: under.filter((r) => !seen.has(r.form) && seen.add(r.form)).map((r) => ({ form: r.form, formLine: r.formLine, line: r.line, xpath: r.xpath.slice(0, r.xpath.indexOf(`/${h}/`) + h.length + 1), status: "confirmed", source: "IEPD business rules workbook" })), fjc: null, experian: null },
    };
  }

  // fjc spoke
  for (const [v, b] of Object.entries(fjc.variables)) for (const h of [].concat(b.hub ?? [])) {
    const e = hub.elements[strip(h)]; if (!e) continue;
    (e.bindings.fjc ??= []).push({ variable: v, ...b, hub: h });
  }

  // form -> ordered rows (workbook order is the order of fields on the printed form)
  const byForm = {};
  for (const r of rules.rows) (byForm[r.form] ??= []).push(r);

  cache = { hub, fjc, rules, synonyms, byForm };
  return cache;
}

// "B106Sum line 3", "106Sum Q3", "B101 Q7", "Schedule I line 12", "B122A-1 line 11"
const SCHEDULE = { A: "B106AB", B: "B106AB", "A/B": "B106AB", C: "B106C", D: "B106D", E: "B106EF", F: "B106EF", "E/F": "B106EF", G: "B106G", H: "B106H", I: "B106I", J: "B106J" };
export function parseFormLine(handle) {
  const h = handle.trim();
  let m = h.match(/^schedule\s+([A-J](?:\/[A-J])?)\b.*?(?:line|q|field)\s*#?\s*(\d+[a-z]?)/i);
  if (m) return { form: SCHEDULE[m[1].toUpperCase()], line: m[2].toLowerCase() };
  m = h.match(/^(?:form\s+)?b?\s*(\d{3,4}[a-z0-9-]*?)\s*(?:,|\s)\s*(?:part\s*\d+\s*,?\s*)?(?:line|q|question|#)\s*(\d+[a-z]?)$/i);
  if (!m) return null;
  const code = m[1].replace(/-/g, "").toLowerCase();
  const form = Object.keys(rosetta().byForm).find((f) => f.toLowerCase().replace(/^b/, "") === code);
  return form ? { form, line: m[2].toLowerCase() } : null;
}

export function findFormLine(handle) {
  const p = parseFormLine(handle); if (!p) return null;
  const { byForm, hub } = rosetta();
  const lines = (r) => (r.line ?? "").toLowerCase().split(/[,\s]+/);
  let rows = byForm[p.form].filter((r) => lines(r).includes(p.line));
  // "line 22" when the form now has 22a/22b/22c: return the sub-lines (the FJC codebook cites older line numbers)
  if (!rows.length && /^\d+$/.test(p.line)) rows = byForm[p.form].filter((r) => lines(r).some((l) => new RegExp(`^${p.line}[a-z]$`).test(l)));
  if (!rows.length) return { form: p.form, line: p.line, error: "no field on that line in the IEPD business rules" };
  return { form: p.form, line: p.line, fields: rows.map((r) => ({ element: r.element, xpath: r.xpath, definition: r.definition })),
    primary: hub.elements[rows.find((r) => hub.elements[r.element]?.bindings.fjc)?.element ?? rows[rows.length - 1].element] };
}

// FJC variables with no petition element (snapshot flags, docket events, FJC-derived totals). Matched by
// variable name or an exact `aka` phrase only, so they never take a plain-language match from the hub.
export function findFjcOnly(handle) {
  const { fjc } = rosetta();
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const h = handle.trim(), q = norm(h);
  const hit = Object.entries(fjc.variables).find(([v, b]) => !b.hub && (v === h.toUpperCase() || (b.aka ?? []).some((a) => norm(a) === q)));
  return hit ? { variable: hit[0], ...hit[1] } : null;
}

// FJC-only variables that point at a hub element through `related`.
export function relatedFjc(element) {
  const { fjc } = rosetta();
  return Object.entries(fjc.variables).filter(([, b]) => !b.hub && (b.related ?? []).includes(element))
    .map(([variable, b]) => ({ variable, meaning: b.meaning, notOnPetition: b.notOnPetition }));
}

export function findElement(handle) {
  return matchElement(handle)?.element ?? null;
}

// Whole-word containment: "unsecured debt" must not match the phrase "secured debt", nor "care" the word "car".
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const hasPhrase = (text, phrase) => ` ${text} `.includes(` ${phrase} `);

// Returns { element, match } where match says how sure the answer is:
// exact (element name, FJC variable or form line), synonym (curated phrase), or fuzzy (word overlap; a guess).
export function matchElement(handle) {
  const { hub, fjc, synonyms } = rosetta();
  const h = handle.trim();
  if (hub.elements[strip(h)]) return { element: hub.elements[strip(h)], match: "exact" };
  const byVar = fjc.variables[h.toUpperCase()];
  if (byVar?.hub) { const first = strip([].concat(byVar.hub)[0]); if (hub.elements[first]) return { element: hub.elements[first], match: "exact" }; }
  const fl = findFormLine(h); if (fl?.primary) return { element: fl.primary, match: "exact" };

  const q = norm(h);
  const syn = synonyms[q] ?? Object.entries(synonyms).find(([k]) => hasPhrase(q, norm(k)))?.[1];
  if (syn && hub.elements[syn]) return { element: hub.elements[syn], match: "synonym" };

  const needle = q.replace(/ /g, "");
  const all = Object.values(hub.elements);
  const exactName = all.find((e) => e.name.toLowerCase() === needle);
  if (exactName) return { element: exactName, match: "exact" };
  const words = q.split(" ").filter((w) => w.length > 1);
  const score = (e) => { const hay = norm(e.name.replace(/([A-Z])/g, " $1") + " " + (e.definition ?? ""));
    return words.filter((w) => hasPhrase(hay, w) || hasPhrase(hay, w + "s")).length + (e.bindings.fjc ? 0.5 : 0) + (e.bindings.forms ? 0.25 : 0); };
  const best = all.map((e) => [score(e), e]).filter(([s]) => s >= Math.max(1, words.length)).sort((a, b) => b[0] - a[0])[0]?.[1];
  return best ? { element: best, match: "fuzzy" } : null;
}
