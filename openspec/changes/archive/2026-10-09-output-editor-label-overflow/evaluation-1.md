## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `08614ac70b7d8d00dfdc8267b6abc7dc7b244be9`. Review base, resolved live: `2ce4a46706d0642fbfb82c2257b13403d920f19a` (merge-base with origin/main).
Evidence dir (C4): `/home/matt/Development/helio/.concertino/runs/HEL-1432/evidence/` (all evaluator files are prefixed `eval-c1-`).

### Phase 1: Spec Review — PASS

- AC1 (`Select` `id` goes on the trigger only, absent means no attribute): met. `Select.tsx` passes `id={id}` on the `<button role="combobox">` only. When `id` is undefined React renders no attribute, and a unit test guards this. A grep finds no other `<Select` caller passing `id` and no prop spreads into `Select`, so C2 holds.
- AC2 (Kind/Step via `getByLabelText`, red on the WHOLE pre-fix tree): met, and I checked it myself. See "Independent red run" below.
- AC3 (the HEL-1388 locked-Kind description still works): met. In the unit test, and also in the running app: edit mode has `#output-kind` disabled, and `aria-describedby` resolves to "An Output's kind can't be changed after it's created. ...".
- AC4 (the 14 additional dangling labels): all 14 ids are wired, and all 16 targets resolve. In the running app no `label[for]` in the editor dangles for edit (table), create (chart) or create (metric), and there are no duplicate ids.
- AC5 (375 and 768, both themes): met. See Phase 3.
- AC6 (lint-clean, no new eslint-disable): met. Lint passes with zero warnings and the diff adds no `eslint-disable`.
- Tasks 1.1–2.6 are all checked and match the diff. The spec delta (`specs/pipeline-output-sheet/spec.md`) matches the behaviour.
- CONSTRAINTS C1–C5: C1 holds (I verified it independently), C2 holds, C4 holds and C5 holds. **C3 holds only partly.** The HEL-469 and HEL-813 invariants hold, but the fix's media gate breaks a DESIGN.md **[mechanical]** rule. That is filed under Phase 2.

#### Independent red run (C1 / task 2.5)

The executor's `red-prefix.txt` gives only per-file FAIL lines and counts. jest stops at the first failed `expect` in each `it()`, so a test that covers 3–4 ids proves red for its first id only. To close that gap I did the following:

- Built a detached worktree at the base SHA, so every non-test source is pre-fix.
- Copied in HEAD's `OutputEditorSheet.labels.test.tsx` and `Select.test.tsx`.
- Added an evaluator-only per-id isolation test with one `it()` per target. Its preconditions are that the label exists with `htmlFor === id` and that the combobox exists by role and name. Only then does it assert `document.getElementById(id) === combobox`.

Results on the pre-fix tree:

- Per-id test: **21/21 cases red at the association assertion** (`Received: null`), and every precondition passed. The cases are output-kind (create), output-kind (edit), output-step, output-chart-type, agg-group-by, agg-field, agg-fn, bar-orientation, bar-stacking, scatter-size-field, scatter-color-field, output-metric-format, metric-value-field, metric-value-reduce, output-collection-format, and output-slot-value/-label/-unit/-time/-event. **All 16 targets are individually red pre-fix.**
- Executor file: 10 failed and 1 passed. The one that passes is the edit-mode "label click is a no-op" test, which is a guard with no association assertion, so that is correct.
- `Select.test.tsx`: the suite fails to compile pre-fix because `id` is not in `SelectProps`.

With HEAD's non-test sources checked out into the same scratch tree, 16 suites and 258 tests pass, including 21/21 per-id. The scratch worktree has been removed.

Evidence: `eval-c1-red-prefix.txt`, `eval-c1-perid-red.test.tsx.txt`.

Conclusion: the executor's claim holds. Every assertion it relies on fails pre-fix for each id. Its own evidence just did not show that per id.

### Phase 2: Code Review — FAIL

