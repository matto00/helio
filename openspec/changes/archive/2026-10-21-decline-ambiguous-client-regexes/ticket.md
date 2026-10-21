# HEL-1683: Client draft evaluator: a catastrophic-backtracking user regex can freeze the browser tab (JS regex in javaRegex.ts)

## Description

HEL-1676 time-boxes user regexes on the server: one 2 s wall-clock budget per step (owner ruling) for stringops
`extractRegex` and assert `regex`. The client-side draft evaluator (HEL-1581,
`frontend/src/features/pipelines/evaluator/javaRegex.ts`) runs the same user regexes in the browser's JS regex
engine, which also backtracks, on the main thread. Once HEL-1631's draft mode makes the client evaluator live on
every edit, a pattern like `^(.*a){12}$` on a ~30-character cell could freeze the tab for seconds. That is
unverified: first check whether the HEL-1581 allowlist accepts such patterns.

Options (from the ticket): run client evaluation in a Web Worker with a time budget; mark the step unavailable
client-side when the pattern isn't provably linear so the time-boxed server draft preview evaluates it; reject at
the allowlist. Keep client/server parity: an overrun must surface as the same step error HEL-1676 produces.

## Acceptance Criteria

- A catastrophic pattern in a draft never blocks the main thread for more than about 100 ms, measured with an e2e
  long-task probe that fails first.
- Normal regexes behave identically, and the parity corpus stays green.

## Premise validation and owner ruling (2026-10-21)

- The ticket's own example `^(.*a){12}$` is already declined client-side (any quantified group is outside the
  allowlist), as are `(a+)+$`, `(a|a)*b`, `(a*)*b`. Evidence: `.concertino/runs/HEL-1683/evidence/premise-validation.md`.
- Still accepted and catastrophic (Node 22 / V8, one 29-char cell `"a"x28 + "!"`):
  `^(a*a*a*a*a*a*a*a*a*a*)$` 10.4 s, `(\w*` x10 `)!x` 29 s, `^(.*.*.*.*.*.*.*.*x)` 354 ms.
- Owner answered the ticket-drift escalation `HEL-1683-1792567280436-a23bee` with **proceed-with-restated-scope**:
  tighten the `javaRegex.ts` allowlist so backtracking-prone patterns (the escalation's wording: more than one
  unbounded or large quantifier) are declined as `unsafeRegex`; those steps then run in the server draft preview
  under HEL-1676's 2 s budget, so an overrun is the same step error by construction. No Web Worker.
