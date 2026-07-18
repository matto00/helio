## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 3 acceptance criteria addressed explicitly:
  1. Staged layout survives shrink below 768px — implemented via flush-on-unmount in `useLayoutSave.ts:109-122`; verified live (see Phase 3) and via Jest test 3.1.
  2. HEL-301 guard still passes — pre-existing `PanelGrid.test.tsx` HEL-301 describe block (lines 406-550) unmodified and green; live-reverified (Phase 3).
  3. Regression test for shrink-mid-edit path — added (tests 3.1-3.3, `PanelGrid.test.tsx:671-797`).
- No AC silently reinterpreted. Design chose flush-on-unmount over restore-on-remount, an option the ticket explicitly allowed ("flushed or restored on remount").
- All `tasks.md` items marked `[x]` match what was implemented: probe evidence in `files-modified.md` (unfixed-code failure reproduced, then fixed), fix in `useLayoutSave.ts`, header-comment updates in the two other files, 3 new regression tests, column-widths and other-consumers audit (4.1/4.2), gates run.
- No scope creep: diff touches exactly the 4 files listed in `files-modified.md` (`useLayoutSave.ts`, `DesktopPanelGrid.tsx` comment-only, `usePanelUpdatesFlush.ts` comment-only, `PanelGrid.test.tsx`) plus `openspec/` planning artifacts. No backend/schema changes, matching the ticket's frontend-only scope.
- No regressions: full frontend suite (106 suites / 1124 tests) passes fresh; live manual check across breakpoints found no new console errors.
- No API/schema changes needed or made.
- Planning artifacts (`design.md` D1-D4, `proposal.md` Impact section) match the implemented code exactly — verified line-by-line against the diff (ref-pattern, empty-dep unmount effect, direct `persistLayout` call bypassing the slot).

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md [mechanical]**: no inline FQNs (TS-only change, rule targets Scala). File-size soft budgets: `useLayoutSave.ts` 139 lines (well under budget); `DesktopPanelGrid.tsx`/`usePanelUpdatesFlush.ts` grew by comments only (8 and 6 lines respectively) — CONTRIBUTING states file-size warnings are informational only, and neither crossed a new threshold because of this change. `PanelGrid.test.tsx` grew to 797 lines (+135); test files are the design-approved home for these regression tests (design.md D4) and CONTRIBUTING's size gate is explicitly informational.
- **DRY**: the fix reuses the exact "latest-ref" pattern already established by `usePanelUpdatesFlush` (cited by the executor in-code and in `files-modified.md`), rather than inventing a new mechanism.
- **Readable**: clear naming (`persistLayoutRef`), comments explain *why* (empty-dep effect decoupled from `persistLayout` identity churn), no magic values.
- **Modular**: fix is fully contained inside `useLayoutSave`; the two "documentation-only" file touches correctly avoid introducing any new coupling.
- **Type safety**: no `any`/unsafe casts introduced.
- **Error handling**: unmount flush reuses `persistLayout`'s existing catch-and-swallow semantics (consistent with pre-existing auto-save-tick behavior); design.md explicitly documents and accepts the one residual risk (a failed unmount-flush PATCH has no retry path since there's no "next change" below the boundary) as no worse than today's 30s-interval failure mode.
- **Tests meaningful**: tests exercise the real `PanelGrid` → `DesktopPanelGrid` → `useLayoutSave` production code tree, only mocking `react-grid-layout`'s DOM-dependent `<Responsive>` and the network-layer service function (`updateDashboardLayout` request) — not the thunk itself — so a regression in the actual flush logic would fail these tests. Ran fresh: `npx jest --testPathPatterns=PanelGrid.test` → 24/24 pass, including the unfixed-code probe recorded in `files-modified.md` (2 failed before the fix, 24 pass after).
- **No dead code / no over-engineering**: the separate empty-dep effect is justified in design.md D2 (decoupling flush timing from `persistLayout` identity changes) rather than piggy-backing on the existing registration effect — a deliberate, documented choice, not premature abstraction.
- **Behavior-preserving elsewhre**: `DesktopPanelGrid.tsx` and `usePanelUpdatesFlush.ts` diffs are comment-only, confirmed via `git diff`.

