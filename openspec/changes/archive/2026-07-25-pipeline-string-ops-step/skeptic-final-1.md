## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ground truth diff scope.** `git show 90a6d30e --stat` — 31 files, 1728
   insertions, 10 deletions. Confirmed the commit touches only stringops-related
   backend/frontend/MCP/openspec files; no `SplitTextStep`/`splittext` file
   appears anywhere in the commit's file list. `files-modified.md`'s note about
   `git diff main...HEAD` pulling in unrelated concurrent-lane files is accurate
   and independently confirmed against the actual commit's own `--stat` (not
   just re-asserted).

2. **All six operations implemented correctly** — read
   `backend/src/main/scala/com/helio/domain/steps/StringOpsStep.scala` in full.
   `trim`/`upper`/`lower` via `singleFieldFn`; `split` via `Pattern.quote`d
   literal split + bounds-checked index; `extractRegex` via `Pattern.compile` +
   capturing-group validation + `matcher.group(1)`; `concat` via
   null-as-empty-string join. Unsupported operation throws
   `IllegalArgumentException` naming the six valid values. Matches ticket Scope
   and design.md Decisions 2-7 line-for-line.

3. **Backend test coverage — fresh run, not taken on faith.**
   `sbt "testOnly com.helio.domain.InProcessPipelineEngineSpec
   com.helio.domain.PipelineAnalyzeServiceSpec com.helio.domain.PipelineStepSpec
   com.helio.api.protocols.PipelineStepConfigCodecSpec
   com.helio.api.protocols.PipelineStepProtocolSpec"` → 282/282 passed. Read all
   21 `stringops:` test cases in `InProcessPipelineEngineSpec.scala` (lines
   1309-1451) — each operation's happy path, out-of-bounds/negative split
   index → null, missing separator/index → execute-time failure, no-capturing-
   group/no-match regex, concat null-field → empty string (not null), null
   source → null, overwrite-vs-append, row-count invariance, unsupported op —
   all exercise real assertions against `result`, not tautologies.

4. **apply/infer (analyze) parity for both overwrite and append — verified in
   code and via live network probe.**
   `PipelineAnalyzeService.inferStringOps` (lines 397-412): `inputSchema.filterNot(_.name
   == outputColumn) :+ SchemaField(outputColumn, "string")` — the same
   collision-safe `datebucket`/`window` shape. `PipelineAnalyzeServiceSpec.scala`
   (lines 643-674) has 4 dedicated tests: overwrite (no duplicate), append
   (new field), collision-rename (replaces a different existing field), and
   malformed-config → identity schema + validationError. Independently
   confirmed live: added a `stringops`/`trim` step with `outputColumn` distinct
   from `field` against the HEL-254 Wide Table pipeline (30 columns), then
   fetched `GET /api/pipelines/:id/analyze` directly via `browser_evaluate` —
   `outputSchema` shows the original 30 columns unchanged plus the new
   `col1_trimmed` column typed `"string"` appended at the end. This is the
   append case confirmed end-to-end, not just asserted by the evaluator.

5. **Full backend suite, fresh.** `sbt test` from a clean run: `1894/1894`
   passed, migration log shows `Successfully applied 70 migrations to schema
   "public", now at version v70`. Matches the evaluator's claimed numbers
   exactly — reproduced independently, not copy-pasted.

6. **Flyway migration is the sole V70 file and additive.**
   `ls backend/src/main/resources/db/migration/` confirms
   `V70__add_stringops_op.sql` is the only V70 file. Read the file: drop/re-add
   `pipeline_steps_op_check`, new list is the old 19-value list plus
   `'stringops'` appended at the end — no existing value removed or reordered.
   The full `sbt test` run above migrates a clean embedded-Postgres DB through
   V70 with no errors, which is the strongest form of "applies cleanly"
   evidence (a real migration run, not a syntax read).

7. **Frontend — full suite, lint, format, build, all fresh.**
   `npm test` → 1335/1335 passed (128 suites), including
   `npm test -- --testPathPatterns=StringOpsConfig` → 13/13 passed standalone.
   `npm run lint` → clean (zero-warnings policy). `npm run format:check` →
   clean. `npm run build` → succeeds, PWA precache generated. `node
   scripts/check-scala-quality.mjs` → clean (0 violations in changed files; the
   64 warnings are pre-existing soft file-size notes on unrelated files).
   `node scripts/check-schema-drift.mjs` → clean.

