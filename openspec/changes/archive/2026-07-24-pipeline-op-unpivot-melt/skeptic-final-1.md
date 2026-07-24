## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Scope / diff sanity**
- This worktree's local `main` ref is stale (missing HEL-376/window, already merged upstream
  via PR #281). Confirmed via `git merge-base --is-ancestor 403fc4c8 origin/main` → `YES`, and
  `git diff origin/main...HEAD --stat` shows a clean, correctly-scoped 31-file diff touching only
  unpivot-related backend/frontend/MCP/openspec files (no window/pivot code included). The
  `git diff main...HEAD` view (with the stale local `main`) is misleadingly inflated by window's
  commit — not a real scope problem, just a stale local branch pointer.

**Backend domain step** (`backend/src/main/scala/com/helio/domain/steps/UnpivotStep.scala`)
- `UnpivotConfig(idVars, valueVars, varName, valueName)` matches ticket field order.
- `decode` is tolerant: `JsArray` extraction for `idVars`/`valueVars` (empty on absent/malformed),
  `StepCodecUtil.stringOr` defaults `varName`→`"variable"`, `valueName`→`"value"`.
- `UnpivotStep.apply`: `rows.flatMap { row => idMap ++ valueVars.map { ... idMap ++ Map(varName ->
  valueVar, valueName -> row.getOrElse(valueVar, null)) } }` — one row per (input row × valueVar),
  `idVars` via `getOrElse(name, null)` (missing → null, row still emitted), collision order
  idVars-first then varName then valueName (right-biased `Map ++`/literal `Map(...)` construction
  order) — matches design.md decisions 3-5 and spec.md's collision scenario exactly.
- Empty-`valueVars` edge case: no special-casing, inner loop has nothing to iterate → zero output
  rows per input row, exactly as documented in the code comment and covered by a dedicated test.

**Backend analyze** (`PipelineAnalyzeService.inferUnpivot`, lines 366-394)
- Fully static, no sampling: reads `idVars`/`valueVars`/`varName`/`valueName` from parsed config
  JSON only.
- Existence validation: `missing = (idVars ++ valueVars).filterNot(schemaByName.contains)` →
  real `validationError` + identity (`inputSchema`) fallback, matching `inferPivot`'s contract.
- Output schema: `idFields` (types from `inputSchema`) → `filterNot(_.name==varName) :+
  SchemaField(varName, "string")` → `filterNot(_.name==valueName) :+ SchemaField(valueName,
  valueType)`, replace-in-place collision handling identical to `inferDateBucket`'s idiom.
- `valueType`: `valueVars.map(schemaByName(_).type).distinct` → single type wins, else `"string"`
  (also degrades correctly to `"string"` when `valueVars` is empty, since `distinct.size` is 0, not 1).
- Apply/infer parity confirmed **live** (see below) — the executed row shape and the analyzed
  schema shape agreed exactly for the same config.

**Exhaustive-match wiring** — traced and confirmed present in all consumers named in design.md:
`PipelineStep.Registry` + `PipelineStepKind.Unpivot` (`PipelineStep.scala`); `domain/package.scala`
type/val aliases; `PipelineStepProtocol.scala` (`UnpivotStepResponse`, `jsonFormat6`, write/read
union arms, `fromDomain`); `PipelineStepConfigCodec.scala` (`encodeConfig`/`extractConfig` arms);
`PipelineStepRepository.rowToDomain` (`infrastructure/PipelineStepRepository.scala`);
`PipelineAnalyzeProtocol.scala` (`UnpivotAnalyzeStepResponse`, `jsonFormat6`, union arms);
`PipelineService.toAnalyzeStepResponse`. All read directly (`git diff origin/main...HEAD` per
file), no gaps found.

**Flyway migration** — `V67__add_unpivot_op.sql` re-confirmed as the correct next number:
`ls backend/src/main/resources/db/migration/ | sort -V | tail` shows V67 is the current max, no
collision with concurrent lanes. `sbt test`'s embedded-Postgres bootstrap log shows "Migrating
schema to version 67 - add unpivot op" → "Successfully applied 67 migrations... now at version
v67" — applies cleanly against the full migration chain (not just in isolation).

**Backend tests** — ran fresh, read output directly:
- Targeted suite (`InProcessPipelineEngineSpec`, `PipelineAnalyzeServiceSpec`, `PipelineStepSpec`,
  `PipelineStepConfigCodecSpec`, `PipelineStepProtocolSpec`): 233/233 passed, including all 5
  spec.md execution scenarios + the empty-valueVars edge case + all 4 spec.md analyze scenarios +
  a malformed-config case + codec round-trip + kind-parity + wire-format round-trip.
- Full `sbt test`: **1845/1845 passed**, 101 suites, 0 failures — includes the migration bootstrap
  through V67.

