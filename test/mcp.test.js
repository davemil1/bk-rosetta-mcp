// End-to-end: start the server over stdio exactly as Claude Code does, and exercise every tool.
// Requires `npm run build:rosetta` and `npm run load:fjc -- data/sample/cpbank_fy2025_sample.tsv` first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client;
const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

before(async () => {
  client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["mcp/server.js"] }));
});
after(async () => client?.close());

test("lists six tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["check_coverage", "describe_form", "list_codes", "query_fjc", "resolve", "validate_petition"]);
  for (const t of tools) assert.ok(t.annotations?.readOnlyHint && !t.annotations.destructiveHint, `${t.name} is annotated read-only`);
});

test("resolve works from every direction", async () => {
  for (const h of ["TotalLiabilitiesAmount", "TOTLBLTS", "B106Sum line 3", "total debt"]) {
    const r = await call("resolve", { handle: h });
    assert.equal(r.element ?? r.primary.element, "TotalLiabilitiesAmount", h);
  }
  assert.equal((await call("resolve", { handle: "pro se" })).element, "Attorney");
  assert.equal((await call("resolve", { handle: "filed before" })).element, "PriorBankruptcyCaseIndicator");
  assert.equal((await call("resolve", { handle: "B101 Q9" })).primary.element, "PriorBankruptcyCaseIndicator");
});

test("resolve answers every FJC variable, including ones with no petition element", async () => {
  const { variables } = JSON.parse(readFileSync("spokes/fjc/bindings.json", "utf8"));
  for (const v of Object.keys(variables)) {
    const r = await call("resolve", { handle: v });
    assert.ok(r.fjc?.some?.((x) => x.variable === v), `${v}: ${r.error ?? r.element}`);
  }
  const t = await call("resolve", { handle: "TOTDBT" });
  assert.equal(t.element, null);
  assert.deepEqual(t.related.map((x) => x.element), ["TotalLiabilitiesAmount"]);
  assert.equal((await call("resolve", { handle: "filing date" })).variable, "FILEDATE");
  assert.equal((await call("resolve", { handle: "discharge" })).variable, "D1FDSP");
  assert.ok((await call("resolve", { handle: "total liabilities" })).relatedFjc.some((x) => x.variable === "TOTDBT"));
});

test("list_codes joins hub and FJC coding", async () => {
  const r = await call("list_codes", { element: "NatureOfDebtsCode" });
  assert.ok(r.codes.some((c) => c.value === "c" && c.definition === "Consumer"));
  assert.equal(r.fjc[0].variable, "ORGNTRDBT", "the as-filed variable comes first");
  assert.ok(r.fjc.some((b) => b.variable === "NTRDBT"));
});

test("fee status binds to the as-filed variable, and NOB carries the codebook-vs-data caution", async () => {
  const fee = await call("resolve", { handle: "filing fee" });
  assert.deepEqual(fee.fjc.map((b) => b.variable), ["ORGFEESTS"]);
  assert.ok(fee.relatedFjc.some((x) => x.variable === "FEESTS"));
  assert.equal((await call("resolve", { handle: "FEESTS" })).element, null);
  const nob = await call("list_codes", { element: "NatureOfBusinessCode" });
  assert.match(nob.fjc[0].caution, /None of the above/);
  assert.equal((await call("resolve", { handle: "subchapter v" })).element, "Subchapter");
});

test("resolve does not match inside words, and labels guesses", async () => {
  const u = await call("resolve", { handle: "unsecured debt" });
  assert.equal(u.element, "TotalNonPriorityUnsecuredClaimAmount");
  assert.equal(u.match, "synonym");
  const car = await call("resolve", { handle: "car" });
  assert.notEqual(car.element, "AllowableHealthCareDeductionsAmount");
  assert.equal((await call("resolve", { handle: "TOTLBLTS" })).match, "exact");
});

test("resolve hands the agent ranked candidates with official definitions instead of guessing", async () => {
  const rent = await call("resolve", { handle: "does the debtor rent" });
  assert.equal(rent.match, "candidates");
  assert.equal(rent.element, null);
  assert.ok(rent.candidates.some((c) => c.element === "DebtorRentsResidenceIndicator" && c.definition));
  // generic elements reused across many questions never win on definition text alone
  assert.equal((await call("resolve", { handle: "lawsuits against the debtor" })).match, "candidates");
  // FJC-only variables are candidates too
  assert.ok((await call("resolve", { handle: "discharge rate" })).candidates.some((c) => c.variable === "D1FDSP"));
  // a single answer when every word is in one element's name
  const f = await call("resolve", { handle: "foreclosure" });
  assert.equal(f.match, "fuzzy");
  assert.equal(f.element, "ForeclosedIndicator");
});

test("describe_form returns form lines from the IEPD workbook", async () => {
  const r = await call("describe_form", { form: "B106Sum", line: "9d" });
  assert.equal(r.fields[0].element, "TotalStudentLoanAmount");
});

test("check_coverage fjc says what the statistics do not know", async () => {
  const r = await call("check_coverage", { spoke: "fjc" });
  assert.ok(r.covered > 25 && r.notCaptured.length > 5);
});

test("query_fjc is read-only and returns real numbers", async () => {
  assert.ok((await call("query_fjc", { sql: "select count(*) n from fjc_bk" })).rows[0].n > 0);
  assert.ok((await call("query_fjc", { sql: "delete from fjc_bk" })).error);
  assert.ok((await call("query_fjc", { sql: "select 1; drop table fjc_bk" })).error);
});

test("validate_petition validates against the full IEPD", async () => {
  const ok = await call("validate_petition", { xml: "fixture" });
  assert.equal(ok.schemaValid, true);
  assert.ok(ok.reachesFjcStatistics.some((x) => x.element === "BankruptcyChapter"));
  const bad = await call("validate_petition", { xml: "NG1.6_CH7_Involuntary_BK_Petition" });
  assert.equal(bad.schemaValid, false);
});
