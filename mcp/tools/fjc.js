// FJC data backend. Same tool contract either way: one read-only SELECT, at most 25 rows.
//
//   BACKEND=pglite      (default) local PGlite file built by `npm run load:fjc`; clones and runs anywhere
//   BACKEND=databricks  a Databricks SQL warehouse over Unity Catalog tables built by `npm run load:databricks`
//
// Databricks settings (environment, or a .env file in the repo root):
//   DATABRICKS_HOST       dbc-xxxx.cloud.databricks.com
//   DATABRICKS_HTTP_PATH  /sql/1.0/warehouses/<id>   (SQL Warehouses -> your warehouse -> Connection details)
//   DATABRICKS_TOKEN      personal access token
//   FJC_CATALOG, FJC_SCHEMA   where fjc_bk and fjc_district live (e.g. users / your_name)
import { path } from "../rosetta.js";
import { databricksConfig, openDatabricks, loadDotEnv } from "../databricks.js";

const MAX = 25;
loadDotEnv();
const BACKEND = (process.env.BACKEND ?? "pglite").toLowerCase();
const withLimit = (sql) => (/\blimit\s+\d+\s*;?\s*$/i.test(sql) ? sql.replace(/;\s*$/, "") : `${sql.replace(/;\s*$/, "")} LIMIT ${MAX + 1}`);

let pg;
async function pglite(sql) {
  const { PGlite } = await import("@electric-sql/pglite");
  pg ??= new PGlite(path(process.env.FJC_DB ?? "data/fjc.pglite"));
  return (await pg.query(sql)).rows;
}

let dbx;
async function databricks(sql) {
  dbx ??= await openDatabricks(databricksConfig());
  const op = await dbx.session.executeStatement(sql, { maxRows: MAX + 1 });
  const rows = await op.fetchAll();
  await op.close();
  // BIGINT/DECIMAL come back as bigint or strings; make them JSON-safe
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
}

export const backendName = () => BACKEND;

export async function queryFjc(sql) {
  // SELECT only (no WITH: in Postgres a CTE can wrap DELETE/UPDATE). Least-privilege credentials are the real guard.
  if (!/^\s*select\b/i.test(sql) || /;\s*\S/.test(sql)) return { error: "single SELECT only" };
  try {
    const rows = await (BACKEND === "databricks" ? databricks : pglite)(withLimit(sql));
    return { backend: BACKEND, rows: rows.slice(0, MAX), truncated: rows.length > MAX };
  } catch (e) {
    return { backend: BACKEND, error: e.message, hint: BACKEND === "databricks"
      ? "check DATABRICKS_* and FJC_CATALOG/FJC_SCHEMA, and run `npm run load:databricks` once; tables are fjc_bk and fjc_district"
      : "run `npm run load:fjc -- <file>` first; tables are fjc_bk and fjc_district" };
  }
}
