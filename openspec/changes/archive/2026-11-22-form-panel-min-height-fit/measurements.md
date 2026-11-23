# HEL-1618 measurements

## 1. Before-counts (commit before any source edit)

Taken on the unmodified tree (main at cba523c03), lane DB `helio_hel1618`, jest 3 workers, Playwright 2 workers.
`hel1756-popover-viewport-fit` creates no form panel (it matched only `form.popover__panel` / `document.querySelector("form")`), so it is excluded.

Environment note: the worktree's `frontend/node_modules` was a stale install (`echarts-for-react` 3.0.6 against
`package.json` `^3.1.0`, from HEL-1824), which crashed every chart panel ("Element type is invalid ... ChartPanel") and made
hel1791 (editor + per-kind) and hel1819 fail at 390 px. First e2e pass (before the fix): hel1791 1 pass / 5 fail,
hel1819 0 pass / 4 fail, all other files green. After `npm ci` in `frontend/` (gitignored, no tracked change) and a
server restart, every count below is the baseline.

### Jest (pass / fail / skip)

| file | pass | fail | skip |
| --- | --- | --- | --- |
| ui/PanelCardHeader.refreshFullscreen.test.tsx | 18 | 0 | 0 |
| ui/PanelContent.test.tsx | 29 | 0 | 0 |
| ui/form/CounterControl.css.test.ts | 3 | 0 | 0 |
| ui/form/FormFieldControl.test.tsx | 28 | 0 | 0 |
| ui/form/FormPanel.css.test.ts | 3 | 0 | 0 |
| ui/form/FormPanelView.nonOwner.test.tsx | 13 | 0 | 0 |
| ui/form/FormPanelView.test.tsx | 38 | 0 | 0 |
| ui/form/useFormPanelValues.test.ts | 12 | 0 | 0 |
| ui/renderers/FormRenderer.roles.test.tsx | 5 | 0 | 0 |
| **total** | **149** | 0 | 0 |

### E2E (pass / fail / skip / flaky)

| file | pass | fail | skip | flaky |
| --- | --- | --- | --- | --- |
| hel1085-form-field-renderers-keyboard | 1 | 0 | 0 | 0 |
| hel1087-form-submit-path | 4 | 0 | 0 | 0 |
| hel1088-compact-counter-chrome | 1 | 0 | 0 | 0 |
| hel1090-form-panel-assembled-a11y | 5 | 0 | 0 | 0 |
| hel1094-sse-fan-out-panel-refresh | 1 | 0 | 0 | 0 |
| hel1095-optimistic-pending-writing-panel-a11y | 4 | 0 | 0 | 0 |
| hel1096-run-to-update-affordance | 2 | 0 | 0 | 0 |
| hel1169-network-vs-rejection-reconcile-a11y | 4 | 0 | 0 | 0 |
| hel1784-editor-form-submit | 7 | 0 | 0 | 0 |
| hel1791-compact-counter-stack-height | 6 | 0 | 0 | 0 |
| hel1818-compact-counter-single-error | 4 | 0 | 0 | 0 |
| hel1819-form-live-region-gap | 4 | 0 | 0 | 0 |
| **total** | **43** | 0 | 0 | 0 |

## 2. After-counts (the split, no test file edited)

`FormPanelView.tsx` 481 -> 277 lines, new `useCompactCounterSubmit.ts` (194), `CompactCounterFormBody.tsx` (70),
`MultiFieldFormBody.tsx` (93). Same jest and e2e set re-run: every per-file pass/fail/skip/flaky row is identical to
section 1 (jest 149 pass; e2e 43 pass, 0 fail/skip/flaky). `tsc --noEmit`, eslint and prettier clean.

## 3. Live measurement of the minimum-height clip (task 3.1)

Dev server on port 7050 against the lane DB, Chromium 1280 x 1000, a throwaway user (registered through the e2e
registry and deleted by recorded id on teardown), form panels each stored at `h = 4` (lg and sm layouts), Comfortable
density (12 px gutter, panel 244 px) and Compact (8 px gutter, panel 248 px). Throwaway spec kept as
`.concertino/runs/HEL-1618/evidence/measure-spec.ts.txt`, screenshots in
`.concertino/runs/HEL-1618/evidence/screenshots/before/`.

Important: at a 1280 px viewport the grid container is 928 px wide (the sidebar takes the rest), so the live breakpoint
is `sm` (768..1100, 6 columns), not `lg` (>= 1440). The `sm` layout is the one that governs "1280 px".
With only an `lg` layout stored, the `sm` layout is derived and a form came out h=5 (308 px), so a 4-row form is
reachable only through an authored/resized layout, which is what the resize probe below confirms is allowed.

Scroller = `.panel-content--form` (`overflow-y: auto`). Hidden = scrollHeight - clientHeight. Identical in light and dark.

