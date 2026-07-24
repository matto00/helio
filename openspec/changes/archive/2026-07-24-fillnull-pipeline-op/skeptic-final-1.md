## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth diff scope**
- `git log --oneline main..HEAD` = 4 commits (this branch stacks on unmerged sibling lanes
  window/unpivot/dedupe). Isolated this ticket's actual change via `git diff HEAD~1..HEAD --stat`
  (31 files, 1348 insertions) and reviewed every non-test file in full.

**Flyway migration (V69)**
- `ls backend/src/main/resources/db/migration | sort | tail` confirms `V69__add_fillnull_op.sql`
  is the current max, immediately following `V68__add_dedupe_op.sql`; `main` is at `V65`, so this
  is the correct uncontended next number for this stacked-branch state.
- Queried the live dev Postgres directly: `SELECT version, description, success FROM
  flyway_schema_history ORDER BY installed_rank DESC LIMIT 15` — `69 | add fillnull op | t`,
  applied cleanly, no collision.
- Full `sbt test` run (below) also drives Flyway from scratch against embedded Postgres and
  migrates cleanly through v69.
- Migration correctly extends `pipeline_steps_op_check` with `'fillnull'` via the established
  drop/re-add pattern, listing all prior op values plus the new one.

**`inferFillNull` dispatch arm (specifically scrutinized per instructions)**
- Read `PipelineAnalyzeService.scala` line 70: `case "filter" | "limit" | "sort" | "dedupe" |
  "fillnull" => (inputSchema, None)`. Confirmed `fillnull` joins the *true* identity-passthrough
  arm, NOT `inferCast` (`case "cast" => inferCast(config, inputSchema)` is a separate arm at line
  72). This matches the spec's `Requirement: FillNull op fills null cells...` schema pass-through
  scenario and the design.md decision 7 claim exactly.

**FillNullStep.scala — five strategies read line-by-line**
- `constant`: `fillConstant` replaces only `isNull` cells with the raw string; fails with
  `IllegalArgumentException` naming `'value'` if `cfg.value` is absent — matches spec scenario.
- `forwardFill`: `fillForward` uses a single left-to-right mutable `lastSeen` map seeded to
  `null` per column; a cell is only overwritten if `lastSeen(col) != null` (i.e. a non-null value
  has been seen already) — correctly leaves a leading-null run untouched. Verified against the
  ticket's explicit scenario `[null, null, price:5] -> [null, null, 5]` via the backend test
  (passing, see below).
