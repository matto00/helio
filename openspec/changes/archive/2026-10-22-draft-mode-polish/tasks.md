## Standing Constraints

- [C1] Every bug test claimed as fails-first is shown red against unfixed code (evidence.md records the red run); a test that cannot go red is labelled a guard and carries a mutation proof.

## 1. Frontend — bugs (each: write the failing test first, record red then green in evidence.md)

- [x] 1.1 Item 4 (D1): notice slot plus 4-row grid; verify with the e2e gap check at 1280×800 (red on main)
- [x] 1.2 Item 5 (D2): reproduce the 375 overlap; fix the clearance or the slot; verify with the e2e non-intersection plus click check at 375/430, or record not-reproducible
- [x] 1.3 Item 6 (D3): clearAuth listener calls clearKeptDrafts; verify with the store test plus the 401 interceptor test (red on main)
- [x] 1.4 Item 7 (D4): probe the terminal-before-rerender window; take the Output ids from the store; verify with the hook test, or record not-reproducible
- [x] 1.5 Item 8 (D5): lift the view tracker and walker into usePipelineDetailPage; verify with the RTL layout-flip test on the ERRORED step whose draft count and rows differ from saved (red on main)
- [x] 1.6 Item 9 (D6): remove the dead saveError plumbing from useStepCardEditorState, StepOpEditor and the 6 configs; verify with typecheck plus the step-named notice test
- [x] 1.7 Item 10 (D7): cumulative seen-ids in useAddedStepId; verify with the hook test base→minus→base (red on main)

## 2. Frontend — render cost, live column, copy

- [x] 2.1 Item 3 (D8): useLatestCallback on all 4 dialog function props plus memo for Share, Schedule and StepPalette; verify with the real-page Modal render-count test (red on main, plus a mutation check)
- [x] 2.2 Item 11 (D9): "from a deleted step", the padded empty state, stop rendering cascade hints; verify with updated component tests
- [x] 2.3 A (D10): "updating" while settling; outer column computes settling (lifted pick, resolveDisplayedOutput); verify with the edit, unrelated-render and LiveOutputBody render-count tests
- [x] 2.4 B (D11): the MAX_WAIT cap bypasses idle; verify with the fake-timer test where idle never fires (red on main)
- [x] 2.5 C (D12): onToggle identity test; verify a mutation (remove useCallback) fails it
- [x] 2.6 F (D13): noAnimation reaches the reference marks; verify with a ChartPanel option test (marks animation:false under noAnimation) plus an unchanged chartShapeSignature test, plus a browser check under Full
- [x] 2.7 G (D14): disclosure cap, muted stale marker, error-free note; verify with component tests plus screenshots at 900×800 and 900×700
- [x] 2.8 I (D15): the token guards stop hardcoding 151; verify by mutation (empty glob fails)

## 3. Docs

- [x] 3.1 DESIGN.md §10 one-line carve-out for live draft previews (owner answer add-carveout); verify with a diff review
- [x] 3.2 Archived HEL-1631 design.md :174/:176 corrections (D16); verify the reason against pipelineDraft.ts
- [x] 3.3 Item 14: `"p-1"` in PipelineScheduleDialog.rerender.test.tsx; verify the test passes
- [x] 3.4 evidence.md: every red/green (D3: note the expire-then-reload case is covered via failed rehydrateAuth → clearAuth), any not-reproducible record, and each deferral (perf 1–2, 13, D, E, H, shared Modal, J) with its owner answer and reason (D17)

## 4. Tests and verification

- [x] 4.1 New e2e spec e2e/hel1685-draft-polish.spec.ts (items 4, 5, 7 where reproducible); passes on the dev project under the e2e lock
- [x] 4.2 Frontend gates: lint, typecheck, format:check, jest with HELIO_JEST_MAX_WORKERS=2, plus the frontend CI script checks (check:*); all green
- [x] 4.3 Local @prod-build latency e2e: edit 1 < 100 ms and edits 2–10 < 50 ms; numbers recorded
- [x] 4.4 Visual pass: 1280, 900, 375 and 430, light and dark, under Full, Subtle and Off; screenshots in .concertino/scratch/HEL-1685/
- [x] 4.5 files-modified.md lists every path explicitly (CON-260)
