## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 7 ticket acceptance criteria addressed explicitly and verified with fresh evidence (not
  taken on the executor's word):
  1. Six operations (trim/upper/lower/split/extractRegex/concat) each produce correct output;
     row count unchanged; unsupported operation fails descriptively — covered by 17 dedicated
     tests in `InProcessPipelineEngineSpec.scala`, all passing.
  2. `analyze_pipeline` types `outputColumn` as `string`, apply/infer parity for both the
     overwrite (`outputColumn == field`) and append (`outputColumn != field`) cases — 4 tests in
     `PipelineAnalyzeServiceSpec.scala`, all passing.
  3. `pipeline_steps_op_check` accepts `'stringops'`; migration applies cleanly — confirmed via a
     fresh `sbt test` run that migrates a clean DB through V70 successfully (log: "Successfully
     applied 70 migrations to schema public, now at version v70").
  4. Frontend StepCard editor with per-operation field adaptation; config PATCHes round-trip —
     verified live in the browser (see Phase 3).
  5. MCP `add_pipeline_step` documents `stringops` — confirmed in `helio-mcp/src/tools/write.ts`.
  6. Round-trip execution, analyze-schema, codec round-trip, and `PipelineStepSpec` kind-parity
     tests all present and passing.
  7. Backward compatible — `splittext` untouched (its test block is unmodified; the migration is
     purely additive to the CHECK constraint's allowed-value list).
- No AC silently reinterpreted. design.md's explicit exclusion of a `titleCase` operation is
  correctly scoped: the ticket's own Scope/Acceptance-Criteria sections enumerate exactly six
  operations (trim/upper/lower/split/extractRegex/concat); only the ticket's informal
  title/summary mentions "case" generically. This is a defensible literal-ticket read, not scope
  narrowing.
- All 27 task items in tasks.md are marked done and match the implemented state (verified by
  reading the actual diff for each, not just the checkbox).
- No scope creep — diff is contained to the files listed in files-modified.md; the wider
  `git diff main...HEAD` noise (fillnull/dedupe/unpivot/window archives) is explained and
  accurate per the note at the top of files-modified.md, confirmed against `git show --stat` on
  the actual commit.
- No regressions to existing behavior: full backend suite (1894 tests) and frontend suite (1335
  tests) pass fresh: `splittext`, other seven prior ops, and generic pipeline routes are
  unaffected.
- API contracts/schemas: `npm run check:schemas` passes clean (schema ↔ protocol parity
  confirmed); OpenSpec `specs/pipeline-string-ops-op/spec.md` present with scenarios for every
  requirement.
- Planning artifacts (design.md decisions 1-8) match the implemented behavior exactly — verified
  line-by-line against `StringOpsStep.scala`: append-vs-overwrite by name equality (Decision 2),
  null-propagates for the five single-field ops (Decision 3), concat null-as-empty-string
  (Decision 4), split out-of-bounds/negative-index → null with missing-separator/index as a
  step-level failure (Decision 5), extractRegex capturing-group requirement with per-row
  null-on-no-match (Decision 6), unsupported-operation execute-time failure naming the six valid
  values (Decision 7), and `inferStringOps` joining the append-or-replace family (Decision 8).

### Phase 2: Code Review — PASS
Issues: none.

- **Canonical code-quality compliance**: `node scripts/check-scala-quality.mjs` run fresh — clean,
  zero inline-FQN violations in any file this change touches (the only output is 64 pre-existing
  soft file-size warnings unrelated to this change). File sizes are within budget:
  `StringOpsStep.scala` 197 lines, `StringOpsConfig.tsx` 228 lines, `StringOpsConfig.test.tsx` 261
  lines (soft budget 250 for the test file only, informational, not a fail condition).
- **Design-standard mechanical rules**: `StringOpsConfig.tsx` reuses the shared `Select`/
  `TextField` components and the existing `pipeline-detail-page__compute-*` / `__select-fields-*`
  CSS class vocabulary already established by `WindowConfig.tsx`/`FillNullConfig.tsx` — no new
  ad-hoc classes or inline styles introduced.
- **DRY**: `singleFieldFn` factors the shared null-on-missing wrapper for trim/upper/lower;
  `stringOpsConfigOf`/`onStringOpsChange` mirror the established `windowConfigOf`/`onWindowChange`
  omit-unused-params pattern rather than reinventing it.
- **Readable**: clear naming throughout (`SupportedOperations`, `singleFieldFn`, `splitFn`,
  `extractRegexFn`, `concatFn`); no magic values — the six operation strings are centralized in
  `SupportedOperations` (backend) and `STRING_OPS_OPERATIONS` (frontend), single source of truth
  each side.
- **Modular**: small composable private functions per operation; config parsing, execution, and
  wire codec concerns are cleanly separated per the established `*Step.scala` pattern.
- **Type safety**: no `any`/untyped escape hatches in the new TypeScript; `StringOpsConfig` in
  `pipelineStep.ts` is a fully-typed interface with a literal-union `operation` type.
- **Security**: no new injection surface — `Pattern.quote` correctly neutralizes `separator` as a
  literal string in `split`; `extractRegex`'s user-supplied `pattern` goes through
  `Pattern.compile` inside a `Try`/catch that surfaces a descriptive `IllegalArgumentException`
  rather than leaking a raw stack trace.
- **Error handling**: step-level misconfigurations (missing separator/index, pattern without a
  capturing group, unsupported operation) fail fast at execute time before any row is processed,
  matching the established `FillNullStep`/`DateBucketStep`/`WindowStep` contract; per-row data
  conditions (out-of-bounds index, no regex match) correctly yield `null` rather than throwing.
- **Tests meaningful**: 17 execution tests + 4 analyze tests + codec/protocol/kind-parity tests
  exercise every documented behavior (each operation's happy path, null handling, config-error
  paths, row-count invariance, overwrite-vs-append) — these would catch a real regression in any
  of the six operations or the append/overwrite rule.
- **No dead code**: no unused imports or leftover TODO/FIXME in the diff.
- **No over-engineering**: no premature abstraction — the six operations are implemented as plain
  private functions dispatched via a `match`, consistent with sibling ops' complexity level.
- **Behavior-preserving**: this is a pure addition (new op, new files, additive migration,
  additive union-type/exhaustive-match arms) — no existing behavior was touched or altered.
- Fresh gate re-runs (not taken from the executor's self-report): `npm run lint` (zero-warnings,
  clean), `npm run format:check` (clean), `npm run check:schemas` (clean),
  `node scripts/check-scala-quality.mjs` (clean), backend `sbt test` (1894/1894 passed, migrations
  apply cleanly through V70), frontend `npm test` (1335/1335 passed, including 13
  `StringOpsConfig.test.tsx` tests).
- Minor note (non-blocking, see below): the commit used `git commit -n` to bypass only the
  `check:openspec` hygiene hook (flagging "complete but not archived," which is expected —
  archiving is a distinct later pipeline phase), while lint/format/schemas/scala-quality/frontend
  tests were run standalone and passed. This mirrors the accepted HEL-388 precedent and does not
  bypass any substantive code-quality gate.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh` and confirmed healthy via
`assert-phase.sh servers` before testing. Exercised live in the browser (Chromium via Playwright)
against an existing 30-column pipeline (`HEL-254 Wide Table Pipeline`, 200 rows):

- **Happy path end-to-end**: added a `String operation` step via "+ Add transformation step" →
  "String operation" appears correctly labeled with a distinct icon in the op picker (last item,
  after Fill null/impute). Editor renders Operation/Source field/Output column controls for the
  default `trim` operation.
- **Field-adaptivity** (spec.md scenario "Switching operation reveals only the relevant params"):
  switching to `split` correctly reveals Separator + Index and hides Pattern; switching to
  `concat` correctly reveals the Fields multi-select checklist (all 30 columns) + Separator and
  hides Source field/Index/Pattern — exact match to the ticket's per-operation field table.
  `extractRegex`/`trim`/`upper`/`lower` were also present in the operation dropdown (all six
  operations confirmed).
  For `concat`, selected `col_1`+`col_2`, clicked "Preview data" → the resulting column
  (`col_0_trimmed`) correctly showed the two source values concatenated (e.g. `"r0c1r0c2"`) for
  every previewed row, with all 30 original columns preserved unchanged — confirms both the
  execute-time behavior and the analyze-schema append.
- **Config PATCHes round-trip**: network log shows `POST /api/pipelines/:id/steps` (201) on add,
  followed by `PATCH /api/pipeline-steps/:id` (200) on each field edit (output-column text entry,
  operation switch) — config changes persist as expected.
- **Analyze/execute round-trip**: ran "Dry run" with the `concat` step attached → "Run status:
  succeeded", "Preview: 200 rows" — row count unchanged end-to-end through the full pipeline
  execution path, matching the row-count-invariance requirement.
- **No console errors introduced**: the only console error present throughout testing was a
  pre-existing `404` on `GET .../schedule` (expected behavior for "no schedule set", unrelated to
  this change — confirmed present on a fresh page load before any stringops interaction). A
  one-off `502` on the `run-events` SSE endpoint appeared during rapid resize/escape/navigate
  churn but did not recur on a fresh reload — not a stringops regression (this change doesn't
  touch run-events/SSE code at all).
- **Breakpoint check (768px)**: the collapsed step-card row and the expanded `stringops` editor
  (Operation/Source field/Output column controls) both render without overflow or layout breakage
  at 768px width; the standard mobile bottom-nav collapse (pre-existing, unrelated to this change)
  activates correctly.
- **Entry point**: the op is reachable from the standard "+ Add transformation step" dropdown, the
  only entry point for any pipeline op — consistent with all seven prior ops.
- **Accessible names**: all controls have proper ARIA labels (`aria-label="Operation"`,
  `"Source field"`, `"Output column"`, `"Pattern"`, `"Separator"`, `"Index"`, and per-checkbox
  labels for the concat fields list) — confirmed via the accessibility snapshot, not just visual
  inspection.
- Test step was removed after verification to leave the shared dev pipeline in its original
  2-step state; no residual test artifacts left in the repo (screenshot files taken during review
  were deleted after use).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- The `git commit -n` bypass of `check:openspec` (called out explicitly in the commit body,
  mirroring the HEL-388 precedent) is reasonable given the delivery pipeline's phase ordering, but
  if this pattern recurs across many op-expansion tickets it may be worth teaching
  `check:openspec` to distinguish "complete but not yet archived mid-delivery" from a true hygiene
  violation, so future op tickets don't need to repeat the same bypass justification.
