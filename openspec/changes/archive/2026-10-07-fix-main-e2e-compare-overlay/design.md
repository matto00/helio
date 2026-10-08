## Context

See proposal.md (Why). Evidence for planning was taken from the failing main run's own artifacts (run 37703155327, job e2e (3), artifact `playwright-report-shard-3`, both traces), not from merge-order inference. The driver's merge-interaction hypothesis (HEL-1285 x HEL-1366) is a claim to be tested, not a premise.

Planning-time observations (to be re-confirmed by local reproduction, not trusted):

- hel1350 (light trace): every API setup call succeeded (register, source, pipeline, output, two runs, panel, auto-layout all 2xx). The test passed the Compare combobox checks and the HEL-1285 "Previous option count = 1" assertion, then hung at `spec.ts:149`, `getByRole('option', { name: '7 days' }).click()`. Call log: locator resolved to `<button role="option" class="ui-select__option">7 days</button>`, "element is visible, enabled and stable ... scrolling into view if needed ... done scrolling ... element is outside of the viewport", retried ~270 times until the 150s test timeout. So this failure is a layout/scrolling problem in the Output editor sheet's Compare dropdown, with no indication of SSE/run timing involvement.
- PR #829's head (d18c9b8a5) lacked BOTH b14e622ee (HEL-1366) and f268edf8f (HEL-1331 — added a `HistoryPayloadsField` toggle + CSS to `OutputEditorSheet`, i.e. the same sheet the Compare picker lives in). HEL-1285 added one option ("Previous") to the chart compare list. A taller sheet plus a longer listbox is a plausible way to push "7 days" outside the viewport while scroll-into-view cannot reach it (e.g. listbox inside a fixed/overflow-hidden container, or positioned below the fold). Candidate, not conclusion.
- hel1351: the tooltip text `...sum(amount)15vs 7d11...` has no `\b` between `15` and `vs`. Candidate explanation for the midnight dependence: before 2026-10-08 the card text also contained a standalone `7` from a date rendering (e.g. "Oct 7" / day-of-month 7) that satisfied `\b(15|7)\b` by accident, so the assertion may never have been proving "15" at all. Candidate, not conclusion.

## Goals / Non-Goals

**Goals:**
- Reproduce hel1350 locally on unmodified main (e4289e6c8 or later) and identify the root cause from the local trace + backend log, confirming or refuting the layout hypothesis and the commit(s) responsible (bisect between d18c9b8a5-equivalent state and main as needed: e.g. revert f268edf8f's sheet changes locally, or check out 96712881e^ + HEL-1285's spec).
- Reproduce hel1351's date dependence on either side of the date boundary and show exactly which text satisfied the regex before midnight and why it does not after. NOTE (design-gate finding): the most likely date text is the card's `Updated {toLocaleDateString(panel.meta.lastUpdated)}` label (`frontend/src/features/panels/ui/PanelCard.tsx` ~:840), whose instant is **server-assigned** and formatted in the **browser's time zone**. Faking the browser clock (`page.clock`) does NOT change it. Reproduce instead by (a) emulating the browser time zone with Playwright `timezoneId` (e.g. a zone where the current server instant renders as the 7th vs one where it renders as the 8th), and/or (b) a PanelCard DOM probe/unit test with a controlled `lastUpdated`. Required evidence: the full `tallCard.textContent()` on both sides plus the exact substring that matched `\b(15|7)\b`.
- Fix each cause such that the spec still proves what it was written to prove (hel1350: user can choose "7 days" via the picker and the overlay is drawn; hel1351: the hovered grouped value is 15 (east 10+5) and the baseline overlay is present).
- Classify PanelCard.test.tsx 3-vs-2 with evidence.

**Non-Goals:**
- No backend changes unless the trace/backend log implicates the backend (the planning trace does not).
- No change to SSE publish timing (HEL-1366) unless reproduction implicates it.
- No fix to HEL-1215's flake unless shown to be caused by this change set; classify only.
- No e2e shard rebalancing (HEL-1361).

