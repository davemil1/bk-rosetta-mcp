import { PGlite } from "@electric-sql/pglite";
import { path } from "../rosetta.js";
let db;
export async function queryFjc(sql) {
  if (!/^\s*select\b/i.test(sql) || /;\s*\S/.test(sql)) return { error: "single SELECT only" };
  db ??= new PGlite(path(process.env.FJC_DB ?? "data/fjc.pglite"));
  try {
    const r = await db.query(sql.includes("limit") || sql.includes("LIMIT") ? sql : `${sql.replace(/;\s*$/, "")} LIMIT 25`);
    return { rows: r.rows.slice(0, 25), truncated: r.rows.length > 25 };
  } catch (e) { return { error: e.message, hint: "run `npm run load:fjc -- <file>` first; table is fjc_bk" }; }
}
