## Evaluation Report — Cycle 4, owner-approved scoped fix-forward (evaluation-4.md)

Reviewed HEAD `776b53aee93b788faa01e4cb4a284208cda5b7c9`.

**origin/main (freshly fetched)**
- Now at `c5cc7eeee`, which adds HEL-1386 on top of the merged `613487433`.
- `git merge-tree HEAD origin/main` reports no conflicts.
- **V134 is still free.** Main's newest migration is V133.
- I ran **main's newer Scala inline-FQN guard** (HEL-1386, `${...}` splice scanning) against this branch's tree, using main's `check-scala-quality.mjs` and `scala-code-only.mjs`. Result: clean.

Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/eval-evidence-c4/`

### Gates (my own runs)

| Gate | Result |
| --- | --- |
| lint, format:check, typecheck, check:schemas, check:tokens, check:scala-quality, check:openspec, check:spec-structure, check:e2e-types, check:e2e-user-cleanup, check:e2e-evidence-paths | PASS |
| `npm test` (3 workers, nice 19) | PASS: 7226/7226 (matches the claim) |
| build + `check:landing-build` | PASS |
| `sbt testFull` (full) | PASS: 8128 succeeded, 0 failed, 4 canceled (pre-existing perf cancels) (matches the claim) |
| Full Playwright suite | 290 passed, 1 failed. The failure is environmental (details below). |

**The one Playwright failure.**
- Test: `hel503-palette-global-resource-search.spec.ts:78`.
- It failed inside the shared login helper (`support/isolateLivePage.ts:30`). `page.goto("/login")` hit the 30 s test timeout "waiting until load", before any HEL-1574 code ran. This is a dev-server page-load stall while my live UI session shared the same servers.
- I re-ran that spec with `--repeat-each=3`: **18/18 passed**.
- With that re-run, the suite totals 291 passing, which matches the executor's claim.
- Trace: `test-results/hel503-…/trace.zip`.
- Excerpt: `playwright-full-failure.txt`.

### Phase 1: Spec Review — PASS

The fix-forward stays within the approved scope and matches each scope item in the brief:
- **Hit expanders.** Both Delete buttons get the 44px `::after` expander under `@media (max-width: 768px), (pointer: coarse)`.
- **Tests.** `expectTapExpander()` tests were added for both buttons.
- **Focus after Confirm.** A new `shared/chrome/rowDeleteFocus.ts` handles it. On success, focus goes to the next row's Delete, else the previous row's, else the page `h1` with `tabIndex=-1`. On a refusal or 409, focus returns to the row's Delete.
- **Report committed.** `evaluation-3.md` is committed.

The Share button gap is out of scope (HEL-1602) and is not counted.

**Merge `abdefdfcb`.**
- The remerge-diff is empty, so there were no conflicts.
- No file was touched by both main (`574a589d8..613487433`) and the branch.
- The backend diff against main contains only this branch's own files.

### Phase 2: Code Review — PASS

- **CSS.** Both expanders follow DESIGN §3 exactly:
  - `position: relative`, with an explicitly sized full-width-strip `::after` (`left: 0; right: 0; height: 44px`, centred) and `z-index: 1`.
  - Gated on the canonical input-device media query.
  - Tokens only.
- **`rowDeleteFocus.ts`.** Small and typed.
  - The neighbour's label is read before the delete, so it is still in the DOM.
  - Attribute selectors escape quotes and backslashes.
  - The existing `focusOnMount`/`focusRowDelete` helpers were de-duplicated out of both pages into this shared module.
- **Tests.**
  - A CSS assertion for each expander.
  - Success moves focus to the neighbour.
  - Deleting the last row moves focus to `H1`.
  - A refused delete (pipeline) and a 409 (source) return focus to the row's Delete.

### Phase 3: UI Review — PASS

Checked in the running app, in both themes.

**1. 44px hit height at 375px.** Measured with `elementFromPoint` on every row's Delete:
- `/sources` (dark): the button is 55×25 and `::after` computes 52.6×44px. Probes 21px above and below the button's centre hit the button. 23px above misses, which is exactly the 44px strip.
- `/pipelines`: same result.

**2. No overlap with neighbouring controls.**
- The strip spans only the button's own width.
- On `/pipelines` the adjacent Share button (x 109–160) sits beside Delete (x 160–215). Share's centre and top edge still resolve to Share.
- The left neighbour cell on `/sources` still resolves to itself.
- The 44px strip sits inside the 71px row, so it never reaches the rows above or below.

**3. Focus after Confirm.** I used real keyboard input (Enter, Tab, Enter) at 375px.
- Deleting "C4 Pipe Two" moves focus to "Delete C4 Pipe One" (`:focus-visible`).
- Deleting the last pipeline moves focus to the `h1` "Data Pipelines", where `tabIndex=-1` keeps it out of the Tab order.
- A refused 409 on a referenced source: the reference warning showed in the confirm, the conflict notice rendered, the row stayed, and focus returned to "Delete C4 Src A" (`:focus-visible`).
- Mouse-driven success also moved focus to the neighbour, with `:focus-visible` false, so no ring appears for pointer users.

**4. h1 focus is acceptable.**
- It shows the app's standard 2px accent focus ring (`outline: solid 2px`, the shared `--app-focus-ring`), only on keyboard-initiated focus.
- The heading is not added to the Tab order.
- No layout shift. Evidence: `pipelines-375-dark-h1-focus.png`.

**5. No regression from cycles 1–3.**
- On `/sources/:id` the detail page has 0 Delete controls.
- The rail's only current item is Data Sources.
- Exactly one context-list row is current.
- The logo and Home both link to `/home`.
- `hel1574-shell-rail.spec.ts` and every other spec passed in the full run.

Evidence: `sources-375-light-409-focus.png`.

### Overall: PASS

### Non-blocking Suggestions
- The confirm group's `aria-label` repeats the Confirm button's accessible name (carried from evaluation-3).
- The `h1` keeps `tabindex="-1"` after it has been focused. This is harmless, but it could be removed on blur if desired.
- The hel503 flake above was a dev-server page-load stall during a shared live session. It is not linked to this branch, and nothing is needed unless it recurs on CI.
