## Standing Constraints

- [C15] Time one full-file run of each spec first; if a full-file run cannot finish inside the 600 s Bash timeout, run every test of that file as separate invocations and say so explicitly; never quietly run only the target test.
- [C16] For every stressed run (burn, held response, CPU throttle), record the mechanism and its exact code as committed .txt evidence, plus proof in the run output that the stress was active.
- [C17] Any mutation of app code stays uncommitted and is reverted; show `git status --short` with no app files afterwards in the committed mutation evidence.
- [C19] A post-fix owner max-60s above 60 (1x or CPU 4x) triggers the per-(theme, width) fallback; never just logged.
- [C20] C19 applies to editor principals too: a per-test editor max-60s above 60 (1x or 4x) triggers the per-(theme, width) fallback.
- [C18] Each stated conclusion (counts, stale-tap risk or its absence) is backed by probe output committed as .txt, not inferred from code reading.

## Driver Constraints

Binding for every role: `driver-constraints.md` in this change dir. Restate them to any sub-agent.

## 1. Environment

- [x] 1.1 `cd frontend && nice -n 19 npm ci`; start servers via start-servers.sh (ANTHROPIC_API_KEY empty, lane DATABASE_URL in the same command)
- [x] 1.2 Time one full-file run of each spec (C15)

## 2. Item 1 hel1791 owner theme tests

- [x] 2.1 Request counter (Decision 2: charged vs uncharged, max-60s); verify whether APIRequestContext requests fire context `request` events; one-window cross-check (first charged request time, Retry-After, no rollover) on a per-owner-test principal (probe .txt)
- [x] 2.2 Red first: counts on the unfixed spec + deterministic burn red (Decision 3); commit .txt before the fix; project per-owner-test max-60s and choose shape (fallback if > 50), recorded in root-cause.md
- [x] 2.3 Fix: one principal and board per (theme, width) owner test (Decision 1 fallback, 6 tests), run-terminal wait before first load, explicit openStack targets, counts logged and annotated (incl. :290 test, editor, measurer); isolation control (Decision 3)
- [x] 2.4 Mutation red at a geometry assertion in a moved owner test (Decision 6), committed .txt
- [x] 2.5 Report editor and measurer counts; flag editor if max-60s above 60 with the same-shape fix for the orchestrator

## 3. Item 2 hel1582 tap (b)

- [x] 3.1 Probe (Decision 4), committed .txt; state the outcome in root-cause.md
- [x] 3.2 If outcome (i)/(ii): coordinate stand-in stale-tap evidence (opened=false + element hit) and fixed counterpart (opened=true), committed .txt; then the wait on the named mover; HEL-1826 off-screen mutation reds at the step-sheet cell
- [x] 3.3 If outcome (iii)/(iv): no code change; evidence states why

## 4. Verification

- [x] 4.1 20x each full spec file in a row (2 workers, nice -n 19), committed .txt, highest owner count recorded
- [x] 4.2 5x each file under CPU 4x (counts logged for hel1791, 1x and 4x maxima recorded separately) plus the isolation control, committed .txt
- [x] 4.3 lint + typecheck + prettier on changed e2e files

## 5. Close

- [x] 5.1 Stop every server started (stop-servers.sh / exact PID); report follow-up candidates
## 6. Fold-in: per-test editor principals (design Decision 10)

- [x] 6.1 Red first: burn the shared editor's remaining budget before the dark editor test on the pre-fold-in spec; commit red .txt
- [x] 6.2 Each editor theme test registers its own editor principal, granted on the beforeAll board; REQUEST-COUNT logged per editor and for the beforeAll owner
- [x] 6.3 Isolation control (burn the light editor's principal; dark editor test stays green) and editor-geometry mutation red, committed .txt
- [x] 6.4 20x hel1791 full file at 1x + 5x at CPU 4x (fresh), highest editor/owner max-60s at 1x and 4x; one full hel1582 run; committed .txt
- [x] 6.5 lint + typecheck + prettier; update root-cause.md and files-modified.md
