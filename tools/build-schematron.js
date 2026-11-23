// Generate ISO Schematron from the IEPD business-rules workbook: npm run build:schematron
//
// Writes hub/rules/business-rules.sch. XPath 1.0 (queryBinding "xslt"), so any Schematron processor runs it.
//
//   generated   one pattern per Official Form. Workbook rows marked required become existence asserts in the
//               parent's context; rows with allowed values become value-list asserts. Every assert carries the
//               workbook rule id and the workbook's own error message.
//   hand-made   cross-field rules the workbook states in English (chapter 12 must be business debt, SSN/EIN
//               formats), and consistency warnings between the Form 101 estimate ranges and the Form 106Sum
//               schedule totals.
//
// Value lists in the workbook come as "7,11,12,13", "p - paid in full i - ..." or "b = business c = ...". For
// the label formats only tokens that are real codes in the schema's code list are kept, so "A = 1 - 49" yields A
// and not 1. Lists that can't be parsed safely are skipped and counted, never guessed.
import { mkdirSync, writeFileSync } from "node:fs";
import { rosetta, path } from "../mcp/rosetta.js";

const { rules, hub } = rosetta();
const NS = {
  bkcmecf: "http://cmecf.td.oca.ao.dcn/niem/bankruptcy/cmecf/1.0",
  nc: "http://niem.gov/niem/niem-core/2.0",
  j: "http://niem.gov/niem/domains/jxdm/4.0",
  s: "http://niem.gov/niem/structures/2.0",
  usps: "http://niem.gov/niem/usps_states/2.0",
  bank: "http://cmecf.td.oca.ao.dcn/niem/bankruptcy/codes/1.0",
  cmecfcodes: "http://cmecf.td.oca.ao.dcn/niem/cmecf/codes/1.0",
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\s+/g, " ").trim();
const lit = (v) => (v.includes("'") ? `"${v}"` : `'${v}'`);
const parent = (x) => x.slice(0, x.lastIndexOf("/"));
const last = (x) => x.slice(x.lastIndexOf("/") + 1);
const formOf = (r) => r.form;

function allowedValues(r) {
  const raw = r.values.trim();
  const hubCodes = (hub.elements[r.element]?.codeList ?? []).map((c) => c.value).filter(Boolean);
  if (!/[=]|\s-\s/.test(raw)) {
    const list = raw.split(",").map((v) => v.trim()).filter(Boolean);
    return list.length && list.every((v) => /^[\w.$-]+$/.test(v)) ? list : null;
  }
  if (!hubCodes.length) return null;
  const tokens = [...raw.matchAll(/(?:^|[\s:])([^\s:]+)\s+[-=]\s/g)].map((m) => m[1]);
  const codes = [...new Set(tokens.filter((t) => hubCodes.includes(t)))];
  return codes.length ? codes : null;
}

// ---- generated patterns, one per form -------------------------------------------------------------------
const patterns = new Map(); // form -> Map(context -> [assert xml])
const add = (form, context, xml) => {
  const p = patterns.get(form) ?? patterns.set(form, new Map()).get(form);
  (p.get(context) ?? p.set(context, []).get(context)).push(xml);
};
const stats = { required: 0, values: 0, skipped: [] };

for (const r of rules.rows) {
  const msg = esc(r.errorMessage && !/^Default error message/i.test(r.errorMessage) ? r.errorMessage : r.ruleText || `${r.element} on ${r.form} line ${r.line}`);
  if (r.required === "y") {
    add(formOf(r), parent(r.xpath), `<assert id="${r.rule}-required" test="${last(r.xpath)}" role="error">${r.rule}: ${msg}</assert>`);
    stats.required++;
  }
}

// Allowed values, one assert per XPath. Several workbook rows can share an XPath, one per printed item
// (line 28: Federal, State, Local tax refunds), each listing only its own value; their lists are merged,
// otherwise every instance would break the others' rule.
const valueRows = new Map();
for (const r of rules.rows.filter((r) => r.values)) (valueRows.get(r.xpath) ?? valueRows.set(r.xpath, []).get(r.xpath)).push(r);
for (const [xpath, rs] of valueRows) {
  const lists = rs.map((r) => [r, allowedValues(r)]);
  for (const [r, codes] of lists) if (!codes) stats.skipped.push(r.rule);
  const codes = [...new Set(lists.flatMap(([, c]) => c ?? []))];
  if (!codes.length) continue;
  const ids = rs.filter((r) => allowedValues(r)).map((r) => r.rule);
  const r = rs[0];
  const msg = rs.length > 1 ? `${r.element} on ${r.form} line ${[...new Set(rs.map((x) => x.line))].join(", ")}`
    : esc(r.errorMessage && !/^Default error message/i.test(r.errorMessage) ? r.errorMessage : r.ruleText || `${r.element} on ${r.form} line ${r.line}`);
  add(formOf(r), xpath, `<assert id="${ids[0]}-values" test="${esc(codes.map((c) => `. = ${lit(c)}`).join(" or "))}" role="error">${ids.join(", ")}: ${msg} Allowed: ${esc(codes.join(", "))}.</assert>`);
  stats.values++;
}

