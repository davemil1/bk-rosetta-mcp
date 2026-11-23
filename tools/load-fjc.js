// Load one FJC IDB bankruptcy text file (tab-delimited, header row of SAS short names)
// into PGlite table fjc_bk, keeping the columns listed in spokes/fjc/bindings.json.
// Usage: node tools/load-fjc.js <file.tsv> [--fy 2025 | 2023,2024,2025] [--filed-only]
//   --fy N[,N...] keep rows whose FILEFY is one of these fiscal years (omit for every year in the file)
//   --filed-only  keep rows with SNAPFILE == 1 (new filings in that snapshot)
import { PGlite } from "@electric-sql/pglite";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--fy");
if (!file) { console.error("usage: node tools/load-fjc.js <tab-delimited fjc file> [--fy 2025 | 2023,2024,2025] [--filed-only]"); process.exit(1); }
// --fy 2025, or a list: --fy 2023,2024,2025. Omit it to load every fiscal year in the file.
const fy = args.includes("--fy") ? new Set(args[args.indexOf("--fy") + 1].split(",").map((s) => s.trim())) : null;
const filedOnly = args.includes("--filed-only");

const bindings = JSON.parse(readFileSync("spokes/fjc/bindings.json", "utf8"));
const keep = Object.keys(bindings.variables);
const numeric = new Set(["SNAPFILE","SNAPPEND","SNAPCLOS","TOTASSTS","REALPROP","PERSPROP","TOTLBLTS","SECURED","UNSECPR","UNSECNPR","DSCHRGD","NDSCHRGD","TOTDBT","CNTMNTHI","AVGMNTHI","AVGMNTHE"]);
const db = new PGlite(process.env.FJC_DB ?? "data/fjc.pglite");
// PGlite sends the parameter count as a signed 16-bit number, so keep rows x columns under 32,767 per insert.
const BATCH = Math.floor(30000 / keep.length);
// Run from the repo root (npm run load:fjc). Column names are stored lowercase so unquoted SQL works.

await db.exec(`DROP TABLE IF EXISTS fjc_bk; CREATE TABLE fjc_bk (${keep.map((c) => `${c.toLowerCase()} ${numeric.has(c) ? "NUMERIC" : "TEXT"}`).join(", ")});`);
const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
let header = null, idx = [], iFY = -1, iSF = -1, n = 0, batch = [];
const flush = async () => {
  if (!batch.length) return;
  const vals = batch.map((r, i) => `(${r.map((_, j) => `$${i * keep.length + j + 1}`).join(",")})`).join(",");
  await db.query(`INSERT INTO fjc_bk VALUES ${vals}`, batch.flat()); batch = [];
};
for await (const line of rl) {
  const cells = line.split("\t");
  if (!header) {
    header = cells.map((h) => h.trim().toUpperCase());
    idx = keep.map((k) => header.indexOf(k));
    iFY = header.indexOf("FILEFY"); iSF = header.indexOf("SNAPFILE");
    const missing = keep.filter((k, i) => idx[i] < 0); if (missing.length) console.warn("columns not in file:", missing.join(","));
    continue;
  }
  if (fy && !fy.has(cells[iFY]?.trim())) continue;
  if (filedOnly && cells[iSF]?.trim() !== "1") continue;
  batch.push(idx.map((i, j) => { const v = i < 0 ? "" : (cells[i] ?? "").trim(); return v === "" ? null : numeric.has(keep[j]) && isNaN(Number(v)) ? null : v; }));
  n++; if (batch.length >= BATCH) await flush();
}
await flush();
const districts = JSON.parse(readFileSync("spokes/fjc/districts.json", "utf8")).districts;
await db.exec("DROP TABLE IF EXISTS fjc_district; CREATE TABLE fjc_district (code TEXT PRIMARY KEY, name TEXT);");
for (const [code, name] of Object.entries(districts)) await db.query("INSERT INTO fjc_district VALUES ($1, $2)", [code, name]);
await db.exec(`CREATE INDEX IF NOT EXISTS fjc_bk_chp ON fjc_bk (orgflchp); CREATE INDEX IF NOT EXISTS fjc_bk_key ON fjc_bk (casekey);`);
// Rolling snapshots overlap (e.g. the 06/30/2026 snapshot repeats Jul-Sep 2025 filings), so keep one row
// per CASEKEY: the latest SNAPSHOT.
const dup = await db.query(`DELETE FROM fjc_bk t USING (
  SELECT ctid, row_number() OVER (PARTITION BY casekey ORDER BY to_date(snapshot, 'MM/DD/YYYY') DESC) rn FROM fjc_bk
) d WHERE t.ctid = d.ctid AND d.rn > 1`);
if (dup.affectedRows) { n -= dup.affectedRows; console.log(`dropped ${dup.affectedRows} rows repeated in a later snapshot`); }
console.log(`loaded ${n} rows into fjc_bk (${keep.length} columns)`);
await db.close();
