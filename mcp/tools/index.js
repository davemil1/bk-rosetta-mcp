import { z } from "zod";
import { readFileSync } from "node:fs";
import { rosetta, findElement, matchElement, findFormLine, findFjcOnly, relatedFjc } from "../rosetta.js";
import { queryFjc } from "./fjc.js";
import { validatePetitionXml, listFixtures, FIXTURES_DIR } from "../validate.js";

const json = (x) => ({ content: [{ type: "text", text: JSON.stringify(x, null, 2) }] });
const MAX_FORM_ROWS = 12;

// Compact view of one hub element across all three spokes.
export function view(e) {
  const forms = e.bindings.forms ?? [];
  return {
    element: e.name,
    namespace: e.namespace ?? "bkcmecf",
    definition: e.definition,
    type: e.type,
    codeList: e.codeList ? `${e.codeList.length} values (use list_codes)` : null,
    note: e.note,
    forms: forms.slice(0, MAX_FORM_ROWS),
    formsTruncated: forms.length > MAX_FORM_ROWS ? `${forms.length - MAX_FORM_ROWS} more form fields use this element` : undefined,
    fjc: e.bindings.fjc ?? "not captured by the FJC Integrated Database",
    relatedFjc: relatedFjc(e.name).length ? relatedFjc(e.name) : undefined,
  };
}

// An FJC variable with no petition element: say so, and point at the hub elements it relates to.
function fjcOnlyView(v) {
  const { hub } = rosetta();
  return {
    variable: v.variable,
    element: null,
    fjc: [{ variable: v.variable, hub: null, form: v.form, meaning: v.meaning, status: v.status }],
    notOnPetition: v.notOnPetition,
    related: (v.related ?? []).map((n) => ({ element: n, definition: hub.elements[n]?.definition ?? null })),
  };
}

export const handlers = {
  resolve: async ({ handle }) => {
    const fjcOnly = findFjcOnly(handle);
    if (fjcOnly) return fjcOnlyView(fjcOnly);
    const line = findFormLine(handle);
    if (line?.fields) return { query: handle, formLine: { form: line.form, line: line.line, fields: line.fields }, primary: view(line.primary) };
    const m = matchElement(handle);
    if (m) return { match: m.match, ...(m.match === "fuzzy" ? { matchNote: "Best guess by word overlap, not a curated mapping. Confirm the element fits before relying on it." } : {}), ...view(m.element) };
    return { error: `no match for "${handle}"`, hint: "try a hub element name, an FJC variable (TOTLBLTS), a form line (B106Sum line 3), or a phrase like 'total debt'" };
  },

  describe_form: async ({ form, line }) => {
    const { byForm, rules } = rosetta();
    const key = Object.keys(byForm).find((f) => f.toLowerCase().replace(/[^a-z0-9]/g, "") === form.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(?!b|creditor)/, "b"));
    if (!key) return { error: `unknown form ${form}`, forms: rules.forms.map((f) => f.name) };
    const meta = rules.forms.find((f) => f.name.startsWith(key + " ") || f.name.replace(/\W/g, "").startsWith(key));
    let rows = byForm[key].map((r) => ({ line: r.line, element: r.element, definition: r.definition, required: r.required === "y" || undefined, values: r.values }));
    if (line) rows = rows.filter((r) => String(r.line ?? "").toLowerCase().split(/[,\s]+/).includes(String(line).toLowerCase()));
    return { form: key, title: meta?.name, version: meta?.version, fieldCount: rows.length, fields: rows.slice(0, 120), truncated: rows.length > 120 ? "pass line= to narrow" : undefined };
  },

  list_codes: async ({ element }) => {
    const e = findElement(element);
    if (!e?.codeList) return { error: `${element} has no code list` };
    const fjc = [].concat(e.bindings.fjc ?? []);
    return { element: e.name, codes: e.codeList, fjc: fjc.map((b) => ({ variable: b.variable, status: b.status, codes: b.codes ?? b.values, meaning: b.meaning, note: b.note, caution: b.caution })) };
  },

  check_coverage: async ({ spoke }) => {
    const { hub, fjc } = rosetta();
    const leaf = Object.values(hub.elements).filter((e) => e.bindings.forms || e.codeList || e.lineCitation);
    const covered = leaf.filter((e) => e.bindings[spoke]);
    const res = { spoke, hubElementsOnForms: leaf.length, covered: covered.length, notCovered: leaf.length - covered.length };
    if (spoke === "fjc") {
      res.coveredElements = covered.map((e) => ({ element: e.name, variables: [].concat(e.bindings.fjc).map((b) => b.variable), forms: [...new Set((e.bindings.forms ?? []).map((f) => f.form))] }));
      const byForm = {};
      for (const e of leaf) for (const f of e.bindings.forms ?? []) { const s = (byForm[f.form] ??= { fields: 0, captured: 0 }); s.fields++; if ([].concat(e.bindings.fjc ?? []).some((b) => b.form === f.form)) s.captured++; }
      res.byForm = byForm;
      res.notCaptured = fjc.notCaptured;
      res.caveats = fjc.caveats;
    } else res.coveredSample = covered.slice(0, 40).map((e) => e.name);
    return res;
  },

  query_fjc: async ({ sql }) => queryFjc(sql),

  validate_petition: async ({ xml }) => {
    let src = xml, name = "petition.xml";
    const fx = listFixtures();
    const pick = xml === "fixture" ? "NG1.6_CH7_Individual_BK_Petition_Complete.xml" : fx.find((f) => f === xml || f.replace(/\.xml$/, "") === xml);
    if (pick) { src = readFileSync(`${FIXTURES_DIR}/${pick}`, "utf8"); name = pick; }
    else if (!xml.trimStart().startsWith("<")) return { error: "pass petition XML, 'fixture', or a fixture name", fixtures: fx };
    const schema = await validatePetitionXml(src, name);
    const { hub } = rosetta();
    const forms = [...new Set([...src.matchAll(/<bkcmecf:(FormB\w+|CreditorMatrix)\b/g)].map((m) => m[1]))];
    const populated = Object.keys(hub.elements).filter((n) => src.includes(`:${n}>`));
    const statistical = populated.filter((n) => hub.elements[n].bindings.fjc).map((n) => ({ element: n, fjc: [].concat(hub.elements[n].bindings.fjc).map((b) => b.variable) }));
    return { file: name, schemaValid: schema.valid, schemaErrors: schema.errors, forms, populatedElements: populated.length, reachesFjcStatistics: statistical };
  },
};

