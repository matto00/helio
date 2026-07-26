## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL

Issues:
1. **`openspec/specs/mcp-pipeline-shape-tools/spec.md` was not updated, and no spec delta for that
   capability was created, even though this change edits normative content it governs.** That spec's
   "list_pipeline_shapes exposes the shape catalog" requirement states: "Its description SHALL name
   every shape id registered on `main` ... and note that `outputContract.fields` is currently always
   empty (descriptive `rowCount`/`description` carry the real signal — do not treat an empty `fields`
   array as an error)." The shipped diff removes exactly that note from the tool description
   (`helio-mcp/src/tools/read.ts`, per the diff: `"and outputContract (rowCount + description; the
   rowCount/description text carries the real signal about the shape's output)."` — no `fields` mention).
   The canonical spec's SHALL clause is therefore false against the shipped code, and the proposal's
   "Modified Capabilities" section only lists `pipeline-shape-registry`, omitting
   `mcp-pipeline-shape-tools` entirely. The ticket's own briefing warned explicitly about this class of
   drift ("the capability spec, and any MCP/frontend type must all move together").
2. **Task 5.1 (marked `[x]` done) was not fully executed for one of its four explicitly named files.**
   `helio-mcp/src/context.ts:74-76` still has a doc comment reading: `` `fields` is dropped (always `[]`
   today, per HEL-402); `outputRowCount` flattens `RowCountContract` to a string.`` — this sentence
   described a *choice* to omit an existing-but-always-empty field when flattening the catalog into the
   workspace-context snapshot type. Post-deletion, there is no `fields` member left to "drop" — the
   comment is now stale/misleading. `context.ts` is one of the four files task 5.1 names explicitly
   (`helioApi.ts`, `types.ts`, `context.ts`, `tools/read.ts`), and the change's own design-gate skeptic
   (`skeptic-design-1.md`, finding 4) explicitly flagged `context.ts:75-76` as needing "a comment edit
   only" before implementation began — the finding was not applied.

Both issues are documentation/spec-currency only (no runtime behavior, wire format, or test assertion is
affected) but are concrete, actionable violations of "planning artifacts reflect the final implemented
behavior" and "all task items marked done and matching what was implemented."

- [x] All ticket acceptance criteria addressed explicitly — `OutputFieldContract` removed, `OutputContract`
  is `rowCount` + `description`, all five shapes updated, catalog/schema/spec agree, no wire-level
  consumer references `fields` (verified live via `GET /api/pipeline-shapes` — see Phase 3).
- [x] No AC silently reinterpreted.
- [ ] All task items marked done and matching what was implemented — task 5.1 incomplete for `context.ts`
  (see issue 2).
- [x] No scope creep — every diff hunk is a pure subtraction or a construction/fixture edit dropping the
  removed argument; no shape's `expand`/validation logic touched.
- [x] No regressions to existing behavior — full backend (`sbt test`, 2030/2030) and frontend
  (`npm test`, 1423/1423) suites pass unchanged in behavior; only fixture/assertion edits, no new/removed
  test cases beyond the `fields`-specific ones.
- [x] API contracts/schemas updated together — `schemas/pipeline-shape-catalog.schema.json`,
  `PipelineShapeProtocol.scala`, and `openspec/specs/pipeline-shape-registry/spec.md`'s change-delta all
  move together; schema-drift check (`node scripts/check-schema-drift.mjs`) passes.
- [ ] Planning artifacts reflect the final implemented behavior — see issue 1 (`mcp-pipeline-shape-tools`
  spec left stale).

### Phase 2: Code Review — PASS

- **Canonical code-quality compliance**: `npm run check:scala-quality` clean (0 inline-FQN violations;
  only pre-existing soft file-size warnings, none in touched files). `sbt compile` clean, no warnings.
- **DRY**: no duplication introduced; deletion only.
- **Readable**: updated scaladoc/comments in `OutputContract.scala`, `PassthroughShape.scala` accurately
  explain the removal and its rationale (except the one stale `context.ts` comment noted in Phase 1).
- **Modular**: unaffected — no structural changes beyond the field removal.
- **Type safety**: `OutputContractResponse`/`OutputContract`/`OutputContract` (frontend) all consistently
  narrowed together; `helio-mcp` `npm run typecheck` (after `npm install`, since node_modules wasn't
  present) passes clean with zero errors.
- **Security**: N/A — no new input surface.
- **Error handling**: N/A — no behavior change.
- **Tests meaningful**: dropped assertions were exactly `outputContract.fields shouldBe empty` /
  `fields: []` fixture entries — the removed field's own emptiness check, correctly dropped since the
  field no longer exists; all other assertions (rowCount, description, wire-format, catalog identity)
  untouched.
- **No dead code**: no unused imports (`DataFieldType` import correctly dropped from both
  `OutputContract.scala` and `PipelineShapeProtocol.scala`); no leftover TODO/FIXME. One stale doc comment
  remains (`context.ts`, cited above under Phase 1/task 5.1) — flagged there rather than duplicated.
- **No over-engineering**: pure subtraction, no premature abstraction introduced.
- **Behavior-preserving**: confirmed — `jsonFormat3`→`jsonFormat2`, `outputContract.rowCount`/
  `description` values are byte-identical to before across all five shapes; live catalog response spot-
  checked (see Phase 3) shows only `fields` removed, nothing else changed.

### Phase 3: UI Review — PASS

Servers started via `scripts/concertino/start-servers.sh` (DEV_PORT 5796 / BACKEND_PORT 8703);
`assert-phase.sh servers` → PASS.

- Happy path: logged in, opened `/pipelines/555f4bae-...` ("Profit (migrated)"), clicked "Start from a
  shape" → `ShapePickerModal` opened and rendered all 5 registered shapes (Passthrough, Pivot / matrix,
  Single row, Time series, Top N) with correct labels/descriptions.
- Live wire check: `GET /api/pipeline-shapes` (authenticated, via curl) returns `outputContract` objects
  containing only `rowCount` + `description` — no `fields` key on any of the 5 entries — matching the
  updated schema/protocol.
- No console errors during the flow (`browser_console_messages` level=error → 0 messages).
- Network: two `GET /api/pipeline-shapes` calls both `200 OK`.
- Breakpoint spot-check at 768px: modal renders correctly, no layout breakage.
- This ticket has no new user-facing flow per the task brief; the above confirms the touched
  shape-picker/instantiate surface is unaffected, as expected for a behavior-preserving deletion.

### Overall: FAIL

### Change Requests
1. Add an `openspec/changes/remove-output-field-contract/specs/mcp-pipeline-shape-tools/spec.md` delta
   (and add `mcp-pipeline-shape-tools` to proposal.md's "Modified Capabilities") that updates the
   `list_pipeline_shapes` requirement's SHALL clause to drop the "note that `outputContract.fields` is
   currently always empty" language, matching the tool description actually shipped in
   `helio-mcp/src/tools/read.ts`.
2. Update the stale doc comment at `helio-mcp/src/context.ts:74-76` — remove `` `fields` is dropped
   (always `[]` today, per HEL-402); `` (there is no `fields` member left to drop) — mirror the wording
   already used in `helioApi.ts`/`types.ts`/`tools/read.ts`'s updated comments in this same diff.

### Non-blocking Suggestions
- None beyond the above.
