## 1. Measure the orphans (must complete before any wiring)

- [x] 1.1 Enumerate every `e2e/**/*.spec.ts` and diff against what `ci.yml` invokes. Record the full 14-file classification (wired / orphan / deliberately excluded).
- [x] 1.2 Start dev servers via `scripts/concertino/start-servers.sh` using this run's `DEV_PORT`/`BACKEND_PORT` from `workflow-state.md`.
- [x] 1.3 Run each of the eleven orphaned specs INDIVIDUALLY. Capture per-spec verdict and, for failures, the observed error text.
- [x] 1.4 Re-run any spec that passed in 1.3 a second time to sample for instability (D3: `retries: 0`, so one run is one sample). Record any verdict that differs between runs.
- [x] 1.5 Write the orphan status report to `openspec/changes/wire-orphaned-e2e-specs/orphan-status-report.md`: per spec, verdict, error summary, recommended disposition (glob / quarantine). State explicitly that FAILING specs were sampled once only, so "fails" is not asserted as a stable verdict — the disposition (quarantine + ticket) is identical either way. This report is a deliverable in its own right — produce it even if all eleven pass.
- [x] 1.6 Persist the report via `scripts/concertino/persist-evidence.sh HEL-951 <path>`.

## 2. File follow-up tickets for red/flaky orphans

- [x] 2.1 For each red or flaky spec, decide whether failures share one root cause. State the decision and its reasoning explicitly in the report.
- [x] 2.2 File one follow-up ticket per spec, or one shared ticket if 2.1 established a common root cause. Record the identifiers. NOTE: no Linear MCP tool is exposed to this executor run; the four ticket descriptions are recorded in orphan-status-report.md and flagged in the final report for the orchestrator/user to file.
- [x] 2.3 Do NOT fix any red spec in this change (design.md Non-Goals, product-owner directed).

## 3. Convert `ci.yml` from allowlist to glob

