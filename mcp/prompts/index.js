import { z } from "zod";
export function registerPrompts(server) {
  server.prompt("trace", "Trace one bankruptcy concept from form line to schema element to FJC variable to a real number.",
    { concept: z.string() },
    ({ concept }) => ({ messages: [{ role: "user", content: { type: "text", text:
      `Trace "${concept}" end to end. 1) resolve it. 2) describe_form for the form it lives on and quote the line. 3) list_codes if coded. 4) query_fjc for one aggregate using its IDB variable. 5) state what the FJC data cannot tell us about it (check_coverage fjc). Cite the element definition verbatim.` } }] }));
  server.prompt("ask_fjc", "Answer a plain-English statistics question by resolving terms first, then querying.",
    { question: z.string() },
    ({ question }) => ({ messages: [{ role: "user", content: { type: "text", text:
      `Question: ${question}\nFirst resolve every term to its IDB variable with resolve/list_codes, then write one aggregate SQL and run query_fjc. Report the number, the SQL, and the hub elements the columns map to.` } }] }));
  server.prompt("coverage", "Report what a spoke does and does not capture.", { spoke: z.string() },
    ({ spoke }) => ({ messages: [{ role: "user", content: { type: "text", text: `Run check_coverage for ${spoke} and summarize, by Official Form, what is captured and what is not.` } }] }));
}
