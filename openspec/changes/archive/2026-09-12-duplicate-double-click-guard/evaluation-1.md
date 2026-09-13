## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
- All three ticket surfaces (dashboard, panel, pipeline step) are wired with the shared `useInFlightGuard` idiom.
- All 4 acceptance criteria addressed: single clone on double-activation (verified live in-browser for both dashboard and pipeline-step surfaces — exactly one POST each), re-enable after settle (unit + integration tests for resolve and reject), frontend tests cover the double-activation case for each surface, and the guard is ref-based/synchronous (not `useState`-only) per the ticket's explicit requirement.
- Wiring matches design.md's corrected file/line references exactly: three actual `<StepCard>` render sites (`PipelineRiverView.tsx` line ~421, `LaneColumn.tsx` lines ~200/244), `RootColumn.tsx` is pass-through only (no `StepCard` there), `isDuplicating` (not `disabled`) is the new `StepCard` prop, `duplicatingStepIds` threaded as a `ReadonlySet<string>` (not a function prop) to preserve `React.memo`.
- Tasks 1.1–1.5 and 2.1–2.4 in tasks.md are all checked and match the diff; `files-modified.md` matches the actual changed-file set exactly (verified via `git diff --name-only`).
- No scope creep — diff touches exactly the files proposal.md/design.md/files-modified.md enumerate, plus the OpenSpec change artifacts.
- No regressions found in the surrounding step/dashboard/panel logic (e.g. `usePipelineDetailPage.ts`'s existing CR10 resync-from-server behavior after duplicate is preserved, just now wrapped by the guard).
- No CONSTRAINTS entries in workflow-state.md require separate handling here (frontend-only change, `check:scala-quality` etc. not implicated).

### Phase 2: Code Review — FAIL
Gates (fresh run, `WORKTREE_PATH`, no `CLEAN_WORKTREE`):
- `npm run lint` — PASS (0 warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (270 helio-mcp + 3347 frontend tests, all green)
- `npm --prefix frontend run build` — PASS

Code-quality review:
- `useInFlightGuard.ts` matches design.md Decision 1 precisely (ref as sync source of truth, mirrored `useState` for render, `.catch(() => {}).finally()` cleanup contract, documented). Well-scoped, no over-engineering, no dead code.
- `PanelCard.tsx`/`DashboardList.tsx` wiring matches Decision 2/3 exactly (dropped `void`, `guardedRun` wraps existing async shape, `disabled: isPending(id)` on the existing `ActionsMenuItem`).
- Pipeline-step wiring matches Decision 3's corrected file/line references exactly (verified against the live tree, not just the design doc's claims).
- **Mutation-tested the tests themselves** (temporarily removed the `guardedStepDuplicateRun` wrapping in `usePipelineDetailPage.ts` and reran the HEL-706 tests in `PipelineDetailPage.test.tsx`): all three new tests failed as expected (0/2 calls instead of 1/2, button not disabled) — confirms these are real regression tests, not evidence-shaped non-evidence. Reverted the mutation afterward (`git checkout --`, worktree clean).
- `useInFlightGuard.test.ts`'s first test fires two synchronous `guardedRun` calls inside one `act()` block with no `await` between them — genuinely exercises the same-tick re-entry race per the standing constraint, not merely a rendered-disabled-button proxy.
- `PipelineDetailPage.test.tsx`'s "two synchronous activations" test fires two `fireEvent.click` calls back-to-back with no `await`/render between them on the same captured DOM node reference, exactly matching tasks.md 2.4's explicit design and the standing constraint. Confirmed via mutation testing above that this test would fail if the guard were removed.
- `PanelCard.test.tsx`/`DashboardList.test.tsx` reopen the menu between activations per design.md Decision 3's correct characterization of `ActionsMenu`'s close-on-click behavior — these tests inherently cannot exercise the *same-tick* race (a real re-render happens on reopen), but that gap is covered instead by the hook's own direct synchronous test (`useInFlightGuard.test.ts`), exactly as tasks.md 2.4 itself notes. No gap in coverage.

**Defect — missing disabled-state CSS for the new `isDuplicating`-gated `StepCard` control (DESIGN.md / CONTRIBUTING.md consistency, mechanical):**
`frontend/src/features/pipelines/ui/PipelineDetailPage.css` gives the sibling `.pipeline-detail-page__step-card-move-btn` (same icon-button group, same file, disabled via the pre-existing `HEL-866` reorder-at-boundary case) both:
- a `:hover:not(:disabled)` guard (line 427) so a disabled button shows no hover feedback, and
- a `.pipeline-detail-page__step-card-move-btn:disabled { opacity: 0.35; cursor: not-allowed; }` rule (lines 434–437).

`.pipeline-detail-page__step-card-duplicate-btn` gets neither:
- its `:hover` rule (line 429) has no `:not(:disabled)` guard — hovering a disabled (in-flight) duplicate button still shows the full hover background/color change, i.e. it visually looks live and clickable while it is inert.
- there is no `.pipeline-detail-page__step-card-duplicate-btn:disabled` rule at all — verified live in the running app (dark theme, `HEL-1022 Matt Test Pipeline`, screenshot `.playwright-mcp/dark-disabled2.png`): forcing `disabled=true` on the button leaves the copy icon at full opacity with no `cursor: not-allowed`, indistinguishable from the enabled state.

This is not a subjective/judgment call — it's a mechanical parity gap against an existing, established pattern in the exact same selector group in the exact same file (the very comment above lines 415–423, added for `HEL-866`, explicitly reasons about correct disabled/hover feedback across "the drag handle, move, toggle, and duplicate buttons" as one group). Shipping `isDuplicating` without matching CSS leaves the pipeline-step surface's disabled affordance silently non-functional visually, while the dashboard/panel surfaces (which route through the shared `ActionsMenuItem`, whose `.actions-menu__item:disabled` rule already exists) are fully correct. The functional guard itself (re-entry-proofing, single POST, re-enable-after-settle) is unaffected and verified working — this is a UI-feedback gap only, not a functional regression.

**Required fix:** in `frontend/src/features/pipelines/ui/PipelineDetailPage.css`:
1. Line 429 — add `:not(:disabled)` to `.pipeline-detail-page__step-card-duplicate-btn:hover` (or fold it into the existing `move-btn` line's selector group with the same guard).
2. Add `.pipeline-detail-page__step-card-duplicate-btn:disabled { opacity: 0.35; cursor: not-allowed; }` (matching the `move-btn:disabled` rule at lines 434–437, or combine the two `:disabled` rules into one selector list) so a pending duplicate genuinely reads as disabled in both light and dark themes.

### Phase 3: UI Review — FAIL (blocked on the Phase 2 finding above; otherwise clean)
Servers started via `scripts/concertino/start-servers.sh`/`assert-phase.sh` (PASS, ports 6138/9045).
- Dashboard duplicate happy path: clicked the "Duplicate" menu item on `SKF2-82col` — exactly one `POST /api/dashboards/:id/duplicate` (201), navigated to the new "SKF2-82col (copy)" dashboard, no console errors.
- Pipeline-step duplicate happy path (`HEL-1022 Matt Test Pipeline`): clicked "Duplicate step" — exactly one `POST /api/pipeline-steps/:id/duplicate` (201), no console errors attributable to this change (one pre-existing, unrelated 404 on `/schedule` for a pipeline with no schedule set, present before this change).
- No console errors during either tested flow.
- Interactive elements (menu items, `StepCard`'s duplicate button) retain their existing accessible names (`aria-label`/`title="Duplicate step"`, `ActionsMenuItem` role="menuitem") and keyboard support (unchanged from the pre-existing `ActionsMenu`/`StepCard` implementations) — this change adds a `disabled` state, doesn't touch focus/keyboard handling.
- Dark-theme screenshot of the pipeline-step duplicate control: `.playwright-mcp/dark-step.png` (enabled state, renders correctly, no visual regression).
- Disabled-state screenshot (forced via `element.disabled = true`): `.playwright-mcp/dark-disabled2.png` — confirms the CSS gap above: the icon renders identically to the enabled state, no dimming, no `cursor: not-allowed`.
- Did not repeat this specific disabled-state check in light theme — the CSS gap (missing selector entirely) is theme-independent by construction (no rule exists for the button to differ under either theme's tokens), so a light-theme screenshot would not add information beyond confirming the same absence.
- Breakpoint resize (1440/1100/768/0) not performed — deferred pending the Phase 2 fix, since re-testing after a code change is required regardless.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/pipelines/ui/PipelineDetailPage.css` line 429: add `:not(:disabled)` to `.pipeline-detail-page__step-card-duplicate-btn:hover` so a disabled (in-flight) duplicate button doesn't show hover feedback.
2. `frontend/src/features/pipelines/ui/PipelineDetailPage.css` line ~434 (alongside the existing `.pipeline-detail-page__step-card-move-btn:disabled` rule): add a matching `.pipeline-detail-page__step-card-duplicate-btn:disabled { opacity: 0.35; cursor: not-allowed; }` rule (or combine both buttons into one `:disabled` selector list) so the pending duplicate state is visually legible in both light and dark theme, consistent with the sibling `move-btn` and with `ActionsMenuItem`'s existing `.actions-menu__item:disabled` styling on the dashboard/panel surfaces.
3. After the CSS fix, re-verify the disabled state renders correctly in both light and dark theme (screenshot both) and re-run the breakpoint sweep (1440/1100/768/0) as part of Phase 3 UI review before the next evaluation pass.

### Non-blocking Suggestions
- None beyond the required fix above — the guard implementation, wiring, and test suite are otherwise solid and match design.md's decisions precisely.
