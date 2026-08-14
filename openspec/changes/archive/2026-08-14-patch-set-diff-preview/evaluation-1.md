## Evaluation Report — Cycle 1 (evaluation-1.md)

**Diff scope note:** `git diff main...HEAD` pulls in four prior, already-separately-merged
batch tickets (HEL-328/627/403/406) because this worktree's local `main` ref predates their
merge. The correct scope for this review is `git diff 22de7331..HEAD` (HEL-408's own commit,
parent = HEAD~1 = the HEL-406 commit already on this branch) — 37 files, +4094/-9, matching
`files-modified.md` exactly. All findings below are scoped to that diff.

### Phase 1: Spec Review — PASS

- All 6 ticket ACs addressed explicitly, none reinterpreted:
  - AC1 (`POST /api/patch-sets/preview` returns diff, writes nothing): verified via
    `PatchSetPreviewRoutesSpec` (6.6, asserts unchanged resources after the call) and live
    manual testing (before/after JSON matched, resource unchanged pre-Accept).
  - AC2 (preview/apply share pre-validation): `PatchSetPreviewService.preview` calls
    `PatchSetApplyResolvers.resolveAll` verbatim, same as `PatchSetApplyService.apply`
    (`PatchSetPreviewService.scala:48`); `PatchSetPreviewServiceSpec` 6.3a/6.3b assert
    preview and apply reject the same patch set identically.
  - AC3 (impact hints — stale-rows/unbind/re-run): all 5 hint categories present and each
    has a dedicated test (`PatchSetPreviewServiceSpec` 6.5a-j).
  - AC4 (frontend reuses `ProposalReview` patterns; Accept routes to apply; nothing written
    until Accept): `PatchSetReview.tsx` reuses `Modal`/`InlineError` identically to
    `ProposalReview.tsx`; `PatchSetReviewPage.tsx` wires Accept to the existing
    `applyPatchSet`/`POST /api/patch-sets/apply` (HEL-406, unmodified). See Phase 3 for a
    real gap in what happens *after* Accept succeeds.
  - AC5 (gates green, DESIGN.md followed): reverified fresh, see Phase 2.
  - AC6 (additive-only): confirmed — no existing route/protocol modified; `PatchSetRoutes.scala`
    gained a new `path("preview")` block alongside `/apply`, `ApiRoutes.scala`/`JsonProtocols.scala`
    got additive wiring only.
- All 26 tasks in `tasks.md` map 1:1 to real, present code — no task marked done without a
  corresponding artifact (verified file-by-file against `files-modified.md`).
- No scope creep: diff is confined to the patch-set-preview feature folder/files; no unrelated
  refactors.
- No regressions to existing behavior: `PatchSetRoutesSpec.scala`'s existing apply-route tests
  still pass unmodified aside from the new `patchSetPreviewService` constructor param; HEL-406's
  own files (`PatchSetApplyResolvers.scala`, etc.) are untouched by this diff.
- Schema (`patch-set-preview-response.schema.json`) matches `EditPreview`/`PatchSetPreviewResponse`
  field-for-field; `npm run check:schemas` passes.
- design.md's D1-D7 + D1a all verified implemented as documented (see Phase 2 for the specific
  cross-checks against the four content-check gaps, the RLS-scoped `existsBoundToType`, the D6
  route, and the D3 timestamp exclusion — all confirmed present, correct, and tested).

### Phase 2: Code Review — PASS

