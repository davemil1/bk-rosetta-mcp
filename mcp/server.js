import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

const INSTRUCTIONS = `This server exposes the judiciary's published NIEM schema for individual bankruptcy
petitions (the Individual Bankruptcy Data Collection IEPD), with field-level mappings to the
Official Bankruptcy Forms and to the Federal Judicial Center Integrated Database (FJC IDB).
Every hub element carries its official definition. Use resolve to turn any form line, schema
element, IDB variable, or plain-language concept into all three. Use check_coverage fjc to see
what the statistical data does and does not capture about a petition. query_fjc is read-only and capped
at 25 rows: aggregate in SQL, filter new filings with snapfile = 1, compare y/n flags with lower(), and join
fjc_district on district = code for names. TOTLBLTS counts blank schedules as zero; TOTDBT excludes them;
say which you used. Check how many rows fjc_bk holds: the bundled sample is the first 20,000 FY2025 filings,
not a random sample, so its numbers are illustrative; a full-year load (557,540 FY2025 filings) can be cited.`;

const server = new McpServer({ name: "bk-rosetta", version: "0.1.0" }, { instructions: INSTRUCTIONS });
registerTools(server);
registerResources(server);
registerPrompts(server);
await server.connect(new StdioServerTransport());
