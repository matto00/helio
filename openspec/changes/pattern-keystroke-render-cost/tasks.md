## Standing Constraints

- [C1] Profile first: "before" evidence (dev + prod) is committed before any source change; fixes follow the profile.
- [C2] A fix must remove work (renders, walks, layout reads); deferring/transition-only changes do not count.
- [C3] Regression tests assert counts, never wall-clock, and are shown red (or via a named mutation) before acceptance.
- [C4] Walk counts exclude StrictMode double-invocation: count in the prod build or per committed render; state the factor.
- [C5] Scroll-driven edge measurement stays synchronous; existing synchronous scroll-edge tests are not edited.

### Frontend

## 1. Before profiles (case A first edit, case B later keystroke; design.md D1)

- [x] 1.1 Measurement harness (scratch or env-gated, never always-on): per-component render counts with reasons for A and B, dev; commit `before-renders-dev.txt`
- [x] 1.2 Saved/draft walk counts for A and B in the prod build (or per committed render) with the StrictMode factor stated; commit `before-walks.txt`
- [x] 1.3 LoAF input-handler script time at 1x and 4x, dev and prod (`vite build` + `vite preview`, proxy confirmed), A and B; commit `before-loaf-dev.txt`, `before-loaf-prod.txt`
- [x] 1.4 `useScrollEdges` attribution on a named 1,000-row fixture (rows x columns stated, same before/after) inside the keystroke: trigger, forced layout vs re-render, remount or not, dev and prod; commit `before-scroll-edges.txt`
- [x] 1.5 HEL-1683 spec with `HEL1808_CPU_THROTTLE=4`, 1 worker, n=5, control-window handler LoAF per run (D6); commit `before-probe-control.txt`
- [x] 1.6 `profile-findings.md`: what re-renders and why, walk counts, which case AC2 reflects, the expected re-render set for 4.2; escalate if it contradicts the ticket

## 2. Fixes (per findings)

- [x] 2.1 No change made: the profile found no identity churn re-running the saved walk (claim 2 of the ticket is not present; met by evidence under the owner ruling `proceed-without-claim-2`, production-build counts in before-walks.txt / after-walks.txt). 3.1 is a guard test, red only by mutation (mutation-saved-walk-churn.txt)
- [x] 2.2 Narrow the keystroke re-render with memo/colocation/selector fixes the findings name (D2): header, closed dialog hosts, source card, Outputs section and unedited step rows (profile-findings.md); verify 3.2 green
- [x] 2.3 Scroll edges per D4: avoid the grid remount if attributed, bail out on unchanged edges, scroll stays synchronous; verify 3.3/3.4 and existing tests unedited

### Tests

## 3. Regression tests (red first)

- [x] 3.1 Walk-count test: draft-only Pattern change does not re-run the saved walk; saved-input change still does; red on unfixed tree
- [x] 3.2 Render-count test against the set named in `profile-findings.md`; StrictMode handling stated; red on unfixed tree
- [x] 3.3 `useScrollEdges`: unchanged edges cause no re-render; red on unfixed tree
- [x] 3.4 If a remount is removed: grid DOM node survives the saved -> draft switch; red on unfixed tree
- [x] 3.5 Mutations re-introducing each defect with their red output, committed as `mutation-*.txt`

## 4. After profiles and parity

- [x] 4.1 Repeat 1.1-1.5 on the fixed tree; commit `after-*.txt` and a before/after table in `profile-findings.md` (both AC2 medians, ranges, every run)
- [x] 4.2 Parity corpus, regex, session-epoch, draft hook, `useScrollEdges` and `DataGrid` jest suites pass; lint, typecheck, format clean
- [x] 4.3 e2e `hel1683-regex-main-thread`, `hel1631-draft-mode`, `hel1685-draft-polish`, `hel1733-draft-outputs-shapes-*`, `hel1734-draft-roots` pass at 1x
