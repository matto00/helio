## 1. Frontend — shared util relocation

- [x] 1.1 Create `frontend/src/features/sources/utils/labelForKind.ts` exporting `labelForKind`
      (moved from `BoundSourceBar.tsx`, unchanged behavior)
- [x] 1.2 Update `CreatePipelineModal.tsx` and `ShapeInstantiateStep.tsx` to import `labelForKind`
      from the new location

## 2. Frontend — new header component

- [x] 2.1 Create `PipelineDetailHeader.tsx`: one bordered/backed container with three field
      groups (source, type, schedule), porting the JSX/logic from `BoundSourceBar`,
      `BoundTypeBar`, `PipelineScheduleBar` (incl. `formatNextRun`, `formatExpressionSummary`,
      the `Toggle` usage) — see design.md D1 for the "one container, no per-group bar styling"
      constraint
- [x] 2.2 Create `PipelineDetailHeader.css` (its own new file — MUST NOT add rules to
      `PipelineDetailPage.css`, whose `@media (max-width: 768px)`/`@media (max-width: 430px)`
      blocks are read by `PipelineDetailPage.css.test.ts`'s first-match `findMediaBlock` helper;
      a second same-prelude `@media` block anywhere in that file would make the test silently
      grab the wrong block — see design.md Risks) with a single header container style; field
      groups wrap onto their own row at/below 768px, matching the footer's existing breakpoint
      idiom
- [x] 2.3 Wire `PipelineDetailHeader` into `PipelineDetailPage.tsx` in place of
      `BoundSourceBar`/`BoundTypeBar`/`PipelineScheduleBar`

## 3. Frontend — footer consolidation

- [x] 3.1 Extend `PipelineDetailFooter.tsx`'s props to accept the Share button's `isOwner`/
      `onOpenShare` and the last-run metadata fields (`lastRunAt`, `lastRunRowCount`,
      `lastRunStatus`)
- [x] 3.2 Render the last-run metadata as a top row inside the footer container (only when
      `lastRunAt != null`), preserving the `"Last run metadata"` accessible label and the
      relative-time/row-count/status-chip content exactly
- [x] 3.3 Render the Share button inside `__footer-right`'s existing button group (owner-only),
      reusing the `__share-btn` class name so the existing 768px 44px-floor rule still applies
- [x] 3.4 Remove the standalone `__share-bar` div and `__meta-bar` div (and their renders) from
      `PipelineDetailPage.tsx`; pass the new props into `PipelineDetailFooter` instead

## 4. Frontend — CSS + cleanup

- [x] 4.1 Update `PipelineDetailPage.css`: remove `__source-bar`/`__type-bar`/`__schedule-bar`
      selectors (superseded by the new header), remove `__share-bar` selector; keep
      `__footer`, `__footer-right`, `__run-btn`, `__history-btn`, `__preview-btn`,
      `__dry-run-btn`, `__save-btn`, `__cancel-btn`, `__cancel-confirm-btn`, `__share-btn`,
      `__edit-btn` class names and their `@media (max-width: 768px)` / `@media (max-width: 430px)`
      rules unchanged (verify against `PipelineDetailPage.css.test.ts` before editing)
- [x] 4.2 Delete `BoundSourceBar.tsx`, `BoundTypeBar.tsx`, `PipelineScheduleBar.tsx`,
      `PipelineScheduleBar.css` once their behavior is fully ported (task group 5)

## 5. Tests

- [x] 5.1 Create `PipelineDetailHeader.test.tsx` porting every scenario from
      `BoundSourceBar.test.tsx`, `BoundTypeBar.test.tsx`, `PipelineScheduleBar.test.tsx` (name+kind
      display, Edit-button ownership gating for source and type, schedule empty/enabled/disabled/
      no-next-run-yet states, enable/disable toggle) against the new component
- [x] 5.2 Delete `BoundSourceBar.test.tsx`, `BoundTypeBar.test.tsx`, `PipelineScheduleBar.test.tsx`
      once 5.1 covers their assertions
- [x] 5.3 Extend `PipelineDetailFooter.test.tsx` (or `PipelineDetailPage.test.tsx`, whichever
      currently owns footer-level assertions) for the relocated Share button and last-run
      metadata, preserving the existing `"Last run metadata"` accessible-name assertions
- [x] 5.4 Update `PipelineDetailPage.test.tsx` for the new header/footer composition — the
      existing `"Edit source"`/`"Edit type"`/`"Last run metadata"` role/label assertions must
      keep passing unchanged; remove any assertions that reference retired component internals