Gates, run fresh in WORKTREE_PATH:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm test` (root) | 44 suites, 426 tests passed |
| `npm test` (frontend) | 501 suites, 5238 tests passed |

There is no backend change, so `sbt testFull` was not run.

Issues:

1. **DESIGN.md §3 "Gate on the input device, not the viewport" [mechanical] is violated** at `frontend/src/features/panels/ui/editors/TableDisplayFields.css:166`.
   - The rule says the touch gate `@media (max-width: 768px), (pointer: coarse)` "belongs on tap-target rules ONLY — phone-shaped LAYOUT (stacking a row ...) stays width-gated, since an iPad Pro at 1366px has a desktop's worth of room and should get the desktop layout". DESIGN.md §4 repeats the point: "These are LAYOUT breakpoints, and a viewport width is not a proxy for a touch device".
   - The new block puts pure layout rules behind the touch gate:
     - the density row collapse (`:168`)
     - the zero-minimum list track (`:179`)
     - `flex-wrap: wrap` (`:183`)
     - `.table-display-fields__column-visibility { flex: 1 1 100% }` (`:189`), which forces the column name onto its own line at any width
     - `min-width: 0` on the row and container
   - Because `(pointer: coarse)` is ORed in, a tablet or touch laptop at 1100/1366px gets the phone layout: density stacked, and each column row split onto 2 lines.
   - That also cuts against AC5's "at 1100 and 1440px the table options' layout is unchanged". The AC itself names "the established `max-width: 768px` mobile query".
   - design.md D6 picked the combined gate on the grounds that it is "already used in TableDisplayFields.css". But the existing use at `:129` is a tap-target rule (the reset-button expander), which is the use DESIGN.md allows. So the precedent does not carry over to layout.
   - Only fine-pointer behaviour was measured (`matchMedia` returned false at 1100/1440 in Playwright), so the tablet regression is untested. It follows directly from the CSS's OR semantics.

Everything else is clean:

- **DRY and modularity:** each change is a one-prop pass-through using the existing `htmlFor` literals (D2).
- **No dead code:** no TODOs, no unused imports.
- **Type safety:** `id?: string`, no escape hatches.
- **Tests:** they test real behaviour through the `<label>` element (D7). This matters because `getByLabelText` alone would pass pre-fix for "Chart type", "Format" and "Cell density", whose aria-label equals the label text. The duplicate-id guard runs in every render.
- **HEL-469 and HEL-813 invariants:** they hold, measured in Phase 3.

### Phase 3: UI Review — PASS (for the measured fine-pointer flows; see Phase 2 #1 for the untested coarse-pointer tablet case)

Dev servers came up through `start-servers.sh` / `assert-phase.sh servers`, which returned PASS. Both were reused, so I checked them:

- The `/proc/<pid>/cwd` of :6864 is `.../HEL-1432/frontend` and of :9771 is `.../HEL-1432/backend`.
- The served `TableDisplayFields.css` contains the HEL-1432 block.

Fixtures were created on a fresh throwaway user `4f6071bc-be4a-4cfd-a732-d32b0033bf70` (`hel1432-eval-c1-…@example.com`, never matt@helio.dev). There were two static-root pipelines, each with a table Output:

- **long:** 10 columns including the 49-character name `customer_lifetime_value_adjusted_for_seasonality1`, so it has 4 move buttons.
- **short:** 3 columns, so it has 2 move buttons.

Every id was recorded in `eval-c1-created-ids.json` and deleted by exact id (outputs 200, pipelines 204, data-sources 204). Afterwards the user's pipelines, sources, outputs and dashboards lists are all empty. The user row itself remains because there is no user-delete route. The same is true of the executor's `f0e18220-…`.

Measurements are in `eval-c1-measurements.json`. overflowPx is the furthest descendant `right` minus the card's content-box right edge.

| case | overflow | notes |
| --- | --- | --- |
| long dark 375 | 0 | density 1 col (261px); name 199px, ellipsized, never 0; format 140px; move group on its own 44px line; gap 16px; 44x44 expanders don't overlap the format select or each other |
| long light 375 | 0 | same as dark |
| long light 320 / 540 | 0 / 0 | invariants hold; at 540 the format and move group share a line, with no expander overlap |
| long dark/light 768 | 0 / 0 | format and move group share line 2; no expander overlap; gap 16px. The executor's before-JSON shows 23px here pre-fix, so this is now fixed |
| short dark/light 375 | 0 / 0 | 2 buttons fit beside the format select; no overlap |
| long dark/light 1100, dark 1440 | 50.7 | the mobile query does not match (fine pointer), so no HEL-1432 rule applies |

Screenshots: `eval-c1-long-{dark,light}-375.png`, `eval-c1-long-{dark,light}-768.png`, `eval-c1-long-dark-{1100,1440}.png`, `eval-c1-short-{dark,light}-375.png`.

**Desktop long-name overflow (executor-reported "23px"):** it predates this change. I measured 50.7px with my fixture, and the size depends on the column name's glyph width.

- Evidence it predates the change: none of the diff's CSS applies at 1100/1440 with a fine pointer (`matchMedia` returns false). The executor's own before/after JSON for 1100/1440 is identical field-for-field.
- Evidence it is out of scope: AC5 requires the 1100/1440 layout to be unchanged and design.md D6 keeps desktop untouched, so fixing it here would itself break the AC.
- What that means: it is the same class of defect on the same surface, so it needs a follow-up ticket. Below 769px the fix already handles long names.

Label association in the app:

- Clicking the "Cell density" label opens its listbox, focus lands on the trigger, and Escape closes it with focus kept on the trigger.
- In create mode, clicking the "Kind" label opens the kind listbox.
- In edit mode the Kind label cannot be actioned because its control is disabled.

Console: the only errors are `GET /api/pipelines/:id/schedule` 404 (no schedule set) and, in create mode with no steps, `GET .../steps/__root__/preview` 404. Neither code path is touched by this diff, so both predate it.

### Overall: FAIL

### Change Requests

1. `frontend/src/features/panels/ui/editors/TableDisplayFields.css:166`: move the layout rules out of the touch gate and into a width-only layout query, `@media (max-width: 768px)`, as DESIGN.md §3 [mechanical] and §4 require. Then do two more things:
   - Remeasure to show that 375 and 768 still have 0px overflow in both themes, with the HEL-469/HEL-813 invariants holding, and save the evidence (C4).
   - Update design.md D6, which currently says the combined gate is the right one, so the planning artifact matches what ships.

   The rules to move are:
   - the `.table-display-fields__row` collapse
   - the `min-width: 0` on `__row` and `__column-list-container`
   - the `__column-list` `minmax(0, 1fr)` track
   - `__column-row` `flex-wrap`/`row-gap`/`min-width`
   - `__column-visibility` `flex: 1 1 100%`
   - the `__column-move` `margin-left: auto`/`align-items`

   The `__column-move { min-height: 44px }` line exists so the expanders stay clear of the format select once the row wraps, and the row only wraps in the layout branch. So it belongs with the width-gated layout rules too, or under both gates if you prefer. Do not keep it touch-gated alone.

### Non-blocking Suggestions

- File a follow-up for the pre-existing desktop overflow (1100/1440, fine pointer): a long column name pushes the Columns list about 23–51px past the Configuration card, because `.table-display-fields__column-list`'s auto track floors at the name's nowrap min-content. Pair it with the planned follow-up for the 7 off-surface dangling `htmlFor` targets.
- The executor's `after-{long,short}-measurements.json` hold only 1100/1440. The 375/768 "0px" claim was supported by screenshots alone. My `eval-c1-measurements.json` now covers those widths, but future rounds should save the numbers as well as the images.
- `frontend/src/shared/ui/Select.test.tsx:90`: the comment `// HEL-1432 -- optional id lands on the combobox trigger only.` repeats the `describe` name. CONTRIBUTING.md says tests are held to a stricter line on comments, so consider dropping it.
- `TableDisplayFields.css:157-165`: the header comment hard-codes measured pixel figures (359/261/98/667px). They go stale the moment any spacing token changes. Keep the cause and the mechanism, and drop the numbers.
