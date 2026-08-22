# HEL-657: check-openspec-hygiene.mjs false-positives "complete but not archived" mid-Execution-phase on every cycle-1+ delivery

## Description

`scripts/check-openspec-hygiene.mjs` (wired into the Husky pre-commit chain via `npm run check:openspec`) fires
"change `<name>` is complete (N/N) but not archived" as soon as an OpenSpec change's `tasks.md` hits 100% checked —
but in the concertino ticket-delivery workflow, `openspec archive` is deliberately an orchestrator-only Phase 3 step,
run only *after* evaluator/skeptic review has passed, in its own separate commit following the executor's
implementation commit.

This means the check produces a false positive on essentially every cycle-1+ delivery commit under this phased
workflow: the executor's implementation commit legitimately has a 100%-complete `tasks.md` with the change not yet
archived (archival hasn't happened yet — it's a later, separate step), forcing a `git commit -n` pre-commit bypass
every single time, rather than only when archival is genuinely overdue.

Independently flagged by HEL-390's and HEL-392's executor and evaluator (2026-08-13 delivery session).

## Measured impact

20 of 68 change directories archived since 2026-08-15 (~29%) mention a `git commit -n`, essentially all driven by
this false positive. Each such bypass skips the ENTIRE pre-commit chain — `lint`, `typecheck`, `format:check`,
`check:schemas`, `check:spec-structure`, `check:openspec`, `check:scala-quality` and the test suite — not just the
one failing check. This has already caused a near-miss: HEL-774's executor disclosed its bypass as skipping only
`check:openspec` when it had in fact also skipped a failing root `format:check` on `DESIGN.md`, introducing that
failure. Only an evaluator re-running every hook individually caught it. A bypass that is routine is a bypass
nobody scrutinises.

## Acceptance criteria

- [ ] AC1: `check-openspec-hygiene.mjs`'s "complete but not archived" rule no longer fires on an executor's
      implementation commit mid-Execution-phase (before evaluator/skeptic review has passed and the orchestrator
      has reached Phase 3).
- [ ] AC2: The rule still fires when a change is genuinely complete and abandoned without ever being archived
      (the real case it is meant to catch). A fix that stops false-positiving by never firing at all has FAILED.
- [ ] AC3: No `git commit -n` bypass is needed for this specific reason in a normal concertino delivery cycle.
- [ ] AC4: Both directions of AC1/AC2 are proven against real repository states with executable evidence, not by
      reasoning about the code.
- [ ] AC5: The other two rules of the hygiene script (stray files in `openspec/changes/`, leftover
      `files-modified.md` handoffs in archived changes) are preserved unchanged.
- [ ] AC6: `scripts/check-spec-structure.mjs` (HEL-775) remains a SEPARATE script and is not merged into or
      modified by this change. `.husky/pre-commit` keeps both it and `npm run typecheck` (HEL-683) intact and
      correctly ordered.

## Constraints carried from the delivery session

- `openspec archive` exits 0 even when it aborts — every abort prints `Aborted. No files were changed.` and returns
  0. Any code or verification that shells out to openspec MUST assert on stdout, never on `$?`.
- Do not run `concertino sync` (CON-128).
- HEL-775 deliberately kept its guard separate from this script specifically to avoid compounding this ticket's
  false positive. Honour that separation.
