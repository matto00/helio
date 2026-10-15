## Standing Constraints

- [C1] Owner rulings stay intact: Delete only on overview rows; confirm is a row under the clicked row; secondary at rest / danger on hover; 44px expander at <=768; focus returns after Cancel/Confirm/refusal; handleRowClick ignores the actions cell and detail > 1.
- [C2] Every matrix cell in design.md is checked at 375, 768, 820 (list at 400) and 1280, light and dark; every cited test run shows this worktree's paths and non-zero counts.
- [C3] Local caps: jest <= 3 workers, Playwright <= 2 workers, nice -n 19, Bash timeout 600000; stop servers only via scripts/concertino/stop-servers.sh (never pkill/pgrep/killall).
- [C4] PipelineListTable.tsx / SourceListTable.tsx: call-site edits only (HEL-1579 concurrent); no CSS change in their stylesheets.
- [C5] (retired, superseded by C7) New/restored e2e assertions shown red on base.
- [C7] Every new/restored e2e cell is classified red-on-base or guard per design.md; a guard is shown failing against its named mutation; no vacuous cell.
- [C6] rowDeleteFocus unit tests cover React ref orders: switch (null for A before el for B) and StrictMode el/null/el; the scroller choice is proven only by the e2e top-delta (jsdom cannot).

## 1. Frontend

### Frontend

- [x] 1.1 Add `frontend/src/hooks/useNow.ts`: `useNow(intervalMs)` via `useSyncExternalStore`, one shared ticker per interval, stable snapshot between ticks (D1)
- [x] 1.2 `formatRelativeTime(iso, now = Date.now())`: optional `now`, existing callers unchanged (D1)
- [x] 1.3 `rowDeleteFocus.ts`: `noteDeleteActivation(detail, button)` records button, top and vertical scroll ancestor (D2)
- [x] 1.4 `rowDeleteFocus.ts`: `focusOnMount` pins the recorded button (pointer only) by adjusting `scrollTop` by the measured delta (D2)
- [x] 1.5 `rowDeleteFocus.ts`: deferred pointer reveal, 500ms, rescheduled per pointer click, cleared on unmount (`focusOnMount(null)`) and on keyboard activation; keyboard reveals immediately (D3)
- [x] 1.6 `PipelineListTable.tsx` and `SourceListTable.tsx`: `useNow(60_000)` once, `now` passed to every `formatRelativeTime`, `noteDeleteActivation(event.detail, event.currentTarget)` (D5)
- [x] 1.7 `App.css`: phone `.app-content` gets `scroll-padding-bottom: var(--bottom-nav-height)` (D4)
- [x] 1.8 `hooks/README.md`: list `useNow`
- [x] 1.9 `ConfirmInline`: opt-in `ignoreRepeatClicks` (ignore `detail > 1` on Confirm and Cancel); set it in `PipelinesPage` and `SourcesPage` (D2b)

## 2. Tests

### Tests

- [x] 2.1 Unit: `useNow.test.ts` (shared ticker, stable snapshot, cleanup), `formatRelativeTime` with explicit `now`
- [x] 2.2 Unit: rewrite `rowDeleteFocus.test.ts` (fake timers): arm on mount, re-arm on second click, null cancels, keyboard immediate, switch ref order (I16), StrictMode el/null/el, pin |delta|, pin-record lifetime (I20), wheel cancels reveal (I21); `ConfirmInline` ignoreRepeatClicks
- [x] 2.3 E2E: un-fixme the 375 double-click test; freshness check before dblclick, no settle wait between placement and gesture, restore the < 2px top-delta assertion (I2)
- [x] 2.4 E2E: the HEL-1604 820/375 test gains the freshness check and the top-delta assertion on both pages (I2, I7)
- [x] 2.5 E2E: 375 keyboard reveal and pointer bottom-row reveal assert confirm bottom <= BottomNav top; pointer case asserts no movement at 300ms (I4, I6)
- [x] 2.6 E2E: 375 switch cases I8, I14 (A scrolled above the viewport), I15 (B revealed after the window); 820/400 I17 last row at max scroll, both pages
- [x] 2.6b E2E: I19 at /pipelines 375 (page at top, table at end): assert press 2 landed on Confirm/Cancel via recordPresses, no DELETE request, one confirm; guard vs M5
- [x] 2.7 Red-or-guard: run 2.3-2.6b on base (fix stashed) and each guard against its mutation (M0, M1, M2, M5); record outputs; then green, `--repeat-each=3`
- [x] 2.8 Gates: lint, format:check, typecheck, check:e2e-types, frontend jest (3 workers), the HEL-1574 spec file
- [x] 2.9 Live matrix probe (I1-I13) at 375/768/820-list-400/1280, light and dark; record measurements in the commit's evidence