- [x] 3.1 Replace the two per-spec `npx playwright test <file>` steps with a single glob invocation carrying no per-file arguments, so discovery is governed by `playwright.config.ts`.
- [x] 3.2 CORRECT the existing comment at `.github/workflows/ci.yml` lines 199-205. Every clause of it becomes false with this change — it currently asserts "the ONLY spec run here is the new steady-state mobile touch-target guard", that other specs "were never CI-gated", and that broadening the job is "a natural follow-up, not bundled into this change". Rewrite it, do not merely append below it; a stale-but-confident comment is this repo's documented recurring trap.
- [x] 3.3 The rewritten comment must record that `*.regression.spec.ts` is excluded deliberately, name the on-disk source-mutation reason, and point at `e2e/README.md`. This is acceptance criterion 2 and the durable fix for the original misdiagnosis — do not omit it.
- [x] 3.4 Confirm the two previously-wired specs are still collected by the glob (discharged by task 5.3's transcript, not by inspection alone).

## 4. Quarantine register in `playwright.config.ts`

- [x] 4.1 Add a `testIgnore` entry for each red/flaky spec from task 1.
- [x] 4.2 Give every entry a comment naming its follow-up ticket from 2.2. An entry without a ticket reference is prohibited (design.md D2). Ticket identifiers: HEL-960 (hel665 + hel666, shared cause), HEL-961 (hel716), HEL-962 (hel908-tail-attach), HEL-963 (hel909) — all filed in Linear.
- [x] 4.3 Add/extend the comment on the existing `**/*.regression.spec.ts` entry so its rationale stays adjacent to the new entries.
- [x] 4.4 Verify by inspection that every `testIgnore` entry now carries a reason, and state that in the report.

## 5. Prove the glob fails loudly for a NEW spec (design.md D4)

- [x] 5.1 Add a throwaway `e2e/zz-glob-proof.spec.ts` containing a single deliberately-failing assertion.
- [x] 5.2 Run the LITERAL `run:` command string extracted from the committed `ci.yml` e2e step — not a hand-typed near-equivalent. A near-equivalent proves the glob the executor typed, not the glob that ships. (Literal string: `npx playwright test`.)
- [x] 5.3 The captured transcript shows BOTH (a) `e2e/zz-glob-proof.spec.ts` collected BY NAME and going red, and (b) the two previously-wired specs (`hel813-mobile-touch-target-floor.spec.ts`, `hel910-pipeline-to-dashboard-flow.spec.ts`) collected and passing in the same run. Discharges task 3.4.
- [x] 5.4 Deleted the throwaway spec. Confirmed `git status --short` no longer shows it.
- [x] 5.5 Persisted the transcript via `persist-evidence.sh` (glob-proof-transcript.log).

## 6. Resolve regression harness Case B (design.md D5/D6)

- [x] 6.1 Enumerate the selectors measured by `e2e/hel813-mobile-touch-target-floor.spec.ts` at 430px via `assertFloor`/`sweepSurface` (excluding `assertExpanderFloor` and `assertHiddenAtWidth` selectors). This finite set is the ONLY candidate pool — precondition P1.
- [x] 6.2 For each candidate, determine P2 (baseline green on both axes, MEASURED at 430px and recorded), P3 (height floor present, width floor absent), and P4 (floor declared on the candidate's own rule, not inherited from a shared class or token). Determine these by runtime measurement / computed style — NOT by grepping `min-height: 44px`, which structurally cannot see floors reached via `height`, a token, or padding + line-height (design.md D6).
- [x] 6.3 State the search result explicitly: either the qualifying selector with per-precondition evidence for all four, or that none survives. Result: `.mobile-nav-sheet__item` qualifies (see caseb-search-and-mutation-proof.md).
- [x] 6.4 (N/A — a qualifying candidate survived; Case B was repaired, not deleted.)
- [x] 6.5 Repaired Case B against `.mobile-nav-sheet__item`. The wrong-axis height discriminator imports `DEFAULT_MIN_PX`/`RENDERED_BOX_EPSILON_PX` and compares against `DEFAULT_MIN_PX - RENDERED_BOX_EPSILON_PX`, never a re-typed `44`.
- [x] 6.6 Mutation-proved each repaired assertion individually — mutation 1 (width:20px added) proves (a) assertFloor throws and (b) width axis red while (c) height stays clear; mutation 2 (min-height:20px) independently proves assertion (c) is not vacuously true. Transcripts in caseb-search-and-mutation-proof.md.
- [x] 6.7 Verified via `HEL813_REGRESSION=1 npx playwright test --config=playwright.regression.config.ts e2e/hel813-mobile-touch-target-floor.regression.spec.ts`: Case B passes end-to-end (baseline PASS → mutated FAIL on width only → reverted PASS). **Cycle 2:** Case A, initially found failing (its `TOAST_BASE_RULE_MARKER` keyed on a `/* Close button */` comment deleted by an unrelated HEL-851 comment sweep), was repaired per product-owner direction rather than deferred — re-anchored on the RULE itself (`"\n.toast__close {"`, disambiguated from the media block's indented copy) with a runtime uniqueness assertion that throws a clear "source drifted" error if the count is ever not exactly 1. Both Case A and Case B now pass end-to-end; `git status --short` confirmed clean (both CSS files self-reverted) after each run. See `casea-marker-repair-and-mutation-proof.md`.
- [x] 6.8 Persisted Case B evidence via `persist-evidence.sh` (caseb-search-and-mutation-proof.md, regression-harness-run.log).

## 7. Run the FINAL globbed suite as a suite (design.md D7)

- [x] 7.1 After tasks 3, 4 and 6 are complete, run the exact committed glob invocation ONCE as a whole suite. Individual passes do not compose to a suite pass: one process, one worker, sequential, shared backend and shared Postgres accumulating state across specs.
- [x] 7.2 Capture the aggregate transcript and the wall-clock. 39 passed, 0 failed, ~50s.
- [x] 7.3 Quarantine anything red ONLY in the combined run, with its own follow-up ticket, per D2/task 4. N/A — nothing red only in the combined run.
- [x] 7.4 Report the measured wall-clock as the number against design.md's CI-cost risk, replacing the estimate.
- [x] 7.5 Persist the aggregate transcript via `persist-evidence.sh` (final-whole-suite-run.log).

## 8. Gates and handoff

- [x] 8.1 Run `npm run lint`, `npm run typecheck`, `npm run check:e2e-types`, `npm run format:check`, `npm test`. All clean except `npm test`'s 5 pre-existing helio-mcp compile-error suites (confirmed identical on unmodified HEAD via `git stash`, unrelated to this change).
- [x] 8.2 Confirm `git status --short` is clean of stray artifacts: no throwaway spec, no `*.png` added by this run, no mutated `toast.css`/`PanelList.css`/`MobileNavSheet.css`.
- [x] 8.3 Write `files-modified.md`.
- [x] 8.4 Commit.
