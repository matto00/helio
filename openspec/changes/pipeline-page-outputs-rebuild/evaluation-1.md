# Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed at HEAD `6f2fb02a`, branch `feature/pipeline-page-outputs-rebuild/HEL-908`, tree clean.
All gates re-run fresh by the evaluator (not trusted from the executor's report).

## Gate re-run (my own, this commit)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (exit 0, `--max-warnings=0`) |
| `npm run format:check` | PASS |
| `npm run typecheck` (`tsc --noEmit`) | PASS |
| `npm test` | PASS — 282 suites, 3002 tests |
| `npm --prefix frontend run build` | PASS |
| `cd backend && sbt test` | PASS — 3536 tests, 0 failed |
| `npx playwright test e2e/hel908-*.spec.ts` | PASS — 5/5 |

Dev-server currency verified before any UI evidence: backend main source last changed
`d55d7a7b` (12:13:54), listening java pid 1514671 started 12:15:44 with cwd in this
worktree — current. (`3902a9d7`, the later backend commit, touches test files only.)
Frontend is Vite dev, serves from disk.

---

### Phase 1: Spec Review — FAIL

Issues:

1. **CR2** — `PUT /api/pipelines/:id/steps/order`'s contract changed materially
   (waiver #2) but neither the live capability spec nor the JSON schema was updated.
   See Change Requests.
2. **CR3** — the ticket explicitly assigns `PipelineDetailPage`'s share of the dead
   `GET /api/types` calls (HEL-936) to this ticket; it was not taken, and produces
   live 404s. See Change Requests.
3. **CR1** — the "add as tail" mechanism does not produce a tail in the most common
   (leaf-anchor) case; design.md decision 5's stated behavior is not met there.
4. **CR8** — task 10.4's file-size audit cites numbers ~100 lines below actual and
   asserts a false provenance for two files this ticket itself created.
5. Task 10.5 claims `features/pipelines` is "clean of `dataTypeId`", classifying
   `outputDataTypeName` as "a DIFFERENT field name". The ticket's own Scope section
   names `outputDataTypeName` explicitly ("Delete ... every `dataTypeId`/
   `outputDataTypeName` reference in `features/pipelines`"), so this is a
   reinterpretation, not a satisfied criterion. Non-blocking on its own; folded into CR3
   because the live-code instance is the same dead `markDataTypeRowsStale` path.

**Dispositions I verified as honest** (do not relitigate):

- Task 4.3 (place-on-dashboard) — genuinely out of scope: `ticket.md`'s "Out of scope"
  section reads "Dashboard picker and panel sheet (P1.6)". Confirmed by reading it.
- Tasks 2.5 / 5.9 — genuinely blocked. `PanelDetailModal.tsx:34-42` imports
  `BindingEditor`/`CollectionEditor`/`MarkdownEditor`/`TextContentEditor`/`TimelineEditor`;
  `MetricEditorForm.tsx:14-15` additionally imports `DataTypePicker`/`fieldOptions`.
  (The handoff mentions only `PanelDetailModal`; `MetricEditorForm` is a second live
  importer — worth naming in HEL-937, but it strengthens rather than weakens the block.)
- Task 6.4 — genuinely blocked: `PanelCreationModal.tsx` imports `ShapeInstantiateStep`.
- `PipelinePreviewModal` genuinely deleted (no file; the only remaining hit is a comment
  in `PipelineDetailHeader.tsx:112`).
- HEL-676 (mobile 375px OUTPUT-bar overlap) — I probed independently and agree it is
  **not reproducible as an overlap**. The footer region is `position: static` and sits
  exactly at the river's bottom edge (river bottom 612, footer top 612 at 375×812), so it
  cannot bleed; `document.documentElement.scrollWidth === innerWidth` at 320/375/430/768/
  1100/1440. The *overlap* half of task 3.6 is honestly dispositioned. The *touch-target*
  half is not — see CR4.
- Both backend non-goal waivers are real, human-authorized, and **not** vacuously
  "mutation-proven". `PipelineStepRepositorySpliceSpec.scala` asserts concrete structure
  (`childrenOf`, `trunkOf` vectors) and contains a genuine mutation proof that exercises
  the old position-0-only reparenting inline and shows it misplaces. Trunk-insert/splice
  non-regression is covered by named cases ("reparent BOTH the old trunk continuation and
  an existing tail onto the new step", "insertAtInternal splices within one sibling group
  only"). `PipelineStepRoutesSpec.scala` covers the reorder 404/403/3×422/no-partial-apply
  cases plus "rejects a request containing a tail id, naming it, and touches nothing" and
  "reorders the trunk-only subset of a tail-bearing pipeline, leaving the tail attached to
  its own node". I checked for a unique constraint on `pipeline_steps` that transient
  relink states could violate — there is none, so the sequential in-transaction updates in
  `reorderTrunkInternal` are safe.

**Named historical invariants — verified NOT regressed:**

- **F-105** (debounced re-analyze must not double-fire on initial seeding): network log for
  a clean page load shows exactly one `GET /api/pipelines/:id/analyze`.
- **HEL-629** (ECharts pie↔cartesian live-switch crash): switched Chart type Line→Pie→Bar
  live in the Output sheet; `_echarts_instance_` id changes each time (forced remount) and
  no new console error appears.
- **HEL-878 / rail-thumbnail staleness (Cycle 13 fix)**: verified live, both paths.
  Immediately after Save the chip reads `CHART / Eval Chart Output / 3 rows` with no
  reopen; after a Dry run it still reads `3 rows`, not `—`.
- **F-146 / StepCard.memo reference stability**: *partially regressed* — see CR5. The
  memo on `StepCard` itself is intact, but two selectors feeding it are reference-unstable.
- **HEL-681** (out-of-order preview/analyze): no evidence of a regression found; the
  rebuilt page's fetches are keyed and reconciled by id.

### Phase 2: Code Review — FAIL

Issues: CR4, CR5, CR7 (below), plus CR1's backend/UI seam.

Positives worth recording: the two new repository primitives are well-named, carefully
documented, and correctly kept distinct from `spliceInsertAtInternal`;
`reorderTrunkInternal` re-derives and re-validates the trunk from a fresh read rather than
trusting the service's pre-check (a genuine race fix, not a comment); the frontend reorder
payload is correctly derived via `buildStepTree(newOrder).trunk` rather than a flat filter;
`validateTrunkReorderRequest` returns diagnosable per-violation messages; the Output sheet
correctly reuses the shared `ui-modal` `<dialog>` primitive (native focus trap + Escape)
rather than hand-rolling; `tokenAuditSweep.css.test.ts`'s baseline re-pin is honest — I
verified every entry shifts by a uniform offset with **no entries added or removed**, so
the token gate was not weakened to accommodate new violations.

### Phase 3: UI Review — FAIL

Triggers matched (`frontend/**`, `schemas/**`, `openspec/specs/**`). Driven live against
the running app at `localhost:6340` / `:9247`.

- Happy path works end-to-end (create pipeline → filter step → Output with live ECharts
  preview → dry run → live rail thumbnail → gallery tab).
- Empty states use the shared component ("No steps yet" + description + actions).
- Breakpoints 1440 / 1100 / 768 / 430 / 375 / 320: **no horizontal overflow, no layout
  breakage** at any width.
- **Console errors present on the ticket's flagship surface** — 4× `GET /api/types` 404
  per page load (CR3). (The `/schedule` 404 is a handled "no schedule set" case, fine.)
- **Touch-target floor fails** under DESIGN.md's mandated measurement (CR4).
- **Interactive elements have accessible names** — all rail chips, step controls, sheet
  fields, and comboboxes do. But the tabs pattern is incomplete (CR6).

---

### Overall: FAIL

---

### Change Requests

1. **`Add tail step` / `Add as tail with aggregate` silently creates a TRUNK step when the
   anchor has no children — the affordance mutates the pipeline's real data path.**
   Probe (live, this commit): on a pipeline whose only step was `filter`, I clicked
   `Add tail step` → `Group & aggregate`. `GET /api/pipelines/:id/steps` returned:
   ```
   {op: "filter",    parentStepId: ROOT,     position: 0}
   {op: "aggregate", parentStepId: <filter>, position: 0}   <-- position 0 = TRUNK
   ```
   and the page rendered it as a second full trunk card (own `Move step up`, own
   `Add tail step`), not an indented dashed tail chain.
   Root cause is sanctioned in the primitive's own doc comment
   (`PipelineStepRepository.attachTailInternal`, `backend/src/main/scala/com/helio/
   infrastructure/persistence/pipelines/PipelineStepRepository.scala`): *"When the anchor
   has NO children yet, the new row lands at `position == 0`, becoming the anchor's trunk
   continuation."* That fallback is defensible for the repository primitive in isolation,
   but it is wrong for the UI affordance built on top of it: a control labelled "tail",
   and an Output flow whose whole premise (design.md decision 5) is that the Output stays
   **render-only**, instead inserts the aggregate into the trunk — so every downstream
   trunk step and the pipeline's persisted run output now flow through it. Adding a tail
   off the *last* step is the common case, and it is wrong 100% of the time, silently.
   Why the suite misses it: `e2e/hel908-tail-attach.spec.ts` only exercises a two-child
   anchor ("off the FIRST of two trunk steps"), and `e2e/hel908-full-flow.spec.ts:100-110`
   explicitly rationalizes the leaf case away as *"a rendering distinction that only
   matters once a node has TWO children"*. That rationalization is false at the data
   level — the persisted row is a trunk row, not an ambiguously-classified one.
   Fix: make `attachAsTail: true` attach at `position >= 1` unconditionally (a leaf anchor
   should get a tail at position 1, leaving position 0 empty), or — if the position-0
   fallback must stay in the repository — have `PipelineService.persistNewStep` reject the
   leaf case for `attachAsTail`, and have the UI branch explicitly. Add a spec case for
   the **leaf anchor** at both the repository and route level, and an e2e case asserting a
   tail added off the last trunk step renders as a tail (`.pipeline-detail-page__step-card--tail`)
   and persists `position >= 1`. Remove the incorrect rationalization comment in
   `e2e/hel908-full-flow.spec.ts`.

2. **Reorder API contract changed but the capability spec and JSON schema still document
   the old behavior.** Waiver #2 changed `PUT /api/pipelines/:id/steps/order` from
   "permutation of *all* current step ids, set each step's `position` to its index" to
   "exactly the current *trunk* ids, relink `parentStepId` and write every trunk
   `position` as 0". Both documents still assert the old contract:
   - `openspec/specs/pipeline-step-reorder/spec.md` — the requirement bullets
     "not exactly a permutation of the pipeline's **current step ids**" and "set each
     step's `position` to its index in `stepIds`" are now false, and the scenario
     "Reorder persists and survives reload" asserts *"the response lists C, A, B **with
     positions 0, 1, 2**"* where the implementation now writes 0, 0, 0.
   - `schemas/pipelines/reorder-pipeline-steps-request.schema.json` — `description` still
     says "must be exactly a permutation of the pipeline's current step ids ... every
     step's position is set to its index in `stepIds`".
   There is no `specs/pipeline-step-reorder/` delta in this change directory, so nothing
   corrects them on archive. Add that spec delta (updated requirement + scenarios,
   including a tail-bearing-pipeline scenario) and update the schema description. This is
   also required by the ticket's own AC ("OpenSpec capability specs ... updated or
   removed") and by CLAUDE.md's "keep schema updates in the same change".

3. **`PipelineDetailPage`'s HEL-936 `GET /api/types` share was not taken — live 404s plus
   three pieces of dead code.** The ticket assigns this explicitly ("take
   `PipelineDetailPage`'s share here, leave the rest, say which taken"); no task
   discloses it as skipped or blocked. In
   `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`:
   - **:234-239** — `useEffect` dispatching `fetchDataTypes()`, commented
     *"HEL-260 — ownership check for the 'Edit Type' button"*. This ticket removed that
     button (header now shows source/schedule/run status/Outputs count only, verified
     live). Result: **4× `GET /api/types` → 404 in the console on every load** of the
     rebuilt page (verified via network log on a clean reload).
   - **:76** — `const { items: dataTypes, ... } = useAppSelector(...)`; `dataTypes` is
     never referenced anywhere else in the file.
   - **:181-183** — `const outputDataTypeId = currentPipeline?.outputDataTypeId;` guarding
     `dispatch(markDataTypeRowsStale(outputDataTypeId))`. The backend no longer serves
     `outputDataTypeId` (only comments describing its removal remain in
     `model.scala` / `PipelineProposalProtocol.scala`), so this is permanently `undefined`
     and the dispatch is unreachable.
   Delete all three (keeping `dataTypesStatus` only if something else needs it — it does
   not). This also closes the `outputDataTypeName`/`outputDataTypeId` live-code half of
   task 10.5.

4. **The ≥44px mobile touch-target AC fails under the verification DESIGN.md mandates.**
   Task 3.6 claims the rail chips were fixed "via the existing `tap-expand-44` hit-expander
   utility, probe-confirmed ... (`::after` height now resolves to 44px)". DESIGN.md's
   "Expander tiling" **[mechanical]** rule states in terms that
   `getComputedStyle(el, "::after")` **cannot** detect this failure and that verification
   "must bisect each control's real hit extent with `elementFromPoint`".
   I ran that bisection at 375×812, 0.25px step, on `.outputs-rail__chip`:
   - real **vertical** hit extent = **36.75px** (326.25 → 362.75), against a 44px floor
     (even with the sanctioned epsilon, `>= 43.75`).
   - real **horizontal** extent = 244.5px for a 243.5px box — i.e. ~0.5px/side, so the
     expander is not extending horizontally at all.
   Root cause: the chip's `::after` computes `inset: 13px 0px -31px` — shifted *downward*
   rather than centered (a 28px control needs `-8px 0 -8px`) — and below the chip the
   later-painted sibling `.pipeline-detail-page__add-tail-row` takes the hits
   (`elementFromPoint` at `chip.bottom + 6` returns `pipeline-detail-page__add-tail-row`,
   not the chip). Additionally the rail's flex `gap` is **8px**, where DESIGN.md requires
   **≥16px** for 28px expander-based controls.
   Fix the `tap-expand-44` application so the expander is centered on the chip, raise the
   rail gap to `--space-*` ≥16px, ensure the expander is not occluded by the add-tail row
   (z-order or layout), and re-verify with an `elementFromPoint` bisection (not `::after`).
   Update task 3.6's note to cite the bisection result, since the currently-cited evidence
   is the kind DESIGN.md names as insufficient.

5. **Two reference-unstable selectors defeat memoization and cause cascade rerenders
   (F-146 class).** React-Redux reports both live on the rebuilt page, and the warning
   count grows with every interaction (2 → 4 → 6 → 8 across my session):
   - `frontend/src/features/pipelines/state/outputsSlice.ts:319-320` —
     `selectOutputsForPipeline` is a plain selector returning
     `state.outputs.byPipeline[pipelineId] ?? []`. The `?? []` allocates a **new array on
     every call**, so `useAppSelector` at `usePipelineDetailPage.ts:384` (`allOutputs`)
     changes identity on every store notification. Warning observed:
     *"Selector unknown returned a different result when called with the same parameters
     ... selected: Array(0), selected2: Array(0)"*, stack pointing at
     `PipelineDetailPage.tsx`.
   - `frontend/src/features/pipelines/state/outputsSlice.ts:349` — the **input** selector
     of `selectOutputsByStepId` has the identical `?? []`, so `createSelector`'s input
     equality check never holds when a pipeline has no Outputs, the output function re-runs,
     and `outputsByStepId` is a fresh `{}` each time. Warning observed: *"An input selector
     returned a different result when passed same arguments."* The doc comment above it
     claims it "memoizes on `byPipeline[pipelineId]` identity" — that claim is false as
     written.
   Fix both with a shared module-level `const EMPTY_OUTPUTS: readonly Output[] = []`
   sentinel (and check `selectOutputsForStep:322-326`, which returns a fresh `.filter()`
   array on every call and has the same exposure if used via `useAppSelector`). Add a test
   asserting reference stability across two calls on unchanged state.

6. **Incomplete ARIA tabs pattern on the new Steps/Outputs tab strip.**
   `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` renders `role="tablist"`
   with two `role="tab"` elements carrying `aria-selected`, but the page has **zero**
   `role="tabpanel"` elements, no `aria-controls` on either tab, no `id` on either tab,
   and no roving `tabindex` (verified live). A `tab` that controls nothing is announced as
   a tab but leads a screen-reader user nowhere, and arrow-key navigation between tabs is
   absent. Give the panel container `role="tabpanel"` + `aria-labelledby`, give each tab an
   `id` + `aria-controls`, and implement roving `tabindex` with Left/Right handling (this
   is the only `role="tablist"` in the codebase, so there is no shared primitive to reuse —
   consider extracting one into `shared/ui/`).

7. **DESIGN.md [mechanical] inline-style violations** (DESIGN.md:63 — inline `style={{}}`
   is allowed *only* for genuinely dynamic values such as portal/popover positioning or
   user-driven appearance overrides). All three are static layout values that belong in
   `OutputEditorSheet.css`:
   - `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx:97` —
     `style={{ height: 240 }}`
   - `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx:138` —
     `style={{ whiteSpace: "pre-wrap" }}`
   - `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx:155` —
     `style={{ overflow: "auto", maxHeight: 240 }}`

8. **Task 10.4's file-size audit cites wrong numbers and a false provenance.** Actual
   line counts at this commit vs. what tasks.md:76-79 states:
   - `usePipelineDetailPage.ts` — **969** actual, tasks.md says 862
   - `OutputEditorSheet.tsx` — **569** actual, tasks.md says 491
   More importantly, the stated reason — *"none of these grew INTO the outlier bracket this
   cycle, they were already over budget from earlier cycles ... not newly introduced here"*
   — is false for both: `git show main:frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`
   returns nothing (the file does not exist on `main`), and `OutputEditorSheet.tsx` is
   likewise created by this ticket. Both are **new** ~400-line-budget outliers introduced
   by this change, and `usePipelineDetailPage.ts` at 969 lines is now larger than the
   788-line `PipelineDetailPage.tsx` the HEL-682 split was meant to break up — the mass
   moved into one hook rather than decomposing. Correct the numbers and the provenance
   claim, and either split `usePipelineDetailPage.ts` (the run/SSE, analyze-debounce, step
   CRUD, and outputs/preview concerns are four natural hooks) or record an explicit,
   honest "new outlier, split deferred to <ticket>" with a filed follow-up.

### Non-blocking Suggestions

- `tokenAuditSweep.css.test.ts`'s new comment states the baseline "shifted by +26"; the
  actual uniform shift across every re-pinned entry is **+59** (e.g. 394→453, 1018→1077).
  The re-pin itself is correct and complete — no entries added or removed, no gate
  weakening — but the comment claims arithmetic was "verified ... not guessed", so the
  wrong number is worth correcting.
- tasks.md task 9.3 records "**30 clicks**"; the fresh run of
  `e2e/hel908-full-flow.spec.ts` prints `HEL-908 task 9.3 flow: 25 clicks`. The
  surrounding reasoning (why line 256's ≤12 budget covers a different scenario and is not
  asserted here) is sound and honest — only the number is stale.
- HEL-937 (the 2.5/5.9 follow-up) should also name `MetricEditorForm.tsx` as a live
  importer of `editors/DataTypePicker` + `editors/fieldOptions`, not just `PanelDetailModal`.
- `attachTailInternal` accepts `parentStepId: Option[PipelineStepId]`, but a `None` there
  would append at the root sibling group — a shape the tail concept has no meaning for.
  Consider tightening the parameter to a non-`Option` `PipelineStepId`, since
  `PipelineService` only ever calls it inside the `parentStepId`-present branch.
