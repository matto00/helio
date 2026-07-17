## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- AC #1 (no user-visible edit path at <768px silently drops changes): addressed via remedy (a) — `usePanelUpdatesFlush` hoisted to `PanelGrid`, mounted at every width. Verified live (see Phase 3).
- AC #2 (regression test covering appearance edits at mobile width): present — `PanelGrid.test.tsx` "HEL-304 — width-independent panel-update flush" describe block (phone-width auto-save flush, Save-now at phone width, resize-mid-edit strand) plus rewritten HEL-301 hazard tests. Ran locally: 21/21 pass in `PanelGrid.test.tsx`, 1096/1096 in the full suite.
- AC #3 (audit note in the PR listing every `usePanelGridSave`-dependent mutation path): present in `files-modified.md` (8-row table) and mirrored in the commit body's description; matches `design.md`'s pre-implementation audit table row-for-row.
- No AC silently reinterpreted; remedy (a) vs (b) decision is explicit and evidenced (Decision 1, design.md).
- Task list (`tasks.md`) fully checked off and matches the diff — probes, split, tests, doc-comment updates, gate run, handoff all accounted for.
- No scope creep: diff is confined to the flush-lifecycle split (`usePanelUpdatesFlush.ts`, `useLayoutSave.ts`, `PanelGrid.tsx`, `DesktopPanelGrid.tsx`, `MobilePanelStack.tsx` comments, tests) plus planning artifacts. No unrelated refactors.
- No regressions to existing behavior: full Jest suite green (102 suites / 1096 tests), `npm run build` succeeds, HEL-301 guard re-tested and passing (verified live, see Phase 3).
- No schema/API contract changes needed or made (frontend-only fix) — confirmed via `git diff --stat`.
- Spec deltas (`specs/panel-write-accumulator`, `specs/mobile-viewer-stack`, `specs/panel-save-state-indicator`) accurately reflect the implemented behavior, cross-checked against the actual hooks and tests.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md compliance**: no inline FQN violations (frontend-only change, `check:scala-quality` N/A). File-size soft budget (~250 lines): `DesktopPanelGrid.tsx` is 293 lines (was 284 pre-fix, informational-only per CONTRIBUTING.md, well under the 400-line "must propose a split" threshold) — not a violation. All new/edited hook files (`usePanelUpdatesFlush.ts` 149 lines, `useLayoutSave.ts` 114 lines) are comfortably within budget.
- **`-n` bypass claim verified against the commit**: re-ran `npm run check:openspec` directly — output is exactly "change ... is complete (18/18) but not archived", confirming it is the sole failure. Independently re-ran `lint`, `format:check`, `check:schemas`, and the full Jest suite — all pass. The commit body explicitly documents the bypass and its justification, matching CONTRIBUTING.md's AI-collaborator disclosure requirement and the ticket's binding directive #6.
- **DRY / Readable / Modular**: clean two-hook split with a single well-named "flush slot" contract (`registerLayoutFlush`/`LayoutFlush`) connecting them; no duplication introduced. Naming and comments clearly describe the hazard §4.1 contract in all three touched UI files.
- **Type safety**: no `any`; `LayoutFlush = (() => void) | null` and `PanelUpdatesFlushHandle` are precisely typed; `MutableRefObject` used correctly.
- **Error handling**: `flushPanelUpdates`'s `.catch()` retains pending updates for retry (commented); `persistLayout`'s `.catch()` preserves prior desktop semantics (unchanged, not a regression).
- **Tests meaningful**: the new HEL-304 suite and rewritten HEL-301 test exercise real behavior (auto-save tick via fake timers, Save-now via a directly-supplied `SaveStateContext`, resize-mid-edit via `rerender` + mocked `useContainerWidth`) — these would catch a real regression (confirmed by the executor's own before/after probe: 4 failures pre-fix, 0 post-fix).
- **No dead code**: `usePanelGridSave.ts` cleanly deleted; no leftover TODO/FIXME.
- **No over-engineering**: the split is the minimum needed to satisfy the width-independent-flush requirement while keeping layout structurally desktop-only; no speculative abstraction.
- **Behavior-preserving where expected**: diffed `DesktopPanelGrid.tsx` is a `forwardRef`-removal dedent with no logic changes to drag/resize/title-edit/click handling (line-by-line comparison confirms only whitespace/indent + the `useLayoutSave` swap changed).
- **tsc**: 54 pre-existing `strict`-mode errors in `toastListeners.ts`/`listenerMiddleware.ts` (unrelated files) are present identically on `main` — confirmed by running `tsc --noEmit` in the actual main worktree — not a regression introduced by this change.

### Phase 3: UI Review — PASS
Issues: none blocking (see note on evaluator process error below, fully remediated with no code impact).

Verified live at http://localhost:5477 (backend :8384) using the HEL-247 "Collections Eval" dashboard (two `collection_options` / V57 panels):

- **Phone width (390×844), collection panel appearance edit**: opened the detail modal, changed background color, saved (staged into `pendingPanelUpdates`, confirmed via the "Unsaved changes" indicator, which is visible at phone width). Clicking "Save now" dispatched `POST /api/panels/updateBatch` (network-confirmed), cleared pending state, and the color survived a full page reload (confirmed via `getComputedStyle` diff pre/post reload).
- **Phone-width title edit**: same modal flow with a title change; "Save now" flushed `updatePanelsBatch`; title persisted through reload; no `beforeunload` warning on the subsequent navigation (confirming no residual pending state).
- **Resize-mid-edit strand (desktop → phone)**: staged an appearance edit at 1440px, resized to 390px before the flush interval elapsed. The edit was **not stranded** — it flushed via the width-independent auto-save interval (network-confirmed `POST /api/panels/updateBatch`) and persisted through reload.
- **Tablet width (~760px)**: renders `MobilePanelStack`, not the RGL grid — consistent with the `sm: 768` boundary.
- **HEL-301 zero-layout-PATCH guard**: across all of the above (mobile browsing, phone-width edits, the resize-mid-edit transition, and the 768px boundary crossing in both directions), the network log shows **zero** `PATCH /api/dashboards/:id` requests — only the panel-batch POST and an unrelated `PATCH /api/users/me/update` (theme toggle).
- **Breakpoints**: 1440 and 1100 render the RGL `<Responsive>` grid; 768 and 390 render `MobilePanelStack`; no console errors at any width; no layout breakage observed.
- **Console**: zero errors throughout all flows (a few pre-existing, unrelated warnings from `selectPipelineOutputDataTypes` memoization).

**Decision-3 fallback verification**: read `useLayoutSave.ts`'s unmount cleanup — it calls only `registerLayoutFlush(null)` (clearing the slot), with **no** `persistLayout()` invocation on unmount, exactly matching the documented fallback (no unmount layout flush; the residual desktop-drag-then-shrink layout edge is left unpatched and out of AC #1's scope). The pure-resize zero-layout-PATCH guard (test + live network check) passes. The appearance/title strand on the same resize path is fixed by the hoisted flush (verified live above). The reasoning in `tasks.md`'s Resolution notes and `files-modified.md`'s audit note is sound and matches the actual code — no gap between what's claimed and what's implemented.

**Process note (transparency, not a code defect)**: mid-review I mistakenly ran `git checkout main -- .` inside this worktree's `frontend/` directory while doing an unrelated `tsc` comparison, which transiently reverted the working tree to `main`'s pre-fix files (caught via live React-fiber inspection showing the old single-hook `usePanelGridSave` shape instead of the split hooks). This was immediately diagnosed and fixed with `git restore --staged --worktree .`, confirmed clean via `git status`/`git diff`, and all Phase 3 findings above were captured (or re-captured) against the correctly-restored, committed code (commit `e91f6d0a`). No code or commit was altered; this is disclosed per the verification-before-completion standard.

### Overall: PASS

### Non-blocking Suggestions
- None.
