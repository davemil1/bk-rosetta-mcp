// Load the FJC data and the rosetta itself into Databricks Unity Catalog.
//
//   npm run load:databricks -- <fjc tab-delimited file> [--fy 2025] [--filed-only] [--dry-run]
//
// 1. Streams the FJC file down to the bound columns (and optionally one fiscal year / new filings),
//    so a 3.6 GB cpbank18on.txt becomes a ~100 MB upload.
// 2. Writes the rosetta as JSON lines: hub_elements, form_lines, fjc_bindings, fjc_district.
// 3. Creates volume <catalog>.<schema>.fjc_raw, uploads the files via the Files API, and builds Delta
//    tables with read_files(). Every fjc_bk column gets the FJC codebook meaning and its hub element as a
//    column comment, so the mapping is governed metadata in Unity Catalog, not just a file in this repo.
//
// --dry-run writes the upload files to data/raw/databricks/ and prints the SQL without connecting.
// Settings: see .env.example.
import { createReadStream, createWriteStream, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import { rosetta, path } from "../mcp/rosetta.js";
import { databricksConfig, openDatabricks, uploadToVolume } from "../mcp/databricks.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const fy = args.includes("--fy") ? args[args.indexOf("--fy") + 1] : null;
const filedOnly = args.includes("--filed-only");
const dryRun = args.includes("--dry-run");
if (!file) { console.error("usage: npm run load:databricks -- <fjc file> [--fy 2025] [--filed-only] [--dry-run]"); process.exit(1); }

const OUT = path("data/raw/databricks");
mkdirSync(OUT, { recursive: true });
const { hub, fjc, rules } = rosetta();
const keep = Object.keys(fjc.variables);
const NUMERIC = new Set(["SNAPFILE", "SNAPPEND", "SNAPCLOS", "TOTASSTS", "REALPROP", "PERSPROP", "TOTLBLTS", "SECURED", "UNSECPR", "UNSECNPR", "DSCHRGD", "NDSCHRGD", "TOTDBT", "CNTMNTHI", "AVGMNTHI", "AVGMNTHE"]);

// 1. filter the FJC file
const tsv = `${OUT}/fjc_bk.tsv`;
const out = createWriteStream(tsv);
let header, idx, iFY, iSF, n = 0;
for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
  const cells = line.split("\t");
  if (!header) {
    header = cells.map((h) => h.trim().toUpperCase());
    idx = keep.map((k) => header.indexOf(k)); iFY = header.indexOf("FILEFY"); iSF = header.indexOf("SNAPFILE");
    const missing = keep.filter((_, i) => idx[i] < 0); if (missing.length) console.warn("columns not in file:", missing.join(","));
    out.write(keep.join("\t") + "\n");
    continue;
  }
  if (fy && cells[iFY]?.trim() !== fy) continue;
  if (filedOnly && cells[iSF]?.trim() !== "1") continue;
  out.write(idx.map((i) => (i < 0 ? "" : (cells[i] ?? "").trim())).join("\t") + "\n");
  n++;
}
await new Promise((r) => out.end(r));
console.log(`filtered ${n} rows -> ${tsv}`);