8. **Live browser verification of the StepCard editor — genuinely exercised, not
   just rendered.** Started servers via `scripts/concertino/start-servers.sh`,
   confirmed healthy via `assert-phase.sh servers` (PASS). Opened the HEL-254
   Wide Table Pipeline (30 columns, 200 rows), added a "String operation" step
   via the "+ Add transformation step" menu (all six operations present in the
   op picker: trim/upper/lower/split/extractRegex/concat).
   - **Field-adaptivity**: default `trim` shows Operation/Source field/Output
     column. Switching to `concat` correctly reveals a Fields checklist (all 30
     columns as checkboxes) + Separator, and hides Source field/Index/Pattern —
     screenshots taken and inspected in both dark and light theme.
   - **PATCH round-trip — verified via direct API probe, not just network-tab
     inspection.** Selected `col_1` as Source field, typed `col1_trimmed` as
     Output column. `browser_network_requests` showed `POST .../steps` (201)
     then two `PATCH /api/pipeline-steps/:id` (200) calls. To confirm this was
     a genuine round-trip (not an optimistic UI update that silently failed
     server-side), I issued a fresh `GET /api/pipelines/:id/steps` via
     `browser_evaluate` (bypassing any client cache) and read the persisted
     JSON: `{"config":{"field":"col_1","operation":"trim","outputColumn":"col1_trimmed"},...}`
     — the server genuinely stored the edited config.
   - **Light/dark parity**: toggled theme, re-screenshotted the concat editor —
     tokens, borders, checkbox styling, and layout are consistent between
     themes; no hardcoded-color artifacts.
   - **No new console errors**: only the pre-existing `404` on
     `.../schedule` (documented, unrelated — confirmed present before any
     stringops interaction).
   - Removed the test step afterward; pipeline confirmed back at "2 steps".
     Deleted the three screenshot PNGs I took at the repo root (known
     Playwright-session hazard) so no stray artifacts remain — `git status
     --short` confirms clean.

9. **MCP `add_pipeline_step` documents `stringops`.** Read
   `helio-mcp/src/tools/write.ts` lines 152-213 — the tool description lists
   `stringops` in the `type` enumeration and documents its full config shape
   (operation/field/outputColumn/pattern/separator/index/fields), including the
   overwrite-vs-append rule and null-handling per operation, matching the
   implementation.

10. **`splittext` genuinely untouched.** Confirmed twice: (a) `git show
    90a6d30e --stat` shows no `SplitTextStep`/splittext-named file in the
    commit; (b) the full `sbt test` run (1894/1894) includes the pre-existing
    `splittext:` test block in `InProcessPipelineEngineSpec.scala`, unmodified
    and passing, proving no regression.

11. **No inline fully-qualified names.** `grep -n
    "com\.helio\.\|scala\.util\."` against `StringOpsStep.scala` and
    `StringOpsConfig.tsx` found only the file's own top-of-file `import`
    statements — no inline FQN usage in the body, per CONTRIBUTING.md.

12. **DESIGN.md frontend conventions.** `StringOpsConfig.tsx` reuses the shared
    `Select`/`TextField` components (`../../../shared/ui/index`) and the
    established `pipeline-detail-page__compute-*` /
    `pipeline-detail-page__select-fields-*` class vocabulary already used by
    `WindowConfig.tsx`/`FillNullConfig.tsx` — no new ad-hoc classes, no inline
    styles, no hardcoded color/spacing values. Verified live in the browser
    (both themes) that this renders identically in visual weight/spacing to
    sibling step-card editors (Select fields, Cast type).

13. **Pre-commit hook bypass is legitimate — reproduced the exact failure, not
    just trusted the commit message's claim.** `.husky/pre-commit` runs
    `lint`, `format:check`, `check:schemas`, `check:openspec`,
    `check:scala-quality`, `test` in sequence (`set -e`). Ran `node
    scripts/check-openspec-hygiene.mjs` fresh — it fails with exactly one
    issue: `change "pipeline-string-ops-step" is complete (27/27) but not
    archived`. I independently reproduced every other check in this same
    review (lint, format:check, check:schemas, check:scala-quality, full
    backend+frontend test suites, build) and all pass cleanly standalone. This
    matches the commit body's stated justification precisely and mirrors the
    accepted HEL-388 precedent (commit c027d5dc) — the bypass is scoped
    exactly as claimed, not a cover for a real failure.

14. **Wiring completeness for exhaustive-match consumers.** Grepped
    `stringops|StringOps` across `domain/package.scala`,
    `infrastructure/PipelineStepRepository.scala`,
    `services/PipelineService.scala`, `domain/PipelineStep.scala`,
    `domain/PipelineAnalyzeService.scala` — all five sites have a `StringOps`
    arm. Frontend: `pipelineStep.ts` (9 `StringOps`-named edit sites, more than
    the ticket's undercounted "4" but flagged and self-corrected at the design
    gate per `skeptic-design-1.md`), `stepNarrowing.ts` (`OP_TYPES` entry +
    `faFont` icon + `defaultConfigFor` case + `stringOpsConfigOf`),
    `StepCard.tsx` (renders `StringOpsConfig` conditionally),
    `useStepCardState.ts` (`stringOpsConfig` state + `onStringOpsChange` with
    correct per-operation param-omission logic, mirroring `onWindowChange`).

### Verdict: CONFIRM

### Non-blocking notes
- `pipelineStep.ts`'s per-op edit-site count in `files-modified.md` ("3
  union-type additions, 8 edit sites total") doesn't exactly match my own
  grep count (9 `StringOps`-named occurrences), but this is cosmetic
  bookkeeping in a report file, not a functional gap — every actual consumer
  site (config interface, Step interface, both union members, AnalyzeStep
  interface, AnalyzeStep union member) is present and type-checks (frontend
  build succeeds).
- The screenshot PNGs I generated during live verification were deleted from
  the repo root after use, consistent with the known
  parallel-Playwright-session stray-artifact hazard noted in project memory.
