## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: `fe2bfc4d94b8e1d266666bc5b066fc4c820d9ee5` against live-resolved base `5b99a846b83f23d983aadc315139c94f31901497`
(`resolve-review-base.sh`, origin/main). Evaluator evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1464/evidence/eval-1/`
(outside the worktree, so it survives `cleanup.sh --phase4`). The executor's evidence was treated as claims and re-measured.

### Phase 1: Spec Review — PASS
- AC1 (overflow): re-measured live, see Phase 3. Contained at 1440/1100/1024/900/769/768/375 in both themes for three
  fixtures. `title` holds the full name, and HEL-469/HEL-813 invariants hold.
- AC2 (seven labels): all seven use `useId()` (`AddRootModal.tsx:31`, `CreatePipelineModal.tsx:47`, `DividerEditor.tsx:27`,
  `FormEditor.tsx:45`, `ImageEditor.tsx:40`, `PipelineScheduleDialog.tsx:91`, `RestApiForm.tsx:32`). No literal ids
  are left. D3a (no `for` when the picker is absent) is implemented and verified live. My own whole-tree sweep found 71
  non-test literal `htmlFor` values with 0 dangling (`eval-1/htmlfor-sweep-eval.txt`). The same file records that at
  the base none of the seven literal targets had an element id, so the static "before" state is self-authenticating.
- AC3 (2.5.3): color-by is now "Scatter color by field" and Bins is now "Histogram bins". The consumers (unit test,
  labels test, five heatmapHistogram queries, e2e `hel1311…:500`, snapshot line 312) were updated by changing the exact
  string. No matcher was loosened. The audit covers scatter, histogram, table, metric, collection, timeline, line and bar.
- AC4: no new `eslint-disable` (`git diff | grep '^+.*eslint-disable'` only hits planning prose). Tokens are fine: the
  CSS diff adds only `min-width: 0` and `minmax(0, 1fr)`, with no new literal spacing, colour or type values. Verified
  in the running app (Phase 3).
- Tasks 1.1–2.6 are all checked and match the diff. There is no scope creep: the only file outside the plan is the
  shared test helper `frontend/src/test/labelAssociation.ts`, which supports D6. There is no API or schema change. The
  planning artifacts match what was implemented.
- Constraints: C1 (red first) was re-verified independently, see Phase 2. C2: no new disable and no hook bypass. C3
  and C4 were honoured by both the executor and the evaluator, see Phase 3.

### Phase 2: Code Review — PASS
Gates, run fresh in `WORKTREE_PATH` by the evaluator (`eval-1/gate-*.txt`):
- `npm run lint`: exit 0 (`--max-warnings=0`).
- `npm run format:check`: all files clean.
- `npm test`: 48/48 suites and 453 tests (root), then 545/545 suites, 5921 tests and 19 snapshots (frontend), exit 0.
- `npm --prefix frontend run build`: exit 0.
- `sbt testFull`: not run. The change is frontend only (driver instruction).

Red-first (C1), re-measured independently. I made a throwaway detached worktree at the base SHA, overlaid only HEAD's
test files plus the `labelAssociation.ts` test helper, and hardlink-copied `frontend/node_modules`. Results in
`eval-1/red-on-base.txt`: 34 tests failed and 122 passed. The failures were assertion failures, not compile failures.
They cover:
- every new label-association test, uniqueness test and D3a test on all seven surfaces;
- both 2.5.3 tests and the scatter/histogram sweeps;
- the title test;
- all four CSS guard tests.

The scratch worktree was removed (`git worktree list` is clean). Note: the executor's first red run (`red-jest.txt`)
had three suites fail to *compile*, because the helper import path was missing on the old tree, and a compile error is
not a meaningful red. Its second run (`red-jest-modals.txt`) and my run both show real assertion reds for those suites,
so C1 holds.

`TableDisplayFields.css.test.ts` (the driver asked for a judgment on this file):
- **Labelled as a guard:** yes. The header says "source-text guard (NOT rendered evidence; the running-app measurement
  … is the proof)".
- **Failable by mutation:** yes. All four cases were red on the base CSS, which is exactly the "shrink rules gated in
  the media block" mutation.
- **Not presented as the proof:** correct. `files-modified.md` lists it as a "labelled guard". The causal proof is the
  live measurement, which I strengthened with an in-browser mutation (Phase 3).

So it is acceptable. Its limits are recorded under suggestions.

Code quality:
- The `useId()` hooks sit above any early return, so rules-of-hooks is satisfied and lint passes.
- The D3a ternary is minimal.
- The `title` attribute follows DESIGN.md's native-tooltip pattern (§5, line 433), so no shared tooltip component was
  needed (D2).
- The CSS comments were updated so they no longer claim the shrink rules are phone-only.
- No dead code, no TODOs, no over-engineering.
- The tests go through the `<label>` element (`htmlFor` → `getElementById` → the role-plus-name control), which closes
  the "`getByLabelText` matches `aria-label`" hole the design called out.

### Phase 3: UI Review — PASS
Setup:
- Servers were started with `start-servers.sh` on 6896/9803. The serving processes' cwd was the worktree's
  `frontend/` and `backend/` (`eval-1/server-pids.txt`). I stopped them afterwards by recorded PID (210094 210079
  209858 209616 209574), and both ports are free.
- I used my own Playwright Chromium, not the shared MCP browser, so nothing was written to `.playwright-mcp/`.
- Throwaway user `hel1464-eval-1791758748921@example.test`, id `b86691b4-91b5-4309-8a17-afed12a92fef`. The id was
  recorded in `eval-1/eval-state.json` before any probe. Identity (`/api/auth/me` id and email) was checked before every
  probe and `location.href` was recorded with every reading.
- All fixtures were deleted by exact id, then the user was deleted by id plus email (`eval-1/cleanup.log`).
- Probes were paced at 5–8 s between page loads.

Overflow (`eval-1/overflow-measurements.json`, screenshots in `eval-1/shots/overflow-*`):
- **Fixtures:** the ticket's own HEL-1432 49-char name (`customer_lifetime_value_adjusted_for_seasonality1`), the
  executor's wide-glyph 49 (`COL_WMOQ…`), and an 86-char name.
- **Grid:** light and dark × 1440/1100/1024/900/769/768/375.
- **Containment:** in all 42 readings the furthest-right descendant of the table options is at the Configuration
  card's content-box right edge (maxOver = 0), and nothing extends left of the content box. The dialog's
  `scrollWidth == clientWidth` and the document never scrolls sideways.
- **HEL-469:** the name is never 0px wide (199–576 px), the checkbox is 13px wide, and the format wrapper stays 140px.
  At 769px and above the name ellipsizes with `title` equal to the full name.
- **HEL-813:** the move-button gap is 16px (`--space-4`) everywhere, the `::after` expander is 44×44 at ≤768px, and
  the expander clears the format select horizontally at 375 (7px).

Causal check, an in-browser mutation (`eval-1/mutation-overflow.json`, `shots/mutated-regated-86-light-1100.png`):
- At 1100 on the live after-tree, re-imposing `min-width: auto` and an auto track on the four selectors brings the
  overflow back: 49w goes to +142px with the modal body at 823/718, and 86 goes to +222px at 903/718.
- Removing the override returns both to 0.
- This matches the executor's "before" (142 / 232).

The 49-char wide-glyph substitution is justified:
- The ticket's own realistic 49-char name does **not** overflow even with the shrink rules re-gated (0px), so it
  cannot show the defect at the current sheet width.
- The wide-glyph 49 is a worst-case 49-character string and was disclosed in `task-1.1-root-cause.md`.
- The ticket's "23–70px with a 49-char name" figure is not reproducible with the current fixture and sheet. This does
  not block, because the fix is shown red/green on 49w and 86.

Labels, keyboard and accessible names (`eval-1/labels-light-all.json`, `eval-1/labels-dark-all.json`, both themes):
- **Association:** for all seven surfaces plus color-by and Bins, `label.htmlFor` is non-empty, resolves to exactly one
  element, and `label.control` is that element. The seven use `useId()` ids (`_r_…_`) on a `<button role=combobox>`.
- **Accessible names**, from the accessibility tree: "Data source" ×2, "Schedule kind", "Method", "Divider
  orientation", "Image fit", "Bound dataset", "Scatter color by field", "Histogram bins". Each contains its visible label
  text.
- **Keyboard:** each control is reachable with Tab. Enter expands the listbox (`aria-expanded=true`, options visible).
  Escape collapses it and leaves the dialog open. Clicking the visible label focuses and opens the control.
- **D3a, live:** before any source existed, CreatePipelineModal's "Data source" label had no `for` attribute and no
  combobox was rendered (`eval-1/d3a.json`).
- **Output-editor 2.5.3 audit (live):** every associated label in edit/scatter, edit/histogram and edit/table passes.
  This covers Name, Kind→"Output kind", Chart type, Point size field, Color by field, Field→"Histogram field", Bins and
  Cell density.

Console errors seen during the flows (`eval-1/console-labels-light.log`). None come from this diff:
- 401 on `/login` before sign-in.
- 404 on fetches for the schedule and unmaterialized rows.
- ECharts zero-size warnings.
- A React "two children with the same key" error, key `""`, in the scatter color-by/size Select. Its options list
  contains "— None —" twice: the placeholder plus an empty-value field option (`eval-1/dupkey.log`). The base code at
  `ChartDisplayFields.tsx:270-276` has the same `placeholder` plus `fieldSelectOptions`, and the diff changes only the
  `ariaLabel` line. The error is pre-existing and not introduced here.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `frontend/src/features/sources/ui/forms/RestApiForm.test.tsx:42`: `as unknown as UseRestSourceFormReturn` hides the
  fact that the mock omits `reset` (the hook returns it, `useRestSourceForm.ts` return block). Adding `reset: jest.fn()`
  and dropping the double cast would let tsc catch future drift between the hook and the mock. The double cast is
  common in this repo's tests (31 sites), so this does not block.
- `TableDisplayFields.css.test.ts` parses CSS with regexes. If a behaviour-preserving refactor moved `min-width: 0` into
  a grouped selector list (`.a, .b { … }`), the guard would turn red without a real regression. It also cannot see an
  ancestor-caused overflow. A Playwright check at 1100px, asserting card containment for an 86-char column, would be
  the real regression test if one is wanted later.
- Pre-existing, out of scope: the scatter size/color Select shows "— None —" twice and logs a duplicate React key `""`.
  This is worth a follow-up ticket.
- Process note: the executor's first red run (`red-jest.txt`) included three compile-failure suites. Future red runs
  should overlay test-support helpers so the red is always an assertion red; the second run did this.
