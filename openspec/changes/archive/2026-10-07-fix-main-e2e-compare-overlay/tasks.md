## Standing Constraints

- [C1] hel1351 assertions are scoped to the tooltip element (not whole-card text), use digit boundaries not `\b`, assert the value/baseline pair of a deterministic or identified category, and are mutation-checked against both a wrong value and the `Updated <date>` leak path.
- [C2] Layout-cause proof for hel1350 is the e2e spec red on unmodified main and green on the fix (full logs + trace + evidencePath screenshot); a Jest test is never presented as layout proof.

## 1. Reproduce and root-cause hel1350

- [x] 1.1 Run `e2e/hel1350-chart-compare-picker.spec.ts` (light + dark) locally on unmodified main with trace on, `nice -n 19`, <=3 workers; keep the full log and trace; verify it reproduces the "7 days ... outside of the viewport" hang (or record what it does instead).
- [x] 1.2 Identify the root cause from the local trace and backend log; confirm or refute the HEL-1331 sheet-height / HEL-1285 extra-option / HEL-1366 hypotheses by targeted local bisection (e.g. revert one commit's relevant hunks locally); record the evidence in `files-modified.md`/commit message.
- [x] 1.3 Fix the cause per design Decisions 1 and 5; verify with the e2e spec red on unmodified main and green on the fix in light + dark (full logs, trace, evidencePath screenshot of the open listbox).

## 2. Reproduce and root-cause hel1351

- [x] 2.1 Reproduce hel1351's date dependence via Playwright `timezoneId` emulation (server instant rendered as the 7th vs the 8th) and/or a PanelCard DOM probe with a controlled `lastUpdated` (NOT `page.clock` — the `Updated` date is server-assigned); record the full `tallCard.textContent()` on both sides and the exact substring that matched `\b(15|7)\b`.
- [x] 2.2 Fix per design Decision 2 (a)-(c): tooltip-scoped, digit-boundary, deterministic category or value/baseline pair; verify it passes under both time zones and fails under mutations of a wrong grouped value and of the date-leak path; grep other e2e specs for the same whole-card loose-digit trap and list hits.

## 3. Classify PanelCard.test.tsx

- [x] 3.1 Determine whether the HEL-579 re-render 3-vs-2 observation relates to this change set or is HEL-1215's known flake; verify by repeated runs (bounded, nice) and code reading; record conclusion.

## 4. Gates

- [x] 4.1 Lint, typecheck, format, relevant Jest suites, and both e2e specs green locally; full logs kept.
- [ ] 4.2 (Orchestrator, delivery) All 4 CI e2e legs green on the PR with the PR head containing current origin/main.
