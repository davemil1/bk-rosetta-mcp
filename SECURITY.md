# Security

## Reporting a vulnerability

Please report suspected vulnerabilities privately through GitHub's **Report a vulnerability** button (Security tab → Advisories) rather than in a public issue. Include steps to reproduce. We aim to acknowledge reports within 5 business days.

If this repository is hosted under a GSA organization, the [GSA Vulnerability Disclosure Policy](https://www.gsa.gov/vulnerability-disclosure-policy) also applies.

| Version (branch) | Supported |
| --- | --- |
| `main` | ✅ |
| other | ❌ |

## What the server touches

- **Public data only.** The hub is the judiciary's published NIEM petition schema (IEPD). The `forms` spoke comes from the IEPD's business-rules workbook. The `fjc` spoke is the Federal Judicial Center's public Integrated Database, which publishes no names, SSNs or street addresses (only ZIP and county). The sample petitions in `hub/fixtures/` are the IEPD's own synthetic examples. There is no real debtor data and no CM/ECF access.
- **Read-only.** All six tools are annotated `readOnlyHint: true`. `query_fjc` accepts a single `SELECT` only; anything else, and anything after a `;`, is refused. Results are capped at 25 rows.
- **No outbound requests from tools.** No tool takes a URL. The only network calls are the Databricks SQL warehouse and Files API at the host set in `.env`, and only the loader writes.
- **stdio by default.** The server talks JSON-RPC over stdin/stdout to a local client. It opens no port. An HTTP deployment (see the README's next steps) would need authentication in front of `/mcp` before non-hackathon use.

## Hackathon note: credentials

- **The SQL guard is a convenience; the credential is the real boundary.** `query_fjc` runs with the privileges of whatever Databricks credential is in `.env`, so a `SELECT` can read anything that credential can read, including `read_files()` on Unity Catalog volumes. Use a token or service principal with `USE CATALOG`, `USE SCHEMA` and `SELECT` on the FJC schema only. Don't use a personal all-APIs token. The loader needs write privileges; run it with a separate credential.
- **Never commit secrets.** `.env` is git-ignored; `.env.example` holds placeholders only. Don't paste tokens into chat sessions or issues; if you do, revoke them.
- **Errors.** Tool errors return a short message and a `hint` naming the settings to check. They never include credentials. Database error text is passed through, so don't put secrets in SQL.

## Before any non-hackathon use

Put authentication in front of any HTTP endpoint, use least-privilege service credentials, define log retention, and review your agency's ATO requirements.
