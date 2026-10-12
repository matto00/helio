## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `b71af7072ef6e7e7603c097c3e18276d4f18b318` (branch `task/hel1464-followups-overflow-e2e/hel-1510`).

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/hel1464-followups-overflow-e2e/hel-1510`.
- **Artifacts read:** ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-output-sheet/spec.md, workflow-state.md.
  There are no TODO/TBD placeholders. Each AC maps to tasks: AC1 -> 1.1/1.2, AC2 -> 1.3/1.4, AC3 -> 2.1-2.3, and the
  eslint/hooks rule -> C2 and 2.4.

**D1 (stop prepending "— None —" in ChartDisplayFields)**
- `ChartDisplayFields.tsx:103` prepends `{value:"", label:"— None —"}`. Lines 257 and 275 feed it to both scatter
  selects. The prop doc at :45-46 says the prefix is "added here".
- The only production caller is `OutputKindFields.tsx:176`. A grep of `<ChartDisplayFields` finds only that call and
  the unit test. It passes `fieldOptions`, which is `ChartKindFields`'s prop. `OutputKindConfigCard.tsx:88` passes
  `aggFieldOptions` there. That comes from `aggColumnOptions()` (`OutputEditorSheet.tsx:149`, `outputConfigTypes.ts:204-206`),
  which already starts with the same `{value:"", label:"— None —"}`. So the duplicate is confirmed.
- **Duplicate-key mechanism confirmed:** `Select.tsx:229` renders `<li key={option.value}>`, so two `""` values give a
  duplicate key. The `placeholder="— None —"` prop is only the trigger label (`Select.tsx:188`) and never adds an
  option, so after D1 the clear option appears exactly once.
- **The Annotation select is unchanged:** `ChartDisplayFields.tsx:121` passes `fieldOptions` straight to
  `BoundOrLiteralField`, which uses it as-is (`BoundOrLiteralField.tsx:96`). D1 does not touch that path. It already
  shows "— None —" once, as `OutputEditorSheet.configPatch.test.tsx:208` (`choose("Annotation field", "— None —")`) relies on.
- **Other consumers of the same list are unaffected:** `OutputKindFields.tsx:143` already strips `""`, and
  `ChartAggregationFields` receives the list unchanged. D1 is correct for every caller.
- The unit test fixture (`ChartDisplayFields.test.tsx:42-45`) passes columns only. The planned fixture edit (adding a
  leading clear option) matches what the production caller sends, and the design says so.

**D2 (typed mock)**
- `RestApiForm.test.tsx:42` ends with `} as unknown as UseRestSourceFormReturn;`.
- `UseRestSourceFormReturn = ReturnType<typeof useRestSourceForm>` (`frontend/src/features/sources/hooks/useRestSourceForm.ts:166`).
  The design gives only the file name; the file is under `hooks/`, not `ui/forms/`.
- I compared the hook's return object (:140-163) with the mock. The only missing member is `reset` (:98, :161).
- `frontend/tsconfig.json` includes `"src"` with no exclude, so the test file is inside `npm run typecheck`. Removing
  the cast will produce a red typecheck, as D2 plans.

**D3 (rendered-geometry e2e; can it go red on a reverse-applied d6aef6c46 CSS hunk at 1100px?)**
- `git show d6aef6c46 -- frontend/src/features/panels/ui/editors/TableDisplayFields.css | git apply -R --check`
  succeeds (`REVERSE_APPLIES_CLEAN`). No commit since d6aef6c46 touches that file or `TableDisplayFields.tsx`.
- The reverse-apply gives back the exact pre-HEL-1464 state: the shrink rules return inside `@media (max-width: 768px)`.
  At 1100px they are therefore inactive.
- **Measured precedent that the assertions fail in that state.** The HEL-1464 evaluator re-imposed those rules in the
  browser at 1100px with an 86-char name. It measured the furthest control +222px past the Configuration card's
  content box, with the modal body at scrollWidth/clientWidth 903/718
  (`openspec/changes/archive/2026-10-11-output-editor-overflow-labels/evaluation-1.md:93-98`).
- The card did not grow with its content: the overflow was measured against the card's own content right. So D3's
  card-containment assertion and its scrollWidth assertion both trip.
- After the fix, every one of 42 readings showed overflow 0 (`skeptic-final-1.md:58-66`), so the green run is expected
  to hold.
- `playwright.config.ts` runs against the live Vite dev server (DEV_PORT). A source-level `git apply -R` therefore
  reaches the page under test, and C4's red run is real.
- **Scheduling:** `scripts/e2e-shard.mjs:56` gives an unlisted discovered spec the median weight, so the new spec is
  scheduled. CI discovers specs by glob (`ci.yml` ~:627-633).

**Deleting TableDisplayFields.css.test.ts**
- That guard only regex-checks four base-rule declarations (`min-width: 0` x3 and `minmax(0, 1fr)`). It guards nothing
  else.
- AC3 says literally "The CSS-source-text guard is replaced by it".
- HEL-1464's own final skeptic said the guard could go red falsely on a behaviour-preserving selector regroup, could
  not see an overflow caused by an ancestor, and recommended exactly this e2e (`skeptic-final-1.md:130-132`).
- No other file references the test.
- Deletion is justified. The lost pre-commit coverage is disclosed in Risks.

### Verdict: CONFIRM

### Non-blocking notes

1. **Name the scroll container in D3 precisely.** Assert scrollWidth <= clientWidth on the Modal's scrolling body (the
   element HEL-1464 measured at 718px), not on `.output-preview-pane__table-section`. That section is `overflow: auto`
   (`OutputEditorSheet.css:130-133`) and scrolls horizontally by design, so it would make the green run fail.
2. **Pin the 86-char string.** Character width matters: HEL-1464 found that a realistic 49-char name does not overflow
   even with the old CSS. Use an ordinary lowercase/underscore identifier of 86 chars, like HEL-1464's fixture.
   C4's required red run will catch a string that is too narrow, but pinning it avoids a wasted cycle.
3. **Add the e2e-specific checks to task 2.4:** `npm run check:e2e-types`, `check:e2e-user-cleanup` (registration must
   be followed by `recordRegisteredUser(`) and `check:e2e-evidence-paths` (any screenshot path must go through
   `evidencePath(`). These are not in the listed gates.
4. **Duplicate-key test:** the listbox is portalled and renders only while open (`Select.tsx:193`). The red test must
   actually open each picker, as D1 says, or the key warning never fires and the test is green at base.
5. **Re-sync before the PR**, as the ticket's driver note asks: HEL-1508 may touch the chart pickers. Re-check
   `ChartDisplayFields.tsx:103` and its callers after the rebase.
6. The design's Planner Note is accurate: `isBound={fieldOptions.length > 0}` is always true on this path, so the
   "Bind a data type…" hint is unreachable. A follow-up is fine; it is not in scope.
