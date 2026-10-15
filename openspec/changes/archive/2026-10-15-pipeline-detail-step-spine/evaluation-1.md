## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `7ff453641e37e737e821a32af78f7406ec058500` against base `cd64409ad828d9024074f907a7ea32800ab71ff3`
(resolved live with `resolve-review-base.sh`). All gates were re-run by the evaluator in this worktree.

### Gate evidence (fresh runs)

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 ("All matched files use Prettier code style!") |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm run check:schemas` | in sync (132 checked across 55 protocol files) |
| `npx openspec validate pipeline-detail-step-spine --type change` | valid |
| `npm test` (HELIO_JEST_MAX_WORKERS=3) | root 51 suites / 469 tests; frontend 616 suites / 7357 tests; 0 failed |
| Targeted jest (`--json`, rootDir `.../HEL-1579/frontend`) | 31 suites / 548 tests passed; incl. `PipelineDetailPage.spine.test.tsx` 42, `.spineEditing.test.tsx` 36, `PipelineDetailPage.test.tsx` 132 |
| `sbt -J-Xmx3g testFull`, 4 shards (`.../HEL-1579/backend`) | 2236 + 1829 + 1770 + 2304 = 8139 succeeded, 0 failed (4 canceled = the HELIO_MEASURE report-only specs) |
| `PipelineRunStepRowCountsRlsSpec` (in shard 2) | 6/6 passed, including "prove the pool is genuinely non-BYPASSRLS" (`helio_app_test`, `rolbypassrls = false`) |
| Playwright, 2 workers, servers 7011/9918 (cwd = this worktree, DB `helio_hel1579` at V135; shared `helio` DB still at V134) | 50 passed: hel1579 spine spec (7 tests), hel908 x3, hel1007, hel1345, hel1521, hel958, hel1277, hel1390, hel910, state-surface-contrast-guard, focus-presence-guard |

### Phase 1: Spec Review — FAIL

- AC 1 (every step kind editable): `StepCardFocused` is a sibling component, but it drives the same `useStepCardState` -> `useStepCardPersist` and the same `StepOpEditor` ladder as `StepCard`; warnings (`StepCardWarnings`), the validation `InlineError` (compute excluded, as in the card), `draftError`, the creating guard (fieldset disabled + "Saving step…"), `isDuplicating` and the draft chip are all carried over. Schema-diff chips moved to the preview header with the same `!isDraft && hasOwnAnalyze` suppression. Nothing found lost there. **However D7's promise "No edit is lost on selection change" is broken** (see Phase 2, CR1): the flushed edit reaches the server but the page keeps the old config, and the next edit silently reverts it.
- AC 1 (no lost assertions): the eight legacy `PipelineDetailPage.*.test.tsx` files keep identical `it`/`expect(` counts and now run on the phone path via `installPhoneShell`. Layout-independent hook logic stays covered by them. The desktop replacement table names tests by title, not file:line; spot-checked titles exist (header actions, in-session run status `it.each` at `spine.test.tsx:541`, insert before / middle insert-after, reorder revert, remove-selects-predecessor, steps error + Retry, rename round trip, status strip). **One cited replacement does not exist**: the ledger row for "insert-at-position (HEL-410)" cites `spineEditing`: "... on the last row appends"; there is no such test, so D5's new last-row routing (`PipelineSpine.tsx:171-178`, "Insert step after" on the last trunk row -> `onAddStep`) is untested (CR2).
- App.test breadcrumb assertion: replaced by the sr-only `<h1>` "Data Pipelines: Revenue ETL" plus a negative breadcrumb assertion, and `CommandBar.test.tsx` adds a dedicated test. Acceptable under the `header-owns-name` ruling.
- e2e triage: `grep -rl "/pipelines/\|pipeline-detail-page" e2e/` returns 51 files, and the ledger triages all 51. The six `testIgnore`d specs (hel666, hel908-tail-attach, hel909, hel908-full-flow, hel968, hel912) are all present in `playwright.config.ts` at `cd64409ad` (lines 64/74/79/92/116/136) and the config is unchanged in this diff.
- AC 2: the spine shows persisted counts on load (V135 `last_run_step_row_counts`), in-session counts first, "—" for unknown and "off" for disabled. Selecting a step updates the editor, the preview table and `?step=`. Verified in the running app.
- AC 3: the branch renders as an indented sub-spine labelled "Lane 1 · from 2 Sort rows", and lane rows are selectable (running app + e2e).
- AC 4: at 1280x800 `scrollHeight == innerHeight == 800`, spine + editor + 10 of 10 preview rows inside the viewport (3 steps + 1 lane).
- AC 5: see Phase 3 (accent audit) — PASS mechanically.
- D9 writer table: every non-success writer passes no counts, so the column is written NULL in the same statement as its sibling count (default `None` on `updateRunTerminal(Internal)` / `updateLastRun(Internal)`); the reaper SQL sets both columns to NULL. The succeeded path is the only one passing `stepCounts`. Covered by `PipelineRunRoutesSpec` (+2) and the RLS spec.
- CONSTRAINTS C1–C8: C1 is violated in substance by CR2 (a ledger replacement that does not exist). C2 holds mechanically. C3 holds (no Delete in the header menu, row menus or source menu). C4: the phone path at 390px still renders the river, tabs, 4 step cards and footer (the dialogs became a sibling of the layout, an accepted DOM-only move). C5 holds (no draft mode, Save & run or live marker). C6 holds (only `CommandBar.tsx` +6 lines through `hidesBreadcrumbItemName`; no HEL-1605 or HEL-1575 files). C7 holds (runs above). C8 holds (`helio_app_test` NOBYPASSRLS, asserted in the spec itself).

### Phase 2: Code Review — FAIL

Gates: all green (table above).

Issues:

1. **Data loss on selection change (D7)**: `frontend/src/features/pipelines/hooks/useStepCardPersist.ts:80-91`. On success the unmount flush calls only `ctx.reportSaveError(stepId, null)`. It never calls `onConfigChange(stepId, pending.config)`, which the normal debounced path does at `:146-148`. So the page's `steps[].config` keeps the pre-edit config. Reproduced in the running app (pipeline `16f66a62…`, filter step):
   - Change the value 260 -> 270, then click step 2 within the debounce. The PATCH is sent and the server stores `"value":"270"`.
   - Re-select step 1. The editor shows **260** and the spine summary reads `duration_s ≥ 260`.
   - Click "ANY (OR)". The server now stores `{"combinator":"OR","conditions":[{…"value":"260"}]}`, so the user's 270 is silently reverted.

   The analyze fingerprint is also never bumped for the flushed edit. None of the three D7 tests re-select the edited step, so all of them pass over this bug.
2. Ledger accuracy (C1): `test-migration.md` §2 cites a non-existent desktop test for the last-row "Insert step after" append. The D5 special case at `PipelineSpine.tsx:171-178` has no unit or e2e test (hel1345 exercises only the first row's "Insert step after").
3. Accessibility: in `SpineStepRow.tsx:98-150` the validation-error, warnings and **save-error** markers are `role="img"` elements nested inside the `.spine-row__select` `<button>`, which also has an explicit `aria-label` (`:102`). Button children are presentational and the `aria-label` overrides content, so assistive tech never hears "Couldn't save the last change to this step". That marker is the only signal of a failed flushed save. jsdom's `getByRole("img")` finds them, so the tests do not catch this.
4. File-size soft budget (CONTRIBUTING.md:24/303): `ui/spine/PipelineSpine.tsx` is 346 lines and `PipelineSpineLayout.tsx` 263, both new files. Non-blocking (soft budget), already flagged by the executor.

Checked and fine: DRY (`useStepPreviewFetch` shared by the phone tray and the desktop table; `useStepCardPreview` is now a thin wrapper), tokens only in the new CSS (no hex/rgb/font-family literals; px only for the grid track clamp, hairlines and the 24px number badge), no `any`, no TODO/FIXME, and `useInFlightGuard` HEL-706 duplicate guard reused via the page hook. Schema files are updated (`pipeline-summary.schema.json` new, `output.schema.json`). `OutputRoutes` reuses batched `panelCountsFor` under the same ACL as `listByPipeline`.

### Phase 3: UI Review — FAIL

Evidence (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.playwright-mcp/eval1579-light-1280.png` (dark theme, 1280x800)
- `/home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.playwright-mcp/eval1579-lighttheme-1280.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.playwright-mcp/eval1579-lighttheme-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.playwright-mcp/eval1579-lighttheme-1100.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.playwright-mcp/eval1579-lighttheme-820.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.playwright-mcp/eval1579-lighttheme-390.png`

Checks:
- Happy path: select, edit, preview, row menus, source menu (Edit source; Remove from pipeline disabled with 1 source), Output card (Open / Output actions / + Output) all work. The header menu holds Rename, Edit source, Set schedule, Run history and Share. There is **no Delete anywhere**.
- Command bar shows only "Data Pipelines". The sr-only `<h1>` is "Data Pipelines: eval-pipe-runs", so the name is not duplicated.
- HEL-1585, this page only: at 1440x900 `documentElement.scrollHeight == 900 == innerHeight` and `<main>` `scrollHeight == clientHeight` (852). The shell no longer scrolls out of view on this page.
- Phone (390x844): still the river view (tabs "Steps" / "Outputs (1)", 4 step cards, footer). The spine class is absent.
- Accent: the e2e accent audit passes (pink and blue presets, both themes, every step kind). **Mutation, shown red**: deleting the 6 `.pipeline-detail-page--spine` rules of `PipelineSpineAccent.css` from the live CSSOM and re-running the audit's own logic in the page moved it from 1 to 6 hits (the filter "+ Add condition" button's color and 4 border colours flagged). So the guard is failable.
  - With the **default orange accent** the audit flags `spine-strip__denial` background (the warning token, hue within 12° of #f97316). That is a false positive of the hue heuristic, not a leak, which is presumably why the spec uses pink and blue.
- Console: only `404 GET /api/pipelines/:id/schedule` (no schedule set). This is pre-existing (`fetchPipelineSchedule` on mount); this diff adds no new console errors.
- **Breakpoint breakage at narrow desktop widths (769–~1000px)**: at 820x800 (context list at its default width) the centre column is about 246px. The filter editor's field picker renders with no visible text, the operator picker is an empty chevron and the value input shows "26" for "260" (screenshot `eval1579-lighttheme-820.png`). The pipeline name is cut to "eval-…" while the command bar no longer shows it either, so the page name is effectively not visible. At 900px the field picker is 76px and the operator 53px wide. At 1100px it is usable. The executor recorded this as UI decision 6 ("the centre column is tight"); it is observable layout breakage at a supported desktop width, not a judgment call.

### Overall: FAIL

### Change Requests

1. **Keep the page state in sync after a flushed save** (`useStepCardPersist.ts:80-91`). In the unmount flush's success branch, call the page's `onConfigChange(stepId, pending.config)`: keep it in the `latest` ref next to `saveContext`; it is the page-level `handleStepConfigChange`, so calling it after the editor unmounts is safe. The page's `steps` then carry the saved config, the spine summary and the analyze fingerprint update, and a later edit no longer reverts the flushed value.
   - Add a test to `PipelineDetailPage.spineEditing.test.tsx` "save on selection change": edit the filter value 180 -> 240, select step 2, let the PATCH resolve, re-select step 1, then assert `getByDisplayValue("240")` and the row summary `duration_s ≥ 240`.
   - Then make one more edit (for example the combinator) and assert the next PATCH body still carries `"240"`. Show it red against the current code.
2. **Close the ledger gap for the last-row append** (`PipelineSpine.tsx:171-178`). Add a `spineEditing` test: open "Step actions for <last trunk step>", choose "Insert step after", pick an op, then assert `createStep` is called **without a position**, as in the append path, and the new step is selected and last. Then correct the `test-migration.md` §2 row to cite it, or point it at a test that exists.
3. **Fix the narrow-desktop editor breakage (769–~1000px)**. The goal: at 820x800 with the context list at its default width, every focused-editor control shows its value and the pipeline name stays readable. Two ways to get there:
   - Let the editor rows wrap. For example, a container query on `.spine-body__main` that stacks the filter/sort/compute condition controls onto their own lines with a sensible minimum width, applied to the shared op-editor row classes under `.pipeline-detail-page--spine` only.
   - Or reduce the spine track at that width.

   Extend `e2e/hel1579-pipeline-spine-layout.spec.ts` "820px" with an assertion that the filter field, operator and value controls are each at least about 120px wide (or show their full value), and that the name button is not ellipsed to fewer than about 8 characters.
4. **Expose spine-row marker states to assistive tech** (`SpineStepRow.tsx:72-82`, `:98-150`). Append the marker states to the row button's accessible name, for example ", has a validation error", ", N schema warnings", ", couldn't save the last change", ", draft". Alternatively, move the markers out of the `<button>` and reference them with `aria-describedby`. Then update the tests that query them with `getByRole("img")` inside the row to assert the accessible name instead.

### Non-blocking Suggestions

- Split `PipelineSpine.tsx` (346 lines). The row-menu builder (`menuItemsFor`, about 60 lines) and the lane context are natural extractions (CONTRIBUTING.md soft budget).
- `accentAudit.ts`: document in the helper that the default orange accent collides in hue with the warning token, so the audit must run with non-orange presets (as the spec does). Otherwise a future caller using the default accent gets a false red.
- The phone layout's trailing comment in `PipelineDetailPage.tsx` ("the section breadcrumb in the top command bar already shows 'Data Pipelines / <pipeline name>'") is now true only on the phone. Reword it so the desktop reader is not misled.
- The ledger's replacement table cites test titles. Adding file:line (or at least the `describe` block) would make the next audit mechanical.
