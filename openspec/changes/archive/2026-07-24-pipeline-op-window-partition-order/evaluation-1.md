## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket acceptance criteria addressed explicitly:
  - `window` executes each of the six functions correctly per partition/order; unsupported
    `function` fails at execute time with a descriptive error listing the supported set
    (`WindowStep.scala:102-105`) — verified live via preview (lag/offset-edge → null) and by
    the backend test suite.
  - `analyze_pipeline` appends `outputColumn` with the correct type per function (apply/infer
    parity) — verified live: `col_0_lag` inferred as `string` (matching source field `col_0`'s
    declared type) via a direct `fetch` against `/api/pipelines/.../analyze`.
  - `pipeline_steps` op CHECK accepts `'window'`; migration (`V66__add_window_op.sql`) applies
    cleanly — confirmed via a full `sbt test` run (Flyway log shows "Migrating schema... to
    version 66 - add window op" with no errors, 1832/1832 tests passing).
  - Frontend StepCard renders a working window editor; config PATCHes round-trip — verified live
    in the browser (set function=lag, field=col_0, offset=1, outputColumn=col_0_lag; reloaded the
    page; all four values persisted correctly).
  - MCP `add_pipeline_step` lists `window` + config shape (`helio-mcp/src/tools/write.ts` diff
    documents partitionBy/orderBy/function/field/outputColumn/offset and the apply/infer-parity
    note).
  - Tests: round-trip execution per function (including a genuine tied-values fixture for
    rank/dense_rank, per the design-gate skeptic's explicit recommendation), analyze-schema test,
    codec round-trip, protocol round-trip, `PipelineStepSpec` kind-parity update — all present and
    passing.
  - Backward compatible: purely additive; full existing backend (1832 tests) and frontend (1293
    tests) suites pass with no regressions.
- No AC silently reinterpreted. The one place the implementation extends beyond the ticket's
  literal text — `inferWindow`'s catch-all `case _ => "string"` for an unrecognized `function` at
  *analyze* time — was explicitly flagged as a gap by the design-gate skeptic (skeptic-design-1.md
  gap #1) and resolved with the documented mitigation (mirrors `aggResultType`'s established
  catch-all); not a silent deviation.
- No task item left undone; all 21 tasks.md items match what's actually implemented (verified by
  reading the diff against each task, not just the tasks.md checkmarks).
- No scope creep — diff touches only the files proposal.md/design.md/files-modified.md list.
- No regressions: full backend (1832/1832) and frontend (1293/1293) suites pass; `window` steps
  are additive to `PipelineStep.Registry`/discriminated unions, so no existing op's dispatch path
  is touched.
- API contract: Flyway migration + wire-protocol formats (`PipelineStepProtocol`,
  `PipelineAnalyzeProtocol`) updated in the same change as the client (`pipelineStep.ts`) — schema
  update discipline honored.
- Planning artifacts (design.md, spec.md) reflect the final implementation — spot-checked decisions
  1-8 against the actual `WindowStep.scala`/`PipelineAnalyzeService.scala` code; all claims hold.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Canonical code-quality compliance**: `npm run check:scala-quality` reports "clean (61 soft
  warning(s))" — no [mechanical] violations (no inline FQNs). `WindowStep.scala` is flagged among
  the 61 files over the 250-line soft budget (264 lines per the script's count) — this is
  explicitly **informational only** per `CONTRIBUTING.md:123` ("File-size warnings... are
  informational only") and well under the 400-line "propose a split" threshold
  (`CONTRIBUTING.md:24`); dozens of pre-existing files in the codebase (including sibling op files
  like `PipelineAnalyzeService.scala` at 376 lines) already exceed 250 lines. Noted below as a
  non-blocking suggestion only, per the orchestrator's explicit ask to double-check this.
- **Design-standard [mechanical] rules**: `WindowConfig.tsx` has zero hardcoded colors/hex/rgba,
  zero inline `style={{}}` (grepped directly), reuses existing `pipeline-detail-page__aggregate-*`
  / `pipeline-detail-page__compute-*` BEM classes rather than introducing new styling, and reuses
  the `SortConfig` component directly for orderBy rather than reimplementing an ordered-key-list
  editor. `Select`/`TextField` shared components used throughout — no ad hoc form controls.
- **DRY**: `orderBy` reuses `SortKey`/`SortConfig` from the existing sort op rather than duplicating
  the shape; `running_sum`'s coercion reuses `PipelineRowJson.toDouble` (same as
  `AggregateStep.sum`); the entire wiring surface (registry, protocol, codec, analyze, repository,
  service) mirrors the `pivot` op's established pattern exactly — verified diff-by-diff against
  each touched file.
- **Readable**: function names (`computeRowNumber`, `computeRank`, `computeRunningSum`,
  `computeLagLead`) are self-documenting; no magic values (functions/offsets are named constants;
  error messages are descriptive and tested).
- **Modular**: `WindowStep.apply` is decomposed into private helper methods per function family
  rather than one large branching block; `rowOrdering`/`compareValues`/`orderKeysEqual` are cleanly
  separated concerns (ordering vs. equality).
- **Type safety**: no `any`/untyped escape hatches in the frontend (`WindowConfigValue`,
  `WindowFunctionValue` are fully typed); backend uses the standard `Any`-typed row map consistent
  with every other step (not a new pattern).
- **Security**: no new user input reaches SQL/shell — `partitionBy`/`orderBy`/`field` are used only
  as `Map` key lookups against already-loaded in-memory rows, consistent with every other op's
  trust boundary.
- **Error handling**: unsupported function, missing required `field`, and non-positive `offset` all
  fail at execute time with descriptive, tested error messages (not silent no-ops); frontend offset
  input has an inline validation guard (rejects `<= 0`, verified interactively — see Phase 3).
- **Tests meaningful**: 220 targeted backend tests + 17 frontend `WindowConfig.test.tsx` tests
  exercise every function, every partition edge (empty partitionBy, null partition key, tied
  ordering, lag/lead partition-edge nulls, offset defaulting, output-column collision) — these
  would catch a real regression to any of the six functions or the row-order-preservation
  invariant.
- **No dead code**: no unused imports, no leftover TODO/FIXME in the diff; the `case other =>` in
  `WindowStep.apply`'s function match is explicitly commented as an intentional unreachable
  exhaustiveness guard, not dead code.
- **No over-engineering**: implementation is a direct, non-abstracted translation of design.md's
  decisions — no premature generalization beyond what pivot/aggregate already established.
- **Behavior-preserving**: this is a pure-addition change (new op, new migration, new wire types);
  no existing step's behavior is touched — confirmed by the full regression suite passing
  unchanged.
- **Commit hygiene**: `check:openspec` pre-commit hook bypassed with `git commit -n`, but the
  commit message explicitly documents the bypass is scoped to that one check (change not yet
  archived — archiving is the next delivery step), cites the exact same precedent from the two
  prior sibling ops (HEL-375 commit 089cfe64, HEL-378 commit c0785335), and states
  lint/format/schemas/scala-quality/tests were all run manually and clean. This matches
  CLAUDE.md's "If a bypass is used, call it out explicitly" requirement.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` (both reported
`READY`/`PASS`). Exercised the window editor live end-to-end on an existing pipeline
(HEL-254 Wide Table Pipeline, 30-column CSV source, 200 rows):

