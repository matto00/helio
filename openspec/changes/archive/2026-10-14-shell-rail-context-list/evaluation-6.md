## Evaluation Report — Cycle 6, addresses skeptic-final-4 (evaluation-6.md)

Reviewed HEAD `20147a5c3c9b9511f2cded0c35c18abb659a510f`.

- **origin/main:** freshly fetched; still `c5cc7eeee`, already merged into this branch. `git merge-tree` shows no conflicts.
- **V134:** still free (main's newest migration is V133).
- **Scope.** The diff since `28bbefe42` touches only `PipelineListTable.css`, `SourceListTable.css`, `e2e/hel1574-shell-rail.spec.ts` and two markdown reports. Nothing under `backend` changed, so not re-running sbt is justified (my last full sbt run was 8128 passed, 0 failed, and no backend code has changed since).

Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/eval-evidence-c6/`

### Gates (my own runs)

| Gate | Result |
| --- | --- |
| lint, format:check, typecheck, check:tokens, check:openspec, check:e2e-types, check:e2e-user-cleanup, check:e2e-evidence-paths | PASS |
| `npm test` (3 workers, nice 19) | PASS: 7229/7229 (matches the claim) |
| build | PASS |
| Full Playwright suite | PASS: **294 passed** in 13.2 min (matches the claim; includes the new 375 regression test and the state-surface contrast guard) |

### Phase 1: Spec Review — PASS

Both skeptic-final-4 change requests are fixed:
- **CR1, Share/Delete gap:** `.pipeline-list-table__share-btn + .pipeline-list-table__delete-btn { margin-left: var(--space-2) }`. This is a token and matches `.connectors-page__row-actions`. The actions column stays right-aligned.
- **CR2, confirm text scrolled out of view:** the extra-row content is now `position: sticky; left: var(--space-3); max-width: calc(100cqw - 2 * var(--space-3))`, with `container-type: inline-size` on each table's scroller. This covers the confirm, the 409 notice and the error banner, because the rule targets `__extra-cell > *`.

### Phase 2: Code Review — PASS

- **Scope.** CSS only and tokens only. Nothing outside the row actions and confirm rows.
- **Can `container-type: inline-size` change the layout?** I measured each scroller with the rule applied, then again with `container-type` forced back to `normal`. In every case the scroller width, its parent width, the table width, `scrollWidth` and every column width were **identical**:

  | Table | Viewport | Context list | Scroller | Table |
  | --- | --- | --- | --- | --- |
  | Pipelines | 1280 | 400 | 776 | 776 |
  | Pipelines | 820 | 400 | 316 | 704 (scrolls) |
  | Pipelines | 375 | — | 327 | 681 (scrolls) |
  | Sources | 1280 | — | 776 | 776 |
  | Sources | 768 | — | 720 | 720 |

  The scroller is a block child of the page, sized by its parent, so inline-size containment cannot shrink it.
- **Sticky headers.** These tables have none; the only `position: sticky` in their stylesheets is the new rule.
- **Empty and loading states.** These render outside `SortableTable`'s scroll container. The container is only mounted together with the table (`PipelineListTable.tsx:158`, `SourceListTable.tsx:136`), so these states are unaffected.
- **Regression test.** The new e2e test asserts the confirm stays within the scroller and the viewport after scrolling to the table's end, on both pages at 375. It also asserts a gap of at least 7px between Share and Delete. The executor reports that it goes red without the sticky rule; I did not mutate code to re-prove that, and it is green here.

### Phase 3: UI Review — PASS

Checked live in both themes, at 1280, 820 (context list at 400), 768 and 375.

**1. Confirm stays in view when the table is scrolled.** In each case below I scrolled the table to its far right before opening the confirm. The Confirm button stayed inside the scroller every time.

| Viewport | Theme | Table | Scroller x | `scrollLeft` | Confirm group x |
| --- | --- | --- | --- | --- | --- |
| 820, list at 400 | dark | Pipelines | 480–796 | 387 | 488–780 |
| 375 | dark | Pipelines | 24–351 | 354 | 32–335 |
| 768 | light | Sources | 24–744 | not scrolled | 36–732 |
| 1280 | light | Sources | 480–1256 | not scrolled | 492–1244 |

- At 820 and 375 the confirm shows the full item name and warning, wrapped. Evidence: `pipelines-820-dark-list400-scrolled-confirm.png`, `pipelines-375-dark-scrolled-confirm.png`.
- At 1280 Pipelines the confirm also stayed inside the scroller (scroller 480–1256, confirm 496–1240).

**2. The 409 notice renders below its row.** A 409 on the referenced source at 768 (light) rendered the HEL-989 notice as the next table row, sticky, at x 36–732 inside the scroller (24–744). The row stayed, and focus returned to its Delete (`sources-768-light-409.png`).

**3. Share/Delete gap.** Measured at 8px (`--space-2`) at 1280, 820 and 375.

**4. Earlier fixes still hold:**
- **Double-click (375, dark, table scrolled):** a real double-click on "Delete … Name 1" left one confirm, for that row. The row's top was unchanged and `scrollLeft` stayed 354. The URL stayed `/pipelines`.
- **Scroll position:** opening the confirm never moved the row (row top unchanged in every case above), and `scrollLeft` survived Cancel.
- **Button recipe:** secondary at rest, as in `sources-1280-light-confirm.png`; the CSS is unchanged since cycle 5.
- **44px expander:** still `::after` 52.6×44px at 375.
- **Focus:** opening moves focus to the confirm group. Cancel returns it to the row's Delete. A successful delete (375) moves it to the neighbour "Delete … Name 0". The 409 returns it to the row's Delete.

### Overall: PASS

### Non-blocking Suggestions
- When the context list is at its 400px max, the 820 shell leaves a narrow (316px) page column, so the confirm text wraps to four lines. This is functional, and it is the owner's keep-768-as-phone ruling at work rather than a defect of this diff.