**Frontend**
- `npm run lint` (zero-warnings ESLint): clean, no output/errors.
- `npm run format:check` (Prettier): "All matched files use Prettier code style!"
- `npx jest UnpivotConfig`: 12/12 passed (co-located test file).
- Full `npm test`: **1305/1305 passed**, 125 suites.
- `npm run build`: succeeds, produces `dist/` bundle (only the pre-existing >500kB chunk-size
  warning, unrelated to this change).
- Wiring diff-reviewed and confirmed: `pipelineStep.ts` (4 touch points: `UnpivotConfig` wire type,
  `UnpivotStep`/`UnpivotAnalyzeStep` interfaces, both union additions), `stepNarrowing.ts`
  (`OP_TYPES` entry with a genuinely unused icon `faTableList`, `defaultConfigFor` case,
  `unpivotConfigOf` narrowing helper mirroring `pivotConfigOf`), `StepCard.tsx` render arm,
  `useStepCardState.ts` state wiring (all mirroring the `pivot`/`window` pattern exactly).
- `UnpivotConfig.tsx` reuses shared `Select`/`TextField` components and existing
  `pipeline-detail-page__aggregate-*`/`pipeline-detail-page__compute-*` CSS classes (verified
  present in `PipelineDetailPage.css`) — no new one-off UI primitive, no hardcoded style values.

**MCP** — `helio-mcp/src/tools/write.ts`'s `add_pipeline_step` description now lists `unpivot` in
the type enumeration and documents its full config shape (`idVars`/`valueVars`/`varName?`/
`valueName?`), the row-multiplication formula, and the deterministic analyze-schema contract —
read directly, matches ticket requirement (free-text `type`, no schema/enum change needed).

**Live UI verification** (dev servers started via `scripts/concertino/start-servers.sh`,
`assert-phase.sh servers` → `PASS`; browser navigated to an existing 30-column-wide pipeline,
"HEL-254 Wide Table Pipeline"):
- Added an `unpivot` step via the picker; editor rendered with Id-fields / Value-fields
  multi-select rows and Variable/Value-column text inputs, pre-filled with `"variable"`/`"value"`
  defaults — screenshot: `unpivot-editor-dark.png`.
- Added an id field and a value field, renamed `varName`→`"metric"` and `valueName`→`"reading"`;
  network tab showed a `PATCH /api/pipeline-steps/:id` → `200`. Reloaded the page and re-fetched
  `GET /api/pipelines/:id/steps` directly — the persisted config exactly matched what was typed
  (`{"idVars":["col_0"],"valueVars":["col_0"],"varName":"metric","valueName":"reading"}`),
  confirming a real PATCH round-trip, not just optimistic local state.
- Fetched `GET /api/pipelines/:id/analyze` for the same step — `outputSchema` was exactly
  `[col_0:string, metric:string, reading:string]`, matching the design's apply/infer parity
  contract for this config.
- Ran **Dry run** on the full pipeline (200 input rows through select→cast→unpivot) and opened the
  preview grid: 200 output rows (`idVars=[col_0]`, `valueVars=[col_0]` → 1 valueVar × 200 rows),
  each row showing `col_0` unchanged, `metric="col_0"` (the source column name), `reading` equal to
  the same cell value as `col_0` — this is exactly correct unpivot semantics for a self-referential
  valueVar and confirms live execution (not just unit tests) produces spec-correct output.
- Screenshot: `unpivot-preview-data-dark.png` shows the actual data grid with `col_0`/`metric`/
  `reading` columns and `r0c0`/`col_0`/`r0c0`-shaped rows.
- Toggled to light theme and re-expanded the same editor — screenshot: `unpivot-editor-light.png`.
  Consistent styling, correct contrast, no dark-mode-only artifacts, matches sibling
  aggregate/pivot/compute step editors' visual language (shared CSS classes, not reinvented).
- Removed the test step and confirmed via a direct `GET /steps` fetch that the pipeline was
  restored to its original 2-step (`select`, `cast`) state, leaving the shared dev DB clean.
- Console errors observed (`.../schedule` 404, `.../run-events` 502) are pre-existing/unrelated —
  the schedule 404 fires on page load before any interaction with unpivot, and the run-events 502
  is an SSE teardown artifact from removing a step, not present in either `PivotConfig`/`WindowConfig`
  siblings' behavior differently than this op.

**Backward compatibility** — diff is purely additive (new file, new registry/union arms, one
extended CHECK constraint); no existing op's behavior, wire shape, or schema changed. `sbt test`'s
full green run (including all pre-existing op suites) corroborates no regression.

### Verdict: CONFIRM

### Non-blocking notes
- The dev-server processes on ports 5553/8460 were left running after this review (a `pkill`
  attempt didn't match the process pattern); the orchestrator's teardown phase should reap them
  along with the worktree — not fixed here since `cleanup.sh` is out of scope for this agent.