**Fresh gate run (this worktree, HEAD = `0c3fc279`):**
- `npm run lint` — clean (0 warnings).
- `npm run format:check` — clean.
- `npm test` (root + frontend) — 148 + 1567 = 1715 passed, 0 failed (frontend: 156 suites /
  1567 tests, matches executor's report).
- `npm --prefix frontend run build` — succeeds (one pre-existing >500kB chunk-size advisory,
  unrelated to this diff).
- `cd backend && sbt test` — 2676/2676 passed, 0 failed (matches executor's report).
- `npm run check:scala-quality` — clean; 95 pre-existing informational file-size warnings,
  including `PatchSetPreviewProjection.scala` at 411 lines (>~400 soft threshold) — matches the
  executor's own disclosure, informational only, does not block.
- `npm run check:schemas` — clean (46 protocols checked).
- `npm run check:openspec` — flags "complete (26/26) but not archived", matching the disclosed,
  precedented pre-commit-bypass rationale (archiving is a separate, later orchestrator phase).

**D1/D1a content-check parity (explicit focus area #1):** all four gaps design.md names are
closed and each has a dedicated test asserting the SAME error `apply` would give:
panel blank-title (6.4a), panel scatter+aggregation (6.4b), pipeline blank-rename (6.4c),
dataType computed-field length/validity (6.4d/6.4e), dataType owned-panel conflict (6.4f),
dataType source-link conflict (6.4g). `dataTypeDeleteAfter` (`PatchSetPreviewProjection.scala:
305-318`) checks `checkSourceLink` FIRST then `existsBoundToAnyOwnedPanel` SECOND — verified
against the real `DataTypeService.delete` (`DataTypeService.scala:126-141`), same order.
A `Left` from any content check does fail the WHOLE call — `PatchSetPreviewService.
previewResolved`'s `loop` (`PatchSetPreviewService.scala:61-69`) short-circuits on the first
`Left` regardless of whether it came from `resolveAll` or from `PatchSetPreviewProjection.project`.
This is directly tested for a `resolveAll`-level rejection in a 2-edit set (6.3a: edit 0 valid +
edit 1 rejected → whole call fails, edit 0's target unchanged) but **not** for a D1a
content-check-level rejection specifically — every 6.4 test uses a single-edit patch set. The
short-circuit code path is identical for both cases (same `loop`), so this is a test-coverage
gap, not a functional defect — see Non-blocking Suggestions.

**D4 `PanelRepository.existsBoundToType` (explicit focus area #2):** confirmed genuinely
RLS-scoped — `PanelRepository.scala:228-230`'s SQL (`SELECT COUNT(*) FROM panels WHERE type_id
= ...`) carries no `owner_id` predicate. Its test (`PatchSetPreviewServiceSpec.scala`, "6.5
(direct)" section, lines 647-670, plus the service-level 6.5i/6.5j cross-owner scenarios) uses
the real, non-superuser `helio_app_test` dual-pool harness (lines 86-132 — `SET ROLE
helio_app_test` on the app pool, mirroring `WorkspaceTeardownServiceSpec.scala`), not the
simplified `DbContext(db, db)` pattern. The tests genuinely exercise RLS narrowing: a bound
panel on a dashboard the caller can see via a sharing grant → `true`; the same fixture with no
grant → `false` — proving the distinction is real, not just that the method compiles under a
superuser connection that would trivially return the same result either way.

**D6 `PatchSetReviewPage.tsx` reachability (explicit focus area #3):** confirmed live — see
Phase 3.

**D3 timestamp exclusion (explicit focus area #4):** confirmed both in code (`dashboardUpdateAfter`/
`dataSourceUpdateAfter`/`dataTypeUpdateAfter` all leave `meta`/`updatedAt` at `prior`'s value) and
via a dedicated test (`PatchSetPreviewServiceSpec.scala` line 332: "leave an update edit's
after.meta.lastUpdated at prior's value, not a guessed write-time").

**Other checks:**
- DRY: `after`-projection reuses real shared pure functions throughout (`PanelServiceHelpers.
  resolvePatch`/`validateScatterAggregationConflict`, `PanelConfigCodec.applyConfigPatch`,
  `DashboardServiceValidation.validateDashboardUpdateRequest`, `PipelineStepConfigCodec.decode`) —
  no reimplementation of business logic found.
- No inline FQNs (`check:scala-quality` mechanical check clean).
- No dead code / no TODO/FIXME in the new files; no `any`/unsafe casts in the new frontend files.
- CSS (`PatchSetReview.css`) uses `--app-*`/`--space-*`/`--text-*` tokens throughout, no hardcoded
  hex/px values beyond the `2px` optical tweak explicitly permitted by DESIGN.md §3 ("small
  optical tweaks ≤ 4px may be literal") — the exact same `2px var(--space-2)` recipe
  `ProposalReview.css:62`'s `.proposal-review__type` already uses.
- Error handling: `resolveAll`/content-check failures propagate as `Left(ServiceError)` end to
  end; frontend `PatchSetReviewPage.tsx` has distinct `loadError`/`previewError`/`applyError`
  states, each rendered via `EmptyState`/`InlineError` — no silent swallowing.

### Phase 3: UI Review — FAIL

Servers started via `scripts/concertino/start-servers.sh`/`assert-phase.sh` (`PASS servers`).
Logged in via the persisted dev session; navigated to `/patch-sets/review` directly.

**Confirmed working:**
- `/patch-sets/review` is genuinely reachable and renders (D6, focus area #3) — no router-state
  patch set supplied, the page synthesized the demo patch set from the workspace's first
  dashboard/panel, called `previewPatchSet`, and rendered the diff modal with 1 edit
  (panel/update), full before/after JSON, Reject/Accept & apply buttons.
- No console errors or warnings at any point during the flow (initial load, Accept, Reject).
- Light theme renders correctly (verified via screenshot) — proper contrast, opaque surfaces,
  no accent misuse.
- Breakpoints 1100/768/430 all render without layout breakage — no overflow, no clipped
  buttons; at 430px the two-column before/after JSON grid gets visually dense (small
  `--text-xs` JSON wrapping mid-token) but stays contained within the modal (no viewport
  overflow) — a [judgment] density call for the skeptic, not a mechanical breakage.
- Interactive elements have accessible names (Close/Reject/Accept & apply all exposed via
  role="button" with text).
- Reject correctly navigates home without calling apply.

**Defect found — Accept does not refresh the app's cached state, leaving stale data visible
without a manual reload:**

Reproduced live: navigated to `/patch-sets/review` (demo patch set targets the *currently
active* dashboard's first panel, titled "Total Revenue by Region"), clicked "Accept & apply".
The SPA navigated to `/` (client-side, no reload) and the panel grid still showed the OLD title
"Total Revenue by Region" — the backend write had genuinely succeeded (confirmed: a fresh
`page.goto("/")` full reload immediately after showed "Total Revenue by Region (previewed)"),
but the in-memory Redux `panelsSlice.items` cache was never invalidated, so the currently-viewed
dashboard rendered stale data after Accept.

Root cause: `patchSetsSlice.ts`'s `applyPatchSet` thunk (`patchSetsSlice.ts:47-61`) does nothing
with the `PatchSetApplyResponse`'s per-edit `resultingState` beyond storing `applyStatus:
"succeeded"` — it never dispatches `markDashboardPanelsStale` (`panelActions.ts:13`, the
existing mechanism `createPanel`/`deletePanel`/`duplicatePanel` already use for exactly this
purpose — `panelThunks.ts:103,131,145`) nor merges the touched resource into `panelsSlice`/
`dashboardsSlice` the way `updatePanelTitle.fulfilled`/`updatePanelAppearance.fulfilled` already
do (`panelsSlice.ts:117-126`, `state.items = state.items.map(...)`). `dashboardsSlice.
applyProposal` (the pattern this ticket's design.md explicitly claims to mirror "exactly")
never hits this class of bug structurally — it only ever *creates* a brand-new dashboard and
selects it (`dashboardsSlice.ts:271-274`), so the newly-selected id was never cached and always
triggers a fresh `fetchPanels`. Patch-set apply is structurally different — it *mutates* an
existing, potentially-already-cached resource — and this exact "apply succeeded but the visible
UI didn't refresh" class of bug is precedented and was previously treated as a real defect in
this codebase: `HEL-290 "Refresh sidebar dashboard list after proposal apply"` (merged, referenced
in `ProposalReviewPage.tsx`'s own `handleAccept` comment). This is not a hypothetical edge case —
it reproduces on the very demo/fixture entry point design.md D6 requires this page to ship with
("the first dashboard's first panel"), which is very likely to be the dashboard/panel already
active in the session that navigated here.

This is a real, specific, user-facing defect in the ticket's own "Accept" flow, not a cosmetic
or judgment-only issue — the review-then-accept loop's entire value proposition is that the user
sees the result of what they just accepted.

### Overall: FAIL

### Change Requests

1. **Fix stale-cache-after-Accept in `patchSetsSlice.ts`/`PatchSetReviewPage.tsx`.** After
   `applyPatchSet` fulfills, invalidate or merge the Redux state for every resource kind/id the
   applied patch set touched — at minimum, dispatch `markDashboardPanelsStale(dashboardId)`
   (`frontend/src/features/panels/state/panelActions.ts:13`) for any touched panel's
   `dashboardId` (mirroring `panelThunks.ts:103,131,145`'s existing usage), and the equivalent
   for a touched dashboard's own fields in `dashboardsSlice`. Add an RTL assertion to
   `PatchSetReviewPage.test.tsx` (or `patchSetsSlice.test.ts`) that verifies the relevant slice
   is invalidated/updated after `applyPatchSet.fulfilled`, so this doesn't silently regress again.

### Non-blocking Suggestions

- Add a `PatchSetPreviewServiceSpec.scala` test with a 2+ edit patch set where a LATER edit
  (not edit 0) triggers a D1a content-check rejection (e.g. edit 0 = valid panel rename, edit 1
  = blank pipeline-rename), asserting the whole call fails and edit 0's target is unchanged —
  the existing 6.3a test covers this shape only for a `resolveAll`-level rejection, not a
  content-check-level one, even though both go through the same short-circuit `loop`
  (`PatchSetPreviewService.scala:61-69`, verified correct by inspection).
- At the 430px breakpoint, `PatchSetReview.css`'s before/after JSON columns get visually dense
  (heavy mid-token wrapping in `--text-xs` mono). Not a mechanical violation (contained, no
  overflow) — worth a skeptic [judgment] look at whether a narrower single-column stack below
  768px would read better, matching the density it already gives DataGrid's `condensed` variant.
