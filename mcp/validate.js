// XSD validation of a bkcmecf petition against the full IEPD (extension + NIEM 2.0 imports),
// using libxml2 compiled to WebAssembly so it runs anywhere Node does.
import { validateXML } from "xmllint-wasm";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { path } from "./rosetta.js";

const SCHEMA_ROOT = path("hub/schema");
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(join(d, f.name)) : [join(d, f.name)]));
let schemaFiles;
const load = () => {
  if (schemaFiles) return schemaFiles;
  const all = walk(SCHEMA_ROOT).filter((f) => f.endsWith(".xsd"));
  const asEntry = (f) => ({ fileName: relative(SCHEMA_ROOT, f).split(sep).join("/"), contents: readFileSync(f, "utf8") });
  const main = all.find((f) => f.endsWith("BankruptcyPetition.xsd"));
  return (schemaFiles = { schema: [asEntry(main)], preload: all.filter((f) => f !== main).map(asEntry) });
};

export const FIXTURES_DIR = path("hub/fixtures");
export const listFixtures = () => readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".xml"));

export async function validatePetitionXml(xml, name = "petition.xml") {
  const { schema, preload } = load();
  const r = await validateXML({ xml: [{ fileName: name, contents: xml }], schema, preload });
  return {
    valid: r.valid,
    errorCount: r.errors.length,
    errors: r.errors.slice(0, 20).map((e) => ({ line: e.loc?.lineNumber, message: (e.message ?? e.rawMessage ?? "").trim() })),
  };
}