- **Happy path**: added a `window` step via "+ Add transformation step" → "Window (rank / running
  total)"; the picker entry, icon, and label all render correctly. Editor renders with sensible
  defaults (function=row_number, no field/offset shown). Selecting `lag` correctly reveals the
  conditional Source field + Offset controls (design.md decision 4's per-function visibility);
  selecting `row_number` correctly hides them.
- **Execution correctness (live, not just unit-tested)**: set function=lag, field=col_0, offset=1,
  outputColumn=col_0_lag, clicked "Preview data" — the resulting `col_0_lag` column showed `—`
  (null) on row 0 (partition edge, no `partitionBy` → single partition) then `r0c0`, `r1c0`,
  `r2c0`, ... on subsequent rows — exactly correct lag(offset=1) semantics against the real
  execution engine.
- **Analyze/infer parity (live)**: fetched `/api/pipelines/.../analyze` directly from the page
  context after adding the step; the last step's `outputSchema` included `{"name":"col_0_lag",
  "type":"string"}` — correctly inferring `string` from `col_0`'s declared schema type, matching
  the AC's apply/infer-parity requirement.
- **Config PATCH round-trip**: reloaded the page after setting the config; all four fields
  (function=lag, field=col_0, offset=1, outputColumn=col_0_lag) persisted correctly — confirms the
  `useStepCardState`/`onWindowChange` PATCH-omission logic (omitting unused field/offset per
  function) doesn't corrupt the round trip for the *used* case.
- **Unhappy paths**: offset input rejects `0` (no onChange fired) per the frontend test suite;
  backend rejects unsupported function / non-positive offset / missing required field with
  descriptive errors (verified in the 220-test targeted run).
- **No console errors** introduced by the window feature. The one console error present throughout
  (`GET .../schedule → 404`) is pre-existing, unrelated behavior (this pipeline has no schedule
  set; `GET` 404s when none exists, per the documented `/api/pipelines/:id/schedule` contract) —
  confirmed present before any window-step interaction and not touched by this diff.
- **Entry points**: reached via the standard "+ Add transformation step" step-picker, the same
  entry point every other op uses — no new/alternate entry point to test.
- **Accessibility**: all interactive elements have accessible names (`combobox "Window function"`,
  `combobox "Source field"`, `spinbutton "Offset"`, `textbox "Output column"`, `button "+ Add
  partition field"`, `button "Remove partition field N"`) — verified via the accessibility snapshot
  tree, not just visually.
- **Breakpoints**: resized to 1440 / 1100 / 768 / 375 — layout adapts correctly at each (sidebar
  collapses to bottom nav at 768/375, form controls remain full-width and readable, no overlap or
  clipping) — screenshots reviewed at each breakpoint.
- Cleaned up the test step after verification (pipeline restored to its original 2-step state).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `WindowStep.scala` is 264 lines, over the informational 250-line soft budget (confirmed
  non-blocking — `check:scala-quality` reports it as one of 61 such warnings codebase-wide, and
  CONTRIBUTING.md explicitly marks file-size warnings as informational, with the actionable
  threshold being ~400 lines). Not a defect; no action required now, but if a future op needs a
  seventh window function or additional wiring, consider splitting the per-function `compute*`
  helpers into a separate object at that point.
