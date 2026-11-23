---
name: trace-concept
description: Trace a bankruptcy concept across Official Form line, NIEM petition element, and FJC IDB variable, ending with a real aggregate. Use when asked where something lives, what it means, or how often it occurs.
---
1. `resolve <concept>`; quote the definition verbatim.
2. `describe_form <form>` and name the line.
3. `list_codes` if coded.
4. `query_fjc` one aggregate using the IDB variable; show the SQL.
5. `check_coverage fjc` and say what the statistics cannot tell us about this concept.
