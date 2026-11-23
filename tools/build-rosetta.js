// Walk hub/schema/extension/BankruptcyPetition.xsd and emit hub/rosetta.generated.json.
// One row per element: { name, forms: [{form, position}], type, definition,
// codeList: [{value, definition}] | null, lineCitation: string | null }.
import { readFileSync, writeFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

const SCHEMA = "hub/schema/extension/BankruptcyPetition.xsd";
const CODES = "hub/schema/extension/BkPetitionCodeLists.xsd";
const OUT = "hub/rosetta.generated.json";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
const asList = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const doc = (node) => node?.["xsd:annotation"]?.["xsd:documentation"] ?? null;
const local = (qname) => (qname ?? "").split(":").pop();

const schema = parser.parse(readFileSync(SCHEMA, "utf8"))["xsd:schema"];
const codes = parser.parse(readFileSync(CODES, "utf8"))["xsd:schema"];

// 1. simple types -> code lists (both files)
const codeLists = {};
for (const st of [...asList(schema["xsd:simpleType"]), ...asList(codes["xsd:simpleType"])]) {
  const enums = asList(st["xsd:restriction"]?.["xsd:enumeration"]);
  if (enums.length) codeLists[st["@name"]] = enums.map((e) => ({ value: e["@value"], definition: doc(e) }));
}
// complex types that wrap a simple code type -> same code list
const typeToCodes = {};
for (const ct of [...asList(schema["xsd:complexType"]), ...asList(codes["xsd:complexType"])]) {
  const base = local(ct["xsd:simpleContent"]?.["xsd:extension"]?.["@base"]);
  if (base && codeLists[base]) typeToCodes[ct["@name"]] = base;
}

// 2. element declarations
const elements = {};
for (const el of asList(schema["xsd:element"])) {
  const t = local(el["@type"]);
  const d = doc(el);
  const cite = d?.match(/(Schedule [A-Z\/]+ field [\w.]+|line \d+[a-z]?|section \d+\([a-z]\)(\(\d+\))?)/i)?.[0] ?? null;
  elements[el["@name"]] = {
    name: el["@name"], type: t, definition: d, forms: [],
    codeList: codeLists[t] ?? codeLists[typeToCodes[t]] ?? null,
    lineCitation: cite, bindings: { forms: null, fjc: null, experian: null },
  };
}

// 3. form containers -> which elements appear in which form, in order
const complex = Object.fromEntries(asList(schema["xsd:complexType"]).map((c) => [c["@name"], c]));
const seqRefs = (ct) => asList(ct?.["xsd:complexContent"]?.["xsd:extension"]?.["xsd:sequence"]?.["xsd:element"]).map((r) => local(r["@ref"]));
const walk = (typeName, form, pos, seen = new Set()) => {
  if (seen.has(typeName)) return pos; seen.add(typeName);
  for (const ref of seqRefs(complex[typeName])) {
    const e = elements[ref];
    if (!e) continue;
    e.forms.push({ form, position: pos++ });
    if (complex[e.type]) pos = walk(e.type, form, pos, seen);
  }
  return pos;
};
for (const [name, ct] of Object.entries(complex)) {
  const m = name.match(/^(FormB\d+[A-Za-z0-9]*?)(Type)?$/);
  if (m && seqRefs(ct).length) walk(name, m[1], 1);
}
if (complex.CreditorMatrixType) walk("CreditorMatrixType", "CreditorMatrix", 1);

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: SCHEMA, elements }, null, 2));
console.log(`wrote ${OUT}: ${Object.keys(elements).length} elements, ${Object.keys(codeLists).length} code lists`);