// ---- hand-made cross-field rules -------------------------------------------------------------------------
const xp = (rule) => rules.rows.find((r) => r.rule === rule)?.xpath;
const B101 = "/bkcmecf:IndividualBankruptcyPetition/bkcmecf:FormB101";
const rel = (x) => x.replace(`${B101}/`, "");
const chapter = xp("BCO-101-0004"), debts = xp("BCO-101-0102");
const sumPath = (el) => hub.elements[el].bindings.forms.find((f) => f.form === "B106Sum").xpath;

// ranges from the schema's code-list definitions, e.g. "$50,001 - $100,000", "$50,000,001 or more"
function ranges(el) {
  return (hub.elements[el].codeList ?? []).filter((c) => c.value).map((c) => {
    const n = [...c.definition.matchAll(/\$?([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    return { code: c.value, min: n[0] ?? 0, max: /more/i.test(c.definition) ? null : n[1] ?? n[0] };
  });
}
// The total is inlined as number(path) rather than a <let> variable: engines bind let values differently
// (node-schematron's XPath 3.1 evaluator rejects not($var) on them), and an inlined path works everywhere.
const rangeTest = (el, path) => ranges(el).map((g) => `(. = ${lit(g.code)} and number(${path}) &gt;= ${g.min}${g.max === null ? "" : ` and number(${path}) &lt;= ${g.max}`})`).join(" or ");

const crossField = `
  <pattern id="cross-field">
    <title>Cross-field rules the workbook states in English, translated by hand</title>
    <rule context="${B101}">
      <assert id="BCO-101-0102-c" test="not(${rel(chapter)} = '12') or ${rel(debts)} = 'b'" role="error">BCO-101-0102 c): For a chapter 12 case, the nature of debt must be business.</assert>
    </rule>
    <rule context="//nc:PersonSSNIdentification/nc:IdentificationID">
      <assert id="BCO-101-0014-a" test="translate(normalize-space(.), '0123456789', '9999999999') = '999-99-9999'" role="error">BCO-101-0014 a): SSN/ITIN format must be xxx-xx-xxxx.</assert>
    </rule>
    <rule context="//nc:OrganizationTaxIdentification/nc:IdentificationID">
      <assert id="BCO-101-0016-a" test="translate(normalize-space(.), '0123456789', '9999999999') = '99-9999999'" role="error">BCO-101-0016 a): EIN format must be xx-xxxxxxx.</assert>
    </rule>
  </pattern>

  <pattern id="consistency">
    <title>Consistency warnings between the Form 101 estimates and the Form 106Sum schedule totals (not workbook rules)</title>
    <rule context="${xp("BCO-101-0108") ?? `${B101}/bkcmecf:EstimatedLiabilitiesCode`}">
      <assert id="XF-estimated-liabilities" test="not(${sumPath("TotalLiabilitiesAmount")}) or ${rangeTest("EstimatedLiabilitiesCode", sumPath("TotalLiabilitiesAmount"))}" role="warning">Form 101 line 20 estimates liabilities as range <value-of select="."/>, but Form 106Sum line 3 totals <value-of select="${sumPath("TotalLiabilitiesAmount")}"/>.</assert>
    </rule>
    <rule context="${xp("BCO-101-0107") ?? `${B101}/bkcmecf:EstimatedAssetsCode`}">
      <assert id="XF-estimated-assets" test="not(${sumPath("TotalPropertyValueAmount")}) or ${rangeTest("EstimatedAssetsCode", sumPath("TotalPropertyValueAmount"))}" role="warning">Form 101 line 19 estimates assets as range <value-of select="."/>, but Form 106Sum line 1c totals <value-of select="${sumPath("TotalPropertyValueAmount")}"/>.</assert>
    </rule>
  </pattern>`;

// ---- write ------------------------------------------------------------------------------------------------
const body = [...patterns].map(([form, ctx]) => `
  <pattern id="${form}">
    <title>${esc(rules.forms.find((f) => f.name.replace(/\W/g, "").startsWith(form))?.name ?? form)}</title>
${[...ctx].map(([c, asserts]) => `    <rule context="${c}">\n${asserts.map((a) => `      ${a}`).join("\n")}\n    </rule>`).join("\n")}
  </pattern>`).join("\n");

const sch = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Business rules of the Individual Bankruptcy Data Collection IEPD, as ISO Schematron.
  GENERATED by tools/build-schematron.js from spokes/forms/business-rules.json (the IEPD's business-rules
  workbook). Do not hand-edit; change the generator and run npm run build:schematron.

  ${stats.required} required-field asserts and ${stats.values} allowed-value asserts, one pattern per form, each with its
  workbook rule id. ${stats.skipped.length} value lists could not be parsed safely and are skipped: ${stats.skipped.join(", ") || "none"}.
  The cross-field pattern translates rules the workbook states in English. The consistency pattern adds warnings
  that are not workbook rules. The workbook's other conditional rules are not yet translated.
-->
<schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt">
  <title>IEPD business rules (bkcmecf individual bankruptcy petition)</title>
${Object.entries(NS).map(([p, u]) => `  <ns prefix="${p}" uri="${u}"/>`).join("\n")}
${body}
${crossField}
</schema>
`;
mkdirSync(path("hub/rules"), { recursive: true });
writeFileSync(path("hub/rules/business-rules.sch"), sch);
console.log(`wrote hub/rules/business-rules.sch: ${patterns.size} form patterns, ${stats.required} required + ${stats.values} value asserts, ${stats.skipped.length} skipped, + cross-field and consistency patterns`);
