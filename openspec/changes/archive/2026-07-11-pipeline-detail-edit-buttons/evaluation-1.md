## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- Ticket AC 1 ("No accidental source/type changes possible") — buttons are navigation-only;
  no inline edit affordance added. Verified in diff and live UI.
- Ticket AC 2 ("Edit Source / Edit Type are visible, deliberate actions") — both buttons render,
  right-aligned, in their own bars. Verified live (Profit / Popover Test Pipeline fixtures).
- Ticket AC 3 ("Copy stays singular") — "DATA SOURCE" / "OUTPUT TYPE" labels, no plural anywhere;
  already true pre-change, correctly not re-touched.
- Ticket AC 4 ("Permissions gated by ownership of source/type, not just pipeline") —
  `canEditSource`/`canEditType` computed from owner-scoped `sources.items`/`dataTypes.items`,
  independent of `isOwner`/pipeline-sharing role. Covered by
  `PipelineDetailPage.test.tsx`'s "shared pipeline without source/type ownership" case
  (`ownerId: "someone-else"`, empty owner-scoped lists → both buttons absent). All green.
- tasks.md 1.1–1.7 and 2.1–2.4 all map 1:1 onto the diff (`PipelineDetailPage.tsx`,
  `BoundSourceBar.tsx`, new `BoundTypeBar.tsx`, CSS, three test files) — no partial or
  reinterpreted items.
- No scope creep — diff touches exactly the files listed in `files-modified.md`/design.md's
  Impact section; no unrelated refactors.
- No regressions — full frontend suite (781 tests / 66 suites) passes; lint/format/build clean.
- API contracts — none affected; design.md correctly scoped this as a client-only, no-new-endpoint
  change (reuses already owner-scoped `GET /api/data-sources` / `GET /api/types`).
- Planning artifacts (spec delta) match the implemented behavior exactly — verified scenario by
  scenario against the diff and live UI.

### Phase 2: Code Review — PASS
Issues: none blocking (see Non-blocking Suggestions).

- No Scala changes in this diff; `check:scala-quality` warnings present are 100% pre-existing test
  files unrelated to this change.
- Frontend: imports at top of file, no `any`, typed props on both new/extended components
  (`BoundSourceBarProps`, `BoundTypeBarProps`).
- DRY: `BoundTypeBar` mirrors `BoundSourceBar`'s visual structure but is deliberately a separate,
  single-concern component per design.md's explicit (skeptic-confirmed) decision — not
  duplication-for-duplication's-sake. CSS reuses the `share-btn` recipe via a new shared
  `__edit-btn` class rather than re-declaring styles.
- Readable: `canEditSource`/`canEditType`/`handleEditSource`/`handleEditType` naming is
  self-explanatory; no magic values.
- Modular: navigation handlers extracted as named functions; components stay presentational.
- Type safety: `DataType`/`DataSource` typed throughout; no untyped escape hatches.
- Error handling: `handleEditSource`/`handleEditType` both guard on undefined
  (`if (!boundSource) return;` / `if (!currentPipeline?.outputDataTypeId) return;`) before
  dispatching — no silent failure, no crash on stale state.
- Tests meaningful: `BoundSourceBar.test.tsx`, `BoundTypeBar.test.tsx`,
  `PipelineDetailPage.test.tsx` cover visible/hidden/click for both buttons plus the adversarial
  shared-pipeline-without-ownership case (tasks 2.1–2.4). A regression that dropped the ownership
  gate or broke the navigation wiring would be caught.
- No dead code: `npm run lint` (zero-warnings policy) passes clean — no unused imports/vars.
- No over-engineering: two small, additive components; no premature abstraction.
- Not a refactor — purely additive, no behavior-preservation concern applies.

Gates re-run fresh (this session, from the worktree):
- `npm run lint` → clean
- `npm run format:check` → clean
- `npx jest` → 66 suites / 781 tests passed
- `npm run build` → succeeds (pre-existing >500kB chunk-size warning, unrelated)
- `npx openspec validate pipeline-detail-edit-buttons --strict` → valid
- `npm run check:openspec` → only flags "not yet archived," expected mid-cycle
- `npm run check:scala-quality` → clean (pre-existing soft-budget warnings only, no Scala touched)

### Phase 3: UI Review — PASS
Issues: none blocking (see Non-blocking Suggestions for a pre-existing, unrelated layout gap
found during breakpoint testing).

Dev servers started via `scripts/concertino/start-servers.sh` /
`scripts/concertino/assert-phase.sh servers` — both PASS.

- Happy path end-to-end: logged in, opened two different pipelines ("Profit (migrated)" — Static
  source / DataType named "Profit"; "Popover Test Pipeline" — CSV source / "PopoverTestType").
  Both bars render correctly; clicking "Edit Source" navigated to `/sources` with that source
  selected (breadcrumb + pressed state confirmed); clicking "Edit Type" navigated to `/registry`.
- Ownership gating verified live: both fixtures used are owned by the logged-in dev user, so both
  buttons render — matches expectations. The not-owned/shared-pipeline path is covered by
  `PipelineDetailPage.test.tsx` (verified passing) since seeding a live cross-user share was out of
  scope for this pass.
- No console errors in any tested flow. One pre-existing console *warning*
  (`selectPipelineOutputDataTypes` unmemoized-selector warning) reproduces identically on
  `/registry` navigated to directly, with no pipeline-detail involvement — confirmed unrelated to
  this diff (no changes to `dataTypesSlice.ts` in this change).
- Accessible names / keyboard support: both buttons are real `<button type="button">` elements
  with clear text content ("Edit Source" / "Edit Type") — natively focusable and operable,
  `getByRole("button", { name: ... })` resolves them directly.
- Light/dark parity: switched to light theme live — both bars keep correct contrast and match the
  existing bar/button styling (token-driven, no hardcoded colors).
- Breakpoints: 1440 and 1100 render cleanly, buttons right-aligned as designed. At 768 and 375,
  the bound-source-bar/bound-type-bar label+value text becomes visually hidden — but I traced this
  to a **pre-existing app-shell bug**: the fixed-position `.app-sidebar` (`z-index: 10`, width
  240px) overlaps main content that starts at `x=0` instead of being offset, at those
  breakpoints. Confirmed by reproducing the identical overlap on the unrelated `/sources` page
  (no code from this change touches app-shell/sidebar CSS). Not introduced or worsened by this
  diff — out of scope for this ticket.

### Overall: PASS

### Non-blocking Suggestions
- `PipelineDetailPage.tsx` was already over CONTRIBUTING.md's ~400-line soft-budget threshold
  before this change (440 lines) and grew further to 477 lines. CONTRIBUTING.md asks that a file
  crossing ~400 lines get a proposed split noted in the PR description; none was proposed here.
  Not blocking (soft/informational budget, and the growth is small and directly on-topic), but
  worth a decomposition pass next time this file is touched.
- Pre-existing, app-wide layout bug found during breakpoint testing: the fixed `.app-sidebar`
  (width 240px, `z-index: 10`) overlaps main-content that spans the full viewport width instead of
  being offset by the sidebar's width, at ≤768px viewports. Reproduces on `/sources` too — clearly
  unrelated to this change, but worth a follow-up ticket since it affects real content
  legibility (bar labels/values, page headers) at those breakpoints app-wide.
