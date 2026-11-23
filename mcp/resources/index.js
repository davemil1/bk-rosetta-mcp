import { readFileSync } from "node:fs";
import { path } from "../rosetta.js";
const md = (p) => readFileSync(path(p), "utf8");
export function registerResources(server) {
  server.resource("overview", "rosetta://overview", async () => ({ contents: [{ uri: "rosetta://overview", mimeType: "text/markdown", text: md("docs/overview.md") }] }));
  server.resource("fjc", "rosetta://fjc", async () => ({ contents: [{ uri: "rosetta://fjc", mimeType: "text/markdown", text: md("docs/fjc.md") }] }));
  for (const c of ["total-liabilities", "nature-of-debt", "prior-filing"])
    server.resource(`walkthrough-${c}`, `rosetta://walkthrough/${c}`, async () => ({ contents: [{ uri: `rosetta://walkthrough/${c}`, mimeType: "text/markdown", text: md(`docs/walkthrough-${c}.md`) }] }));
}