export function registerTools(server) {
  server.tool("resolve",
    "Resolve a bankruptcy concept across all three public sources: the Official Form line, the NIEM petition schema element (hub), and the FJC Integrated Database variable. Accepts a hub element (TotalLiabilitiesAmount), an FJC variable (TOTLBLTS), a form line (B106Sum line 3, B101 Q9, Schedule I line 12), or plain words (total debt, pro se, filed before). Returns the official definition, every form field using it, and FJC bindings with confirmed/inferred status. Call this first before querying or guessing any field.",
    { handle: z.string().describe("element name, FJC variable, form line, or plain words") },
    async (a) => json(await handlers.resolve(a)));

  server.tool("describe_form",
    "List an Official Form's fields in printed order, with line numbers, schema element, definition, required flag and allowed values, from the IEPD business rules. Forms: B101, B101A, B103A, B103B, B104, B105, B106Sum, B106Dec, B106AB, B106C, B106D, B106EF, B106G, B106H, B106I, B106J, B106J2, B107, B108, B122A1, B122A2, B122B, B122C1, B122C2, B2030, CreditorMatrix.",
    { form: z.string(), line: z.string().optional().describe("only this line, e.g. 3 or 9a") },
    async (a) => json(await handlers.describe_form(a)));

  server.tool("list_codes",
    "Allowed values and definitions for a coded element (NatureOfDebtsCode, BankruptcyChapter, FilingFeeStatusCode, EstimatedAssetsCode, DebtorTypeCode...), alongside how the FJC codes the same field.",
    { element: z.string() },
    async (a) => json(await handlers.list_codes(a)));

  server.tool("check_coverage",
    "Which petition fields a spoke captures. spoke=fjc answers 'what does the FJC statistical dataset NOT know about a bankruptcy petition', with per-form counts, the explicit list of what is not captured, and the FJC's own caveats.",
    { spoke: z.enum(["forms", "fjc"]) },
    async (a) => json(await handlers.check_coverage(a)));

  server.tool("query_fjc",
    "Run one read-only SELECT against the loaded FJC IDB bankruptcy table fjc_bk (one row per case per snapshot). Columns are IDB variable names (ORGFLCHP, NTRDBT, TOTLBLTS, PRFILE, D1FPRSE, DISTRICT...); resolve any you are unsure of first. y/n flags vary in case: compare with lower(). New filings: WHERE snapfile = 1. Max 25 rows; aggregate rather than page.",
    { sql: z.string() },
    async (a) => json(await handlers.query_fjc(a)));

  server.tool("validate_petition",
    "Validate a bkcmecf petition XML against the full published IEPD schema (NIEM 2.0 imports included), then report which forms it contains and which of its fields reach the FJC statistics. Pass XML, 'fixture', or the name of a bundled official sample (NG1.6_CH13_Individual_BK_Petition_Min, NG1.7_CH11_SubV_SmallBusIsTrue, ...).",
    { xml: z.string() },
    async (a) => json(await handlers.validate_petition(a)));
}
