// Databricks connection shared by the MCP backend (mcp/tools/fjc.js) and the loader (tools/load-databricks.js).
import { readFileSync, existsSync } from "node:fs";
import { path } from "./rosetta.js";

// Minimal .env support so credentials never need to be in .mcp.json or the shell history.
function loadDotEnv() {
  const f = path(".env");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function databricksConfig() {
  loadDotEnv();
  const c = {
    host: (process.env.DATABRICKS_HOST ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
    path: process.env.DATABRICKS_HTTP_PATH,
    token: process.env.DATABRICKS_TOKEN,
    catalog: process.env.FJC_CATALOG,
    schema: process.env.FJC_SCHEMA,
    volume: process.env.FJC_VOLUME ?? "fjc_raw",
  };
  const missing = Object.entries({ DATABRICKS_HOST: c.host, DATABRICKS_HTTP_PATH: c.path, DATABRICKS_TOKEN: c.token, FJC_CATALOG: c.catalog, FJC_SCHEMA: c.schema })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`missing Databricks settings: ${missing.join(", ")} (set them in .env; see .env.example)`);
  return c;
}

export async function openDatabricks(c) {
  const { DBSQLClient } = await import("@databricks/sql");
  const client = new DBSQLClient();
  await client.connect({ host: c.host, path: c.path, token: c.token });
  const session = await client.openSession({ initialCatalog: c.catalog, initialSchema: c.schema });
  return { client, session, close: async () => { await session.close(); await client.close(); } };
}

// Upload a local file to a Unity Catalog volume through the Files API.
export async function uploadToVolume(c, localFile, name) {
  const target = `/Volumes/${c.catalog}/${c.schema}/${c.volume}/${name}`;
  const res = await fetch(`https://${c.host}/api/2.0/fs/files${target}?overwrite=true`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/octet-stream" },
    body: readFileSync(localFile),
  });
  if (!res.ok) throw new Error(`upload ${name} failed: ${res.status} ${await res.text()}`);
  return target;
}
