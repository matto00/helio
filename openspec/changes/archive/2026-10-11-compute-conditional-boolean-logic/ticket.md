# HEL-1070: Pipeline `compute` step supports arithmetic only — no conditional/boolean logic

## Description

Found while building the "Roadmap — v0.7 & v0.8" dashboard (`7ad267a8-0452-4557-be67-59290985efbc`) through the MCP agent path on 2026-09-10.

### The gap

`compute` evaluates arithmetic (`a / b * 100`) but has no conditional or boolean construct. The consequence: **a single pipeline cannot conditionally aggregate**. You cannot express "count rows where status = Done" alongside a plain total count in one step.

This is not an exotic request — it is the single most common shape in any progress or completion metric, which is to say the shape that a roadmap, burndown, SLA, or health dashboard is made of.

### Concrete cost in this build

Computing a completion percentage required two separate aggregate branches, and joining those branches ran into HEL-1069. The workaround shipped on the dashboard is a `static` source re-expressing a ratio that was verified by hand (124/246 = 50.4%, 4/58 = 6.9%). The **Total** and **Completed** tiles are genuine pipeline aggregates; only the **%** tiles are static.

That workaround is honest but it is not live: when the underlying data updates, the two count tiles will move and the percentage tile will not.

## Ask

Add conditional support to `compute` — minimally a ternary or a `CASE`-like form, sufficient to express a conditional count/sum. Wiring checklist for a new op behaviour lives in the pipeline-op notes: apply/infer parity, `allowedOps`, Flyway if the op signature changes, and `StepCard` for the editor surface.

## Follow-through

Once this lands, the two `%` tiles on the roadmap dashboard should collapse back into real pipeline steps and the `static` source be deleted — otherwise the stale-number problem simply persists behind a fixed platform.

Related: HEL-1069 (multi-branch join unreliability).

## Acceptance criteria (derived; grammar decisions per owner escalation — see design.md)

- The strict compute grammar supports a conditional construct, comparison operators and boolean operators sufficient to express a conditional count/sum in one compute step (e.g. a per-row 1/0 or amount/0 column that an aggregate `sum` then totals).
- Analyze-time output type inference agrees with the applied row values for every new construct (analyze-versus-apply parity tests, red first).
- Operator precedence is mutation-proven (e.g. `a or b and c`, `not a = b`).
- The shared fixture is extended so the backend, frontend and helio-mcp agree on the supported functions/operators.
- `docs/compute-expression-grammar.md`, the compute editor help, and the helio-mcp compute description document the new grammar.
- Existing expressions (strict and legacy bare-identifier) keep their behaviour, including string functions and `+` on boolean columns; the only exceptions are (i) a boolean column referenced on its own (or via `coalesce`/`if`) now yields a JSON boolean, matching the `boolean` type analyze already reported, and (ii) the narrow set of legacy `$`-less expressions whose strict parse now succeeds or fails before reaching a non-reserved bare name (all-`true`/`false` bare words, or a reserved word misused as a value first, e.g. `and + 1`) — both explicit in design.md and pinned by tests.
