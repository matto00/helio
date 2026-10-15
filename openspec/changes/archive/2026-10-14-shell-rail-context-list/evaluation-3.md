## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `f980e0ce75fe72e4e48db9e7ae361a089067f537`. The review base resolved live to `574a589d8`. `origin/main` was freshly fetched and is now `b1c8f0d8b` (HEL-1590/1592/1595 on top of 574a589d8).

Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/eval-evidence-c3/`

### Gates (my own runs)

| Gate | Result |
| --- | --- |
| lint, format:check, typecheck, check:schemas, check:tokens, check:scala-quality (now the widened HEL-1446 `scala.` guard), check:openspec, check:spec-structure, check:e2e-types, check:e2e-user-cleanup, check:e2e-evidence-paths | PASS |
| `npm test` (3 workers, nice 19) | PASS: 7219/7219 (matches the claim) |
| build + `check:landing-build` | PASS |
| `sbt testFull` (full suite) | PASS: 8128 succeeded, 0 failed, 4 canceled (pre-existing perf cancels) (matches the claim) |
| Full Playwright suite | PASS: **291 passed** in 13.1 min (matches the claim) |

### Phase 1: Spec Review — PASS

- **Brief point 6: the docs match the owner ruling** ("it should only be on overview rows. not in detail pages.").
  - The canonical `openspec/specs/app-shell-rail/spec.md` now has "Requirement: Delete lives on the overview rows", including "the detail pages SHALL NOT offer it" and a "Detail pages offer no Delete" scenario. It is byte-identical to the archived delta's section.
  - DESIGN.md §9 says "a row action on the Data Pipelines and Data Sources overview tables, never in a list and never in a detail page's header".
  - The archived D12, proposal and task 3.5 were rewritten to match.
- **Brief point 5: the merge with origin/main is correct.**
  - `33f54188f` has an empty remerge-diff, so there were no conflicts.
  - The only files both lines touched are `App.tsx` and `CommandBar.tsx`. Main's change there (HEL-1453 removing the dead `draftAppearance` prop) is preserved: neither the removed prop nor the removed JSX attribute survives.
  - `git merge-tree HEAD origin/main@b1c8f0d8b` reports no conflicts.
  - **V134 is still free**: the newest migration on the fetched origin/main is V133.

### Phase 2: Code Review — FAIL

- The `f980e0ce7` diff is clean:
  - Delete, the references fetch and the conflict state were fully removed from `SourceDetailPanel.tsx` and `PipelineDetailPage.tsx`/`PipelineDetailHeader.tsx`, and their tests moved to `PipelinesPage.delete.test.tsx` and `SourcesPage.delete.test.tsx`.
  - The overview tables take an optional `onRequestDelete`.
  - The pages own the confirm (`ConfirmInline` inside a focusable, labelled group), the HEL-1258 warning, the HEL-989 notice and an error banner.
  - Tokens only.
- One mechanical DESIGN.md violation follows, verified in the running app.

1. **[DESIGN.md §3 "The 44px touch floor" + the [mechanical] `(max-width: 768px), (pointer: coarse)` gate] The new row Delete buttons are 25px tall with no hit expander on touch.**
   - Rule: "Every interactive control reachable by touch must clear a 44x44px target … A sized `::after` hit expander for every compact PAINTED control — any button."
   - Measured live at 375px on `/pipelines`: `button[aria-label="Delete C3 Pipe Del"]` is 54.6x25px, `::after` computes `content: none`, and `position: static`. `elementFromPoint` 8px above the button misses it.
   - Files: `frontend/src/features/pipelines/ui/PipelineListTable.css` (`.pipeline-list-table__delete-btn`) and `frontend/src/features/sources/ui/SourceListTable.css` (`.source-list-table__delete-btn`).
   - The adjacent pre-existing `.pipeline-list-table__share-btn` has the same gap. That one is pre-existing, so it is a suggestion, not a change request. This change adds a new destructive control that copies the gap.

### Phase 3: UI Review — FAIL (one item: the touch floor above). Everything else verified live.

Checks run in the running app (fresh user, both themes, 1280px and 375px):

1. **Brief point 1: Delete placement.**
   - Absent from both detail pages. `/pipelines/:id` "Pipeline actions" contains only Edit source, Set schedule, Run history and Share. `/sources/:id` has no Delete in `main`, and its header has only "Rename …".
   - Present on every overview row, with the item name in the accessible name: `Delete C3 Source "Free"`, `Delete C3 Source Used`, `Delete C3 Pipe Keep`, `Delete C3 Pipe Del`.
2. **Brief point 2: keyboard and focus.** I used real Tab, Shift+Tab and Enter key presses.
   - Delete is reachable in tab order directly after its row.
   - Enter opens the confirm, and focus lands on the group "Confirm delete C3 Source "Free"".
   - Cancel returns focus to that row's Delete button (`:focus-visible` true). The quote-escaping in the name works.
   - At 375px the confirm takes focus and is in view. Confirming deletes the pipeline: the row is removed, the server no longer lists it, and the page stays on `/pipelines`.
   - Evidence: `pipelines-375-light-confirm.png`.
3. **Brief point 3: refused delete, live.**
   - For a source referenced by 2 pipelines, the confirm reads "Delete C3 Source Used? 2 pipelines reference this source, so deleting it will be refused until you remove those references." (HEL-1258).
   - Confirm returns 409. The HEL-989 notice renders on the overview ("was not deleted: it is still referenced by the items below…", listing both pipelines with Dismiss), and the row remains.
   - Evidence: `sources-409-conflict-1280-dark.png`.
4. **Brief point 4: the hover tone in both themes.** I measured from computed colours after the transition settled, composited over the hovered row background.

   | Theme | Text on rest | Text on hover | Hover vs rest |
   | --- | --- | --- | --- |
   | Dark | 6.01 | 4.81 | 1.25 |
   | Light | 6.32 | 5.41 | 1.17 |

   Text stays at or above WCAG AA (4.5) in both themes. The hover-vs-rest step clears the HEL-866 "measurably different" floor (`CONTRAST_THRESHOLD = 1.1` in `e2e/support/stateContrast.mjs`). PASS.
5. **Brief point 7: no regression from cycles 1–2.**
   - At `/home` only Dashboards is current on the rail.
   - The logo and Home links point to `/home`.
   - With real Enter presses on the resize handle, focus moves to "Expand list" on collapse and to "Collapse list" on expand.
   - The full Playwright suite is green, including `hel1574-shell-rail.spec.ts`.

### Overall: FAIL

### Change Requests
1. Add the DESIGN §3 hit expander to both new row Delete buttons, under the canonical gate. In `PipelineListTable.css` and `SourceListTable.css`:
   ```css
   @media (max-width: 768px), (pointer: coarse) {
     .pipeline-list-table__delete-btn { position: relative; }
     .pipeline-list-table__delete-btn::after {
       content: ""; position: absolute; z-index: 1;
       top: 50%; left: 0; right: 0; height: 44px; transform: translateY(-50%);
     }
   }
   ```
   (Same for `.source-list-table__delete-btn`.) Alternatively, add the `tap-expand-44` utility class to both buttons.
   - Use the full-width-strip form (`left: 0; right: 0`), not a 44px-wide square, so it does not overlap the adjacent Share button.
   - Add `expectTapExpander()` (`shared/ui/tapTargetTestUtils.ts`) assertions for both buttons in `PipelinesPage.delete.test.tsx` and `SourcesPage.delete.test.tsx`.

### Critical Path (final cycle)
- This is the only blocking item: a CSS-only change to two selectors plus two unit assertions. It does not touch behavior, the spec or the owner ruling, and it should not need another full gate cycle beyond jest and lint and a 375px spot-check.
- Recommendation for the human: approve a scoped fix-forward of CR1 on this branch (or explicitly waive it). Everything else in the brief verified clean, and all gates are green: jest 7219, sbt 8128, Playwright 291.

### Non-blocking Suggestions
- After Confirm (success or 409), focus drops to `<body>` because the confirm group and, on success, the row unmount. Consider focusing the conflict notice on a 409, and the table or the next row's Delete on success.
- The confirm group's `aria-label` ("Confirm delete X") is identical to the Confirm button's accessible name inside it, so a screen reader announces the same phrase twice. Consider naming the group "Delete X" or relying on the `ConfirmInline` label text.
- The pre-existing `.pipeline-list-table__share-btn` has the same missing touch expander. Fix it in the same pass if convenient.
- At 375px, the row actions sit at the right edge of the horizontally scrolling table, and the Delete label is clipped by the scroll edge shadow until scrolled.