- [x] 5.5 Run `PipelineDetailPage.css.test.ts` and confirm every asserted selector (`__footer`,
      `__footer-right`, `__run-btn`, `__history-btn`, `__preview-btn`, `__dry-run-btn`, the
      step-card icon-button selectors) still resolves in the restructured CSS — this is the
      HEL-687 regression guard, must not be weakened or deleted
- [x] 5.6 Run the full frontend Jest suite (not just touched files) and `npm run lint` — confirm
      no stray references to deleted components/selectors elsewhere in the app

## 6. Scope amendment — header action-menu consolidation + compaction (see design.md D5/D6)

- [x] 6.1 Add an `ActionsMenu` (reuse `shared/chrome/ActionsMenu.tsx`, no new component) to
      `PipelineDetailHeader.tsx` replacing the three standalone "Edit source"/"Edit type"/
      "Edit schedule" buttons; items ownership-gated exactly as the retired buttons were; trigger
      `aria-label="Pipeline actions"` (design.md D5). Keep the schedule enable/disable `Toggle`
      inline, outside the menu.
- [x] 6.2 Compact each field group (source/type/schedule) to a single-line label+value layout
      per design.md D6 — tighter spacing/font-size than the original consolidation.
- [x] 6.3 Re-measure `scrollWidth` vs. rendered `width` for every truncatable header child
      (source name, type name, schedule expression, next-run, disabled badge) at
      1440/1100/768/430px **using an enabled schedule with a computed next run** (fixture
      `/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485`, toggle on/measure/toggle back off) —
      resolve skeptic-final-2.md's open CR1 (`__schedule-next-run` truncating at 1440px); do not
      assume D6's compaction alone fixes it without measuring. If it isn't fully closed, apply
      design.md D6's committed fallback in order: (a) a more compact `__schedule-next-run` date
      format sized to the group's actual remaining width + a `title="<full date>"` attribute for
      recoverability; only if that still doesn't fit, (b) reprioritize the group's shrink order
      so `__schedule-expression` yields before `__schedule-next-run`.

## 7. Scope amendment — footer overflow consolidation (see design.md D7)

- [x] 7.1 Keep "Dry run" and "Run pipeline" as plain, always-visible buttons in `__footer-right`
      at every viewport (430px included), unchanged tap-target treatment.
- [x] 7.2 Add a second `ActionsMenu` instance (`aria-label="More actions"`) to
      `PipelineDetailFooter.tsx` in `__footer-right`, containing "Run history", "Preview", and
      "Share" (owner-only, same gating as today) as menu items, same left-to-right order as the
      original buttons.
- [x] 7.3 Verify the overflow trigger button itself meets the 44px HEL-687 tap-target floor at
      430px, alongside "Dry run"/"Run pipeline".

## 8. Tests + specs for the amendment

- [x] 8.1 Update `PipelineDetailHeader.test.tsx`: open the actions menu, assert `menuitem`
      role/accessible name for "Edit source"/"Edit type"/"Edit schedule"/"Set schedule",
      preserve existing ownership-gating scenarios against the new menu structure.
- [x] 8.2 Update `PipelineDetailFooter.test.tsx` (or wherever footer-level assertions live):
      open the overflow menu, assert `menuitem` role/accessible name for "Run history"/
      "Preview"/"Share"; assert "Dry run"/"Run pipeline" remain plain always-visible buttons.
- [x] 8.3 Update `PipelineDetailPage.test.tsx`'s existing `getByRole("button", { name: "Edit
      source" })`-style assertions (and the footer's Run history/Preview/Share equivalents) to
      open the owning menu first and query `getByRole("menuitem", ...)`.
- [x] 8.4 Per design.md D8: remove `.pipeline-detail-page__edit-btn`'s and
      `.pipeline-detail-page__history-btn`/`__preview-btn`/`__share-btn`'s now-dead base rules
      and their entries in `PipelineDetailPage.css`'s `@media (max-width: 768px)` combined-
      selector list; update `PipelineDetailPage.css.test.ts`'s `it.each` list to drop the
      `__history-btn`/`__preview-btn` assertions, keeping only `__dry-run-btn`. Do not add
      page-local 44px assertions for the two new `ActionsMenu` triggers —
      `ActionsMenu.css.test.ts` already covers them.
- [x] 8.5 Update `specs/pipeline-editor-page/spec.md` and
      `specs/pipeline-schedule-config-ui/spec.md` scenarios to describe the menu-based header
      actions and the footer's pinned-vs-overflow split.
- [x] 8.6 Re-run `PipelineDetailPage.css.test.ts` (HEL-687 guard, now with its updated `it.each`
      list per 8.4), the full frontend Jest suite, and `npm run lint` — confirm no stray
      references to the old always-visible-button structure (or the removed CSS selectors)
      elsewhere in the app.