- `mean`/`median`: coerce via `PipelineRowJson.toDouble` (read directly — null/non-numeric ->
  `None`, matching `AggregateStep.avg`'s coercion contract). `computeMedian` handles both the odd
  case (`nums(n/2)`) and even case (`(nums(n/2-1)+nums(n/2))/2.0`) correctly on the sorted vector.
- `mode`: uses an explicit `LinkedHashMap`-based ordered count (not `groupBy`, whose iteration
  order is unspecified) so first-encountered tie-break is deterministic; `.maxBy` on a
  `LinkedHashMap` preserves insertion order for equal counts, giving the first-encountered winner.
- `isNull` unifies missing-key and explicit-null via `row.getOrElse(column, null) == null` — a
  single definition used consistently by all five strategies (no divergent null-check logic).
- Unsupported strategy fails before any strategy dispatch with a message naming the invalid value
  and the five supported strategies.

**Exhaustive-match consumer sites — grepped and read directly (not assumed)**
- `PipelineStep.scala`: `FillNullStep.Kind -> FillNullStep.companion` registered;
  `PipelineStepKind.FillNull` constant defined.
- `domain/package.scala`: `FillNullStep`/`FillNullConfig` re-exported.
- `PipelineStepProtocol.scala`: `FillNullStepResponse` + `jsonFormat6` + read/write union arms +
  `fromDomain` case for `FillNullStep`.
- `PipelineStepConfigCodec.scala`: `encodeConfig`/`extractConfig` arms for `FillNullConfig`.
- `PipelineAnalyzeProtocol.scala`: `FillNullAnalyzeStepResponse` + `jsonFormat6` + read/write
  union arms.
- `PipelineStepRepository.scala`: `rowToDomain` arm constructing `FillNullStep` from
  `FillNullConfig`.
- `PipelineService.scala`: `toAnalyzeStepResponse` arm for `FillNullConfig`.
- `PipelineStepSpec.scala`: `allSubtypes`, `PipelineStepKind.All`, kind-match, and the exhaustive
  pattern-match coverage test all updated with `fillNull`/`FillNullStep`/`PipelineStepKind.FillNull`
  — confirms the sealed-trait dispatch is exhaustive (compiler would fail a `MatchError` test
  otherwise; this test explicitly exercises that).

**Frontend wiring (StepCard, useStepCardState, stepNarrowing, pipelineStep.ts)**
- `stepNarrowing.ts`: `OP_TYPES` entry (`"Fill null / impute"`, `faFillDrip` icon),
  `defaultConfigFor("fillnull")` returns `{columns:[], strategy:"constant", value:null}`,
  `fillNullConfigOf` narrowing helper tolerant of malformed strategy values.
- `useStepCardState.ts`: `fillNullConfig` state + `onFillNullChange` handler wired identically to
  every sibling op.
- `StepCard.tsx`: `FillNullConfig` rendered when `step.opType.id === "fillnull"`.
- `pipelineStep.ts`: `FillNullConfig`/`FillNullStep`/`FillNullAnalyzeStep` types + all 3 union
  additions (`PipelineStep`, `PipelineStepConfig`, `AnalyzeStepResult`) — matches the "4 additions
  per op" pattern noted in the ticket.
- `FillNullConfig.tsx`: reuses `DedupeConfig`'s checklist CSS classes and shared `Select`/
  `TextField` components — no new one-off markup, no hardcoded colors/spacing (spot-checked, all
  class-driven).

**MCP write.ts**
- `add_pipeline_step` tool description updated: op list now includes `fillnull`; full config-shape
  documentation added (constant/forwardFill/mean/median/mode semantics, schema-preserving note).
  Correctly notes `type` is free-text `z.string()` (no schema/enum change needed).

**Gates — re-run fresh, not trusted from evaluator's paste**
- `sbt testOnly` targeted at the 5 changed backend spec files: **258/258 passed**.
- `sbt test` (full backend suite, drives Flyway from scratch through V69): **1870/1870 passed**,
  0 failed, 0 canceled. Confirms no regression anywhere else in the backend.
- `npm test` (full frontend suite): **1322/1322 passed**, 127 suites.
- `npm run lint` (zero-warnings ESLint policy): clean, no output.
- `npm run format:check` (Prettier): "All matched files use Prettier code style!"
- `npm run build` (Vite production build): succeeded, no errors (only the pre-existing >500kB
  chunk-size advisory, unrelated to this change).

**Live UI verification (browser, Playwright) — since frontend/** changed**
- Started servers via `scripts/concertino/start-servers.sh`; `assert-phase.sh servers` → `PASS`.
- Navigated to an existing wide-schema pipeline (30 columns), opened the op dropdown — "Fill null
  / impute" present with a fill-drip icon; added a step (`POST .../steps` → `201`), 3-step count
  incremented.
- Expanded the step card: columns checklist rendered 30 checkboxes with the "Only null cells
  (missing or explicit null)..." helper text, strategy dropdown defaulting to `constant`, constant-
  value text input visible (dark theme, screenshot `fillnull-editor-expanded.png`).
- **Config PATCH round-trip, live-verified at the wire level (not just rendered):** checked
  `col_0`, opened the strategy combobox, selected `mean`. Captured network requests:
  `PATCH /api/pipeline-steps/98fd70af-... -> 200` (twice, once per change). Fetched
  `GET /api/pipelines/:id/steps` directly and confirmed the persisted server-side config is
  `{"columns":["col_0"],"strategy":"mean"}` (no `value` key — spray-json omits `None`, a known
  project pattern, not a defect).
- **Reload verification:** hard-navigated to the pipeline URL fresh, re-expanded the fillnull step
  — `col_0` still checked, strategy still `mean`, constant-value input correctly hidden for the
  non-constant strategy (screenshot `fillnull-after-reload-mean.png`). This proves the round-trip
  survives a full page reload, not just in-memory state.
- **Execution smoke test:** clicked "Preview data" on the live fillnull step against the 200-row
  wide-table source — request succeeded, grid rendered with no error (screenshot
  `fillnull-preview.png`). (This dataset's `mean` target column had no nulls, so no visible
  transform — correctness of the actual null-fill math is covered exhaustively by the backend unit
  tests reviewed above, not re-derived here.)
- **Light/dark theme parity:** toggled to light theme — editor re-renders cleanly with consistent
  token-driven colors, no dark-theme residue, no layout breakage (screenshot
  `fillnull-light-theme.png`).
- **Console check:** only 1 pre-existing, unrelated error across the whole session (`404` on
  `/api/pipelines/:id/schedule`, present before any fillnull interaction — a "no schedule set"
  lookup, not caused by this change). No new console errors introduced by fillnull interactions.
- **Cleanup:** removed the test step afterward; confirmed via `GET .../steps` that the shared eval
  pipeline is back to its original 2 steps (`select`, `cast`).

**Design.md decisions cross-checked against implementation**
- Decision 1 (single strategy per step instance, not per-column map) — `FillNullConfig` has one
  `strategy: String`, confirmed.
- Decision 2 (null = Scala `null` OR missing key) — `isNull` implementation matches exactly.
- Decision 4 (forward-fill leading-null-stays-null) — implementation and test both match.
- Decision 5 (single-pass column stat, `None` on empty -> stays null, `mode` ordered tie-break) —
  implementation matches; `computeMean`/`computeMedian`/`computeMode` all read the batch once.
- Decision 7 (identity passthrough via the true `filter|limit|sort|dedupe` arm) — confirmed by
  direct code read, not by trusting the diff comment.

### Verdict: CONFIRM

All backend and frontend gates pass fresh (not reused from the evaluator's claims). Every
acceptance criterion traces to concrete, read code and/or live-verified UI behavior. The
`inferFillNull` dispatch — the specific risk called out for this ticket — correctly joins the
identity-passthrough arm and was verified by reading the dispatch `match` directly, not inferred
from a comment. The Flyway migration is uncontended and applies cleanly against both the live dev
DB and a from-scratch embedded-Postgres test run. Frontend config PATCH round-trip was verified at
the wire level (fetched persisted server state after a full reload, not just observed a rendered
checkbox). Light/dark theme parity is clean. No scope creep, no placeholders, no divergence from
design.md's documented decisions.

### Non-blocking notes

- `FillNullConfig`'s columns checklist does not scroll/paginate for very wide schemas (30+
  columns rendered inline in this test) — this is inherited verbatim from `DedupeConfig`'s
  existing pattern, not a new issue introduced by this ticket, so not a blocker here.
- The `mean`/`median` "silently drop non-numeric values" behavior (design.md risk 1) is consistent
  with `AggregateStep.avg` but could surprise a user filling a mixed-type column with no
  visible warning in the UI — same trade-off the codebase already accepts elsewhere; not new to
  this ticket.