// 2. the rosetta as JSON lines
const jsonl = (name, rows) => { writeFileSync(`${OUT}/${name}.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n"); return name; };
const tables = [
  jsonl("hub_elements", Object.values(hub.elements).map((e) => ({
    element: e.name, namespace: e.namespace ?? "bkcmecf", definition: e.definition, type: e.type,
    code_list: e.codeList ? JSON.stringify(e.codeList) : null,
    forms: [...new Set((e.bindings.forms ?? []).map((f) => f.form).filter(Boolean))].join(","),
    fjc_variables: [].concat(e.bindings.fjc ?? []).map((b) => b.variable).join(",") || null }))),
  jsonl("form_lines", rules.rows.map((r) => ({ form: r.form, line: r.line ?? null, form_line: r.formLine ?? null, element: r.element,
    xpath: r.xpath, definition: r.definition ?? null, datatype: r.datatype ?? null, required: r.required === "y",
    allowed_values: r.values ?? null, business_rule: r.ruleText ?? null, rule_id: r.rule ?? null }))),
  jsonl("fjc_bindings", Object.entries(fjc.variables).flatMap(([v, b]) => [].concat(b.hub ?? [null]).map((h) => ({
    variable: v, hub_element: h ? h.replace(/^[a-z]+:/, "") : null, form: b.form ?? null, meaning: b.meaning ?? null,
    codes: b.codes ?? null, caution: b.caution ?? null, status: b.status,
    not_on_petition: b.notOnPetition ?? null, related: b.related ?? [] })))),
  jsonl("fjc_district", Object.entries(JSON.parse(readFileSync(path("spokes/fjc/districts.json"), "utf8")).districts).map(([code, name]) => ({ code, name }))),
];

// 3. SQL
const q = (s) => `'${String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const vol = (c, f) => `/Volumes/${c.catalog}/${c.schema}/${c.volume}/${f}`;
const sqlFor = (c) => [
  `CREATE VOLUME IF NOT EXISTS ${c.volume} COMMENT 'Raw uploads for bk-rosetta-mcp'`,
  `CREATE OR REPLACE TABLE fjc_bk COMMENT 'FJC Integrated Database, bankruptcy petitions (BPNS). One row per case: rolling snapshots overlap, so each CASEKEY keeps its latest SNAPSHOT. Source: fjc.gov. Joined to the bankruptcy petition IEPD by bk-rosetta-mcp.' AS
   SELECT ${keep.map((k) => (NUMERIC.has(k) ? `try_cast(${k} AS DOUBLE) AS ${k.toLowerCase()}` : `nullif(${k}, '') AS ${k.toLowerCase()}`)).join(", ")}
   FROM read_files('${vol(c, "fjc_bk.tsv.gz")}', format => 'csv', sep => '\\t', header => true, inferColumnTypes => false)
   QUALIFY row_number() OVER (PARTITION BY CASEKEY ORDER BY to_date(SNAPSHOT, 'MM/dd/yyyy') DESC) = 1`,
  ...tables.map((t) => `CREATE OR REPLACE TABLE ${t} AS SELECT * FROM read_files('${vol(c, t + ".jsonl")}', format => 'json')`),
  `COMMENT ON TABLE hub_elements IS 'Every element of the judiciary''s published NIEM bankruptcy petition schema (IEPD NGRel1.7), with official definition and code list'`,
  `COMMENT ON TABLE form_lines IS 'Official Form field -> petition XPath, line, rule, required flag (IEPD business rules workbook)'`,
  `COMMENT ON TABLE fjc_bindings IS 'FJC IDB variable -> petition schema element, checked against the FJC codebook (rev. 02/28/2023)'`,
  `COMMENT ON TABLE fjc_district IS 'FJC district codes (codebook Appendix A)'`,
  ...keep.map((k) => { const b = fjc.variables[k]; const h = [].concat(b.hub ?? []).join(" + ");
    return `ALTER TABLE fjc_bk ALTER COLUMN ${k.toLowerCase()} COMMENT ${q(`${b.meaning ?? ""}${h ? ` | petition: ${h}` : ""}${b.form ? ` (${b.form})` : ""}${b.caution ? ` | CAUTION: ${b.caution}` : ""}${b.notOnPetition ? ` | not on the petition: ${b.notOnPetition}${b.related?.length ? ` Related: ${b.related.join(", ")}` : ""}` : ""}`.slice(0, 1000))}`; }),
];

if (dryRun) {
  const c = { catalog: "<catalog>", schema: "<schema>", volume: "fjc_raw" };
  writeFileSync(`${OUT}/load.sql`, sqlFor(c).join(";\n\n") + ";\n");
  console.log(`dry run: files and SQL in ${OUT} (${tables.length + 1} tables)`);
  process.exit(0);
}

const c = databricksConfig();
const db = await openDatabricks(c);
const run = async (s) => { const op = await db.session.executeStatement(s); await op.fetchAll(); await op.close(); };
const statements = sqlFor(c);
await run(statements[0]);
// Gzip the FJC extract: a full year is ~140 MB raw and times out a single Files API PUT; read_files reads .gz natively.
writeFileSync(`${OUT}/fjc_bk.tsv.gz`, gzipSync(readFileSync(tsv)));
for (const f of ["fjc_bk.tsv.gz", ...tables.map((t) => t + ".jsonl")]) console.log("uploaded", await uploadToVolume(c, `${OUT}/${f}`, f));
for (const s of statements.slice(1)) await run(s);
const check = await db.session.executeStatement("SELECT count(*) AS n FROM fjc_bk");
console.log(`fjc_bk: ${(await check.fetchAll())[0].n} rows in ${c.catalog}.${c.schema}; rosetta tables: ${tables.join(", ")}`);
await check.close();
await db.close();