## Decisions

1. **Product fix over test workaround for hel1350, if a user is affected.** If the reproduced cause is that the Compare listbox can render options that cannot be scrolled into view at a 1440x900 viewport (a real user would not reach "7 days" either), fix the component (e.g. listbox max-height + internal scroll, flip/position within the viewport, or sheet body scroll) and prove it per Decision 5 (e2e red/green; any Jest test covers non-layout logic only). Alternative considered: `click({ force: true })`, `dispatchEvent('click')`, keyboard selection, or a larger viewport in the spec — rejected as default because each bypasses exactly the reachability the spec should prove. A keyboard-selection change is acceptable only if the cause is shown to be Playwright-specific and a real pointer user can reach the option (prove with a screenshot via `evidencePath`).
2. **For hel1351, fix the assertion only if the tooltip content is correct and the date dependence is demonstrated.** The replacement must be strictly stronger than the old one and valid against the real text (`sum(amount)15vs 7d11` has no `\b` between `15` and `vs`, so `\b`-anchored forms like `/sum\(amount\)\s*15\b/` are WRONG — they are red on correct output). Requirements:
   - (a) **Scope the haystack to the tooltip element** (not the whole card's `textContent`), so the `Updated <date>` label and other card text can never satisfy it; use digit boundaries (`(?<!\d)15(?!\d)`) rather than `\b`.
   - (b) **Make the hovered category deterministic or assert the matching pair**: the hover poll returns the first x-position whose text contains `vs 7d`, which may be west (7, baseline 9) rather than east (15, baseline 11). Either pin the hover to the east category, or assert the value/baseline pair for whichever category is hovered (east 15 with 11, west 7 with 9) — never a bare either-value check.
   - (c) **Mutation check** covering both a wrong grouped value (e.g. raw 10 or 5 instead of 15) AND the old date-leak path: the assertion must stay red when the card contains `Updated 10/7/2026` but the tooltip shows a wrong value.
   If instead the tooltip itself is wrong (a real formatting bug a user sees), fix the formatter and keep or strengthen the assertion. Also grep other e2e specs for loose digit assertions against whole `.react-grid-item`/card text that includes the `Updated` date; report hits as a follow-up (out of scope to fix here).
5. **hel1350 red/green proof for a layout cause is the e2e spec itself**, not Jest: jsdom does no layout, so a Jest "listbox outside viewport" test cannot fail on the old layout. Proof = the spec red on unmodified main (full log + trace) and green on the fix, plus an `evidencePath` screenshot of the open listbox. A Jest test may be added for non-layout logic (e.g. option list contents) but must not be presented as the layout proof.
3. **Evidence discipline.** Keep FULL logs for every failing local/CI run (never tails) under the run's scratch/evidence directory; screenshots only via `e2e/support/evidencePath.ts`. Local e2e runs at most 3 workers, under `nice -n 19`.
4. **Spec deltas only if behavior changes.** `skip_specs: true` is set at planning. If Decision 1 or 2 lands a user-visible product fix, add a MODIFIED/ADDED delta to the existing capability spec and remove `skip_specs`.

## Risks / Trade-offs

- [Root cause differs from the planning-time candidates] → Decisions are conditional on reproduction; executor reports the confirmed cause with trace evidence before fixing.
- [Local repro differs from CI (headless chromium, viewport, fonts)] → Use the same Playwright config/project as CI and the spec's own 1440x900 viewport; if local does not reproduce, escalate rather than ship an unproven fix.
- [Date text is server-assigned, so faking the browser clock cannot reproduce it] → Use `timezoneId` emulation or a controlled-`lastUpdated` DOM probe (see Goals); document which text comes from the browser vs the backend.
- [Strengthened regex passes vacuously in a new way] → Mutation-check the new assertion.

## Migration Plan

Frontend/test only. No deploy steps; revert the PR to roll back.