| panel | density | panel h (px) | clientHeight | scrollHeight | hidden px | Submit / last control fully visible |
| --- | --- | --- | --- | --- | --- | --- |
| 1 field + Submit | Comfortable | 244 | 165 | 165 | 0 | yes |
| 2 fields + Submit | Comfortable | 244 | 165 | 186 | 21 | NO (Submit clipped by 21 px) |
| 3 fields + Submit | Comfortable | 244 | 165 | 253 | 88 | NO |
| compact counter | Comfortable | 244 | 165 | 165 | 0 | yes (+/- visible) |
| 1 field + Submit | Compact | 248 | 169 | 169 | 0 | yes |
| 2 fields + Submit | Compact | 248 | 169 | 186 | 17 | NO (clipped by 17 px) |
| 3 fields + Submit | Compact | 248 | 169 | 253 | 84 | NO |
| compact counter | Compact | 248 | 169 | 169 | 0 | yes |

Resize probe (edit layout on, drag a 6x7 two-field form's south-east handle 350 px up): height 436 -> 244 px, i.e. the
grid really lets a form shrink to h = 4 (`panelGridConfig.itemHeights.min = 4`).

Findings against the ticket: the 2-field clip is 21 px (Comfortable) / 17 px (Compact), far below the ticket's
estimated ~45 px; the 3-field form (88 px hidden) and not the 2-field one is the worst case; a 1-field form and the
compact counter already fit. The ticket's "1280 px" breakpoint is `sm`, not `lg`.

## 4. 5-row form minimum (task group 4)

### 4.1 No-bump probe (red run before implementation)

`DesktopPanelGrid.formMinRows.test.tsx` mounts the real `PanelGrid` (mocked RGL, so the exact `layouts` prop and the
store are observable). On the UNCHANGED grid the GUARD "a saved 4-row form renders at 4 and loading it saves nothing"
passes: rendered h stays 4, `hasPendingLayout` stays false and a flush sends no PATCH. The same run shows the cases
that must fail first failing: 8 failed / 12 passed, `evidence/g4-red.txt` (the commit hook refuses a failing jest
commit, so the red output is committed as evidence and the tests land with the implementation). Failing before: the
minH-5 case, the empty-form case, the lift case, and the stubbed helper unit cases (`panelMinRows`,
`isSpaceBelowFree`, `liftResizedForm`). Passing before (guards, each failable by a named mutation below): the no-bump
probe, the blocked-neighbour, kept-item, compact-counter, non-committing-tick and stale-ref cases.

### 4.4 Placement-path enumeration (every path that puts a form on the grid, with its height)

| path | where | form height | action |
| --- | --- | --- | --- |
| create | `PanelLifecycleWrites.scala:37` `defaultSizesFor` -> `PlacementSizes.forNewPanel` -> `ContentDefault` (`CreatePlacement.scala:21` `ContentHeight = 5`, `:26-30`, `:43` `case _ => ContentDefault`) | 5 | none needed |
| batch create | `PanelBatchWrites.scala:93` `defaultSizesFor(p)` per panel, same `ContentDefault` | 5 | none needed |
| duplicate | `PanelLifecycleWrites.scala:54` -> `CreatePlacement.duplicateSizes` (`CreatePlacement.scala:94-99`) takes the SOURCE's stored h (`math.max(1, i.h)`), the kind default only when the source has no item | the source's h (4 or less for a saved sub-5 form) | REPORTED, not changed (backend; "a duplicate keeps its source's size") |
| unplaced-panel fallback (a panel with no stored item) | frontend `dashboardLayout.ts:29` `defaultItemHeight = 5`, used at `:79` and `:199` | 5 | none needed |
| auto-layout / tidy | backend `PanelPacker.scala:44` `Form -> minH = 5`, applied by `clamp` at `:63`; `AutoLayoutService.scala:136` calls `PanelPacker.pack` | >= 5 | none needed |
| resize on the desktop grid | `createLayouts` per-panel `minH` (this change) | stops at 5 (counter 4) | fixed here |
| resize of a SAVED sub-5 form | `lift-when-free` in `useGridLayoutInteraction` (this change) | 5 if free below, else kept | fixed here |
| undo / redo | restores a stored snapshot (`layoutHistorySlice`); places nothing | as saved | none needed (a saved sub-5 form stays as saved by ruling) |
| first-run template/dashboard | backend `FirstRunPlanner` (table / chart only) | no form | none needed |
| dashboard import | backend `DashboardSnapshotImport` / `DashboardSnapshotRepository.remapLayoutItem` copies each item's h verbatim | as in the file | REPORTED, not changed (backend; a sub-5 form in an imported file stays sub-5, consistent with "a saved form is not bumped") |
| proposal / assistant apply | backend `ProposalLayoutSupport` uses the proposal's own `layout.h`, else `PlacementSizes` (5) | as proposed | REPORTED, not changed (backend; a proposal may carry a form at h < 5) |
| proposal review pages | frontend `ProposalReviewPage` / `CombinedProposalReviewPage` use h = 6 | 6 | none needed |
| mobile stack | no grid heights (HEL-1791) | n/a | out of scope |

### 4.5 Mutations (red evidence in `evidence/g4-mutation-*.txt`)

| mutation | result |
| --- | --- |
| `panelMinRows` always returns 4 (min back to 4) | 3 red: minH-5 case, empty-form case, helper unit case (`g4-mutation-min4.txt`) |
| drop the compact-counter exception | 2 red: counter/non-form/sub-5 minH case, helper unit case (`g4-mutation-nocounter.txt`) |
| `createLayouts` emits `h: Math.max(item.h, FORM_MIN_ROWS)` for non-counter forms (skeptic fold-in 1) | the GUARD turns red (rendered h 4 -> 5) (`g4-mutation-max.txt`). The pending flag stays unset (`g4-mutation-max-pending-probe.txt`: rendered h 5, pending undefined): with the mocked RGL nothing echoes the bumped layout back, so the bump is render-only here; the real-RGL on-load echo is covered by the e2e GUARD, which asserts no PATCH and no Save now. The earlier-designed `Math.max(item.h, minH)` is inert (minH = 4 for a 4-row form), as the skeptic found |
| lift without the free-cell check | 3 red: blocked-neighbour, kept-item, helper unit case (`g4-mutation-nofree.txt`) |
| no lift | 2 red: lift case, helper unit case (`g4-mutation-nolift.txt`) |
| lift dispatched as a separate store write after the commit | 1 red: the lift case. Rendered h stays 5 and the store has 5, but `hasPendingLayout` is false, i.e. the save is silently dropped (`g4-mutation-separate.txt`), exactly the hazard the design names |
| `clearCommitFlag` no longer clears the resized id (fold-in 2) | 1 red: "a resize that ends where it started, then a drag of another panel, does not lift the form" (`g4-mutation-stale.txt`) |

Not mutated: the `commitOnNextLayoutChangeRef.current` gate on the resized id. It is redundant by construction, because
the id is cleared by every clear of the commit flag, so a held id and an unarmed flag cannot coexist; it is kept as a
belt-and-braces guard (a non-committing tick or echo cannot lift, asserted by "does not lift on a non-committing layout tick").

### 4.6 Re-measure after the change (1280 px, `sm`, light and dark identical)

Same method and throwaway-spec as section 3 (`evidence/measure-spec-after.ts.txt`), screenshots in
`.concertino/runs/HEL-1618/evidence/screenshots/after/`. Panels stored at the new minimum: forms at 5 rows, compact
counter at 4, plus a saved 4-row two-field form (`FS`, not bumped).

| panel | density | before: panel h / hidden px / Submit visible | after: panel h / hidden px / Submit visible |
| --- | --- | --- | --- |
| 1 field | Comfortable | 244 / 0 / yes | 308 / 0 / yes (5-row minimum) |
| 2 fields | Comfortable | 244 / 21 / NO | 308 / 0 / yes |
| 3 fields | Comfortable | 244 / 88 / NO | 308 / 48 / NO (still scrolls) |
| compact counter | Comfortable | 244 / 0 / yes | 244 / 0 / yes (keeps 4) |
| saved 4-row 2-field form | Comfortable | 244 / 21 / NO | 244 / 21 / NO (not bumped, by ruling) |
| 1 field | Compact | 248 / 0 / yes | 312 / 0 / yes |
| 2 fields | Compact | 248 / 17 / NO | 312 / 0 / yes |
| 3 fields | Compact | 248 / 84 / NO | 312 / 44 / NO |
| compact counter | Compact | 248 / 0 / yes | 248 / 0 / yes |
| saved 4-row 2-field form | Compact | 248 / 17 / NO | 248 / 17 / NO |

The AC (a two-field form shows Submit without scrolling at its minimum) holds at both densities, in both themes.
Design claim found false: D4 predicted a 3-field form would still scroll "~24 px" at 5 rows (88 - 64). It scrolls 48 px
(Comfortable) / 44 px (Compact): the extra row adds 64 px of card but only 40 px of scroller, because the short-card rhythm
(`data-short-card`, h <= 4) that tightens spacing in the 4-row card is dropped at 5 rows. It is still outside the AC.

### 5.1 Final proof run

Jest: `ui/form`, `ui/grid` and the other D1 files, 49 suites / 399 tests pass (the 9 D1 jest files keep their 149 passing
tests). E2E: the 12 D1 specs keep their per-file counts (43 pass) and the new `hel1618-form-min-rows.spec.ts` adds 4
(min stop at 5 / counter 4, GUARD no-bump with no PATCH and no Save now, lift-when-free persisted once with the card still
5 rows after settling and a second Save now sending nothing, blocked neighbour stays 4 with the neighbour unmoved). Red
run of the new spec on the unchanged grid: 2 failed (min stop, lift), the 2 guards passed (`evidence/g4-e2e-red.txt`).