Non-blocking: test 3.3's supporting assertion `expect(MockResponsive).not.toHaveBeenCalledTimes(0)` (`PanelGrid.test.tsx:~761`) is a near-tautology (true as long as the grid ever rendered) and doesn't actually verify the comment's claim ("no PATCH originates while the mobile stack is mounted") — that guarantee is structurally covered elsewhere (mobile stack imports no layout-write path, confirmed via `MobilePanelStack.tsx:6-7`), so the test's real value is in the exact-once PATCH-count assertions later in the same test, which are sound. Consider replacing or removing that line in a follow-up for clarity.

### Phase 3: UI Review — PASS
Issues: none.

Fresh gates (worktree, not trusting executor's report):
- `npm run lint` → clean, zero warnings.
- `npm run format:check` → clean.
- `npm test` → 106 suites / 1124 tests pass, including all `PanelGrid.test.tsx` HEL-301/304/306 tests.

Live verification via Playwright against `scripts/concertino/start-servers.sh` (ports 5479/8386, dev login):
- **Shrink-mid-edit flush (AC1)**: staged a real layout change (resized a panel via its `.react-resizable-handle-se` handle, synthetic mouse events simulating a real drag/resize sequence) on desktop (1440px). Confirmed via network monitor that no PATCH fired while staged. Resized the viewport to 375px (crossing 768px) and confirmed **exactly one** `PATCH /api/dashboards/:id/update` fired. Reloaded the page and confirmed the resized panel width (684px) persisted server-side — the staged edit survived the shrink and was not lost.
- **HEL-301 guard, live (AC2)**: on a fresh dashboard load with no staged change, resized 1440px → 375px (crossing the boundary) and back to 1440px: zero PATCH requests in either direction.
- **Rapid repeated 768px crossings**: staged a second layout change (resize), then crossed 1440→375→1440→375 in quick succession: **exactly one** PATCH fired across the whole sequence (in-flight/equality guards behaved as designed, matching Jest test 3.3).
- **Console**: 0 console errors throughout all interactions (2 pre-existing warnings observed are unrelated cross-session noise from other parallel worktree ports, not from this session's port 5479, and unrelated to this change).
- **Breakpoints**: checked 1440 / 1100 / 768 / 320 — dashboard renders without layout breakage at each; the sm boundary swap (desktop grid ↔ mobile stack) behaves as expected pre-existing behavior.
- **HEL-304 column-widths re-verify (repro-widening)**: confirmed live and via code read that `useTableDisplayState`/`accumulatePanelUpdate`/`usePanelUpdatesFlush` is a separate, width-independent path unaffected by this change — matches the executor's audit note in `files-modified.md`.
- Playwright screenshots were written to `.playwright-mcp/` (gitignored) inside the worktree; one screenshot was transiently written to the repo root by a tool default and was immediately deleted — no stray files remain (`git status` shows only the expected `workflow-state.md` change).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `frontend/src/features/panels/ui/PanelGrid.test.tsx` (HEL-306 test 3.3, "persists the staged layout exactly once across rapid repeated boundary crossings"): the line `expect(MockResponsive).not.toHaveBeenCalledTimes(0);` is a near-tautological assertion that doesn't test what its surrounding comment claims. Either remove it or replace it with an assertion that actually distinguishes "PATCH originated while mobile stack mounted" (e.g., asserting `updateDashboardLayoutMock` call count is unchanged immediately after the down-crossing before any interaction, which the test already does via `patchesAfterFirstDown`). Not blocking — the exact-once PATCH-count assertions that follow already give the test real teeth.
