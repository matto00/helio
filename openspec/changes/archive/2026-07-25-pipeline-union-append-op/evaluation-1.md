## Evaluation Report — Cycle 1

Commit under review: `5ea619ee9753c2edfe277994f80c6ffb52de737a` (HEL-384, "Pipeline op: union / append").

### Phase 1: Spec Review — PASS

Issues: none.

- All 8 acceptance criteria in ticket.md are addressed explicitly, with no reinterpretation:
  - `union` stacks rows, byPosition and byName both implemented per design.md Decisions 2-3, other
    source resolved via `ctx.dataSourceRepo.findByIdInternal` + `ctx.loadSource` (mirrors JoinStep).
  - Missing/invalid `otherDataSourceId` fails descriptively at execute time
    (`IllegalArgumentException("DataSource not found for union: " + otherDsId)`).
  - `analyze_pipeline` passthrough is a dedicated dispatch case (not the unknown-op fallback) —
    verified live (Phase 3) that no `validationError` is emitted.
  - Flyway migration extends `pipeline_steps_op_check` with `'union'`.
  - Frontend `UnionConfig.tsx` editor renders, PATCHes round-trip.
  - MCP `add_pipeline_step` documents `union` + config shape.
  - Tests present in all seven places tasks.md calls for (`InProcessPipelineEngineSpec`,
    `PipelineAnalyzeServiceSpec`, config codec, `PipelineStepSpec`, `UnionConfig.test.tsx`,
    `stepNarrowing.test.ts`, `PipelineStepRoutesSpec` — including the PATCH-cross-user test with no
    join equivalent).
  - Additive-only; existing migrations/tests unaffected (V71 appended cleanly onto V70's op list).
- The design-gate-mandated correction (symmetric `findByIdOwned` ACL check for
  `UnionConfig.otherDataSourceId` in both `addStep`/`updateStep`) is fully implemented — see Phase 3
  live verification below.
- All 45 tasks.md items are checked and match what's actually in the diff (verified by reading the
  diff directly, not trusting the checkboxes).
- No scope creep: the diff for commit `5ea619ee` touches exactly the files listed in
  files-modified.md, no unrelated changes.
- No regressions: `join`'s existing behavior, `OP_TYPES` ordering, and other ops' passthrough cases
  are untouched by this diff.
- API contract: `schemas/` ↔ `JsonProtocols` parity holds (`npm run check:schemas` passes fresh — 18
  protocol files checked, 7 panel-type-enum surfaces checked).
- Planning artifacts (design.md, proposal.md, spec.md) accurately reflect the final implementation —
  cross-checked every Decision (1-9) against the actual code and found no drift.

### Phase 2: Code Review — PASS

Issues: none blocking.

- **Canonical code-quality compliance**: no inline FQNs in any new/touched file (`grep` for
  `com\.helio\.|spray\.json\.|java\.util\.UUID|org\.apache\.pekko\.` outside import blocks in
  `UnionStep.scala` and `PipelineService.scala` returns nothing); `npm run check:scala-quality`
  (mechanical FQN + file-size checker) passes clean with 0 union-specific warnings. ACL triad
  (CONTRIBUTING.md "ACL triad for repository reads") correctly applied: `findByIdOwned` at the
  addStep/updateStep pre-flight (mutation path), `findByIdInternal` at runtime `evaluate` (privileged
  internal caller, with an inline comment at `UnionStep.scala:52-57` explaining why the ACL bypass is
  safe — pipeline ACL is the gate, mirroring `JoinStep`).
- **DESIGN.md mechanical rules** (UI): `UnionConfig.tsx` reuses the shared `Select` component
  (`frontend/src/shared/ui/index`) and existing `PipelineDetailPage.css` classes (compute-field,
  filter-combinator, aggregate-section-description) — no new CSS, no hardcoded colors/px, no ad-hoc
  button style. Interactive elements have accessible names (`aria-label="Other data source"`,
  `aria-pressed` on the mode toggle buttons) — confirmed live in Phase 3.
- **DRY**: no duplication; the ACL-check pattern in `PipelineService.addStep`/`updateStep` is a
  direct structural mirror of the existing `joinCheckF`, chained via `flatMap` rather than
  re-implemented.
- **Readable**: naming and doc comments are clear and consistent (`unionCheckF`, `aclCheckF`,
  `unionByName`); design.md Decision references are cited inline at each non-obvious choice.
- **Modular**: `UnionStep.scala` is self-contained (126 lines, well under the 250-line soft budget);
  `unionByName` is factored out as a private helper.
- **Type safety**: `UnionConfig` is a typed case class throughout; no `any`/`Any` escape beyond the
  engine's pre-existing `Map[String, Any]` row representation (documented, not new).
- **Security**: the cross-tenant ACL gap called out by the ticket's "Correction" section is closed —
  verified live end-to-end in Phase 3, not just read in code.
- **Error handling**: descriptive `IllegalArgumentException`s for missing/unresolvable source and
  unsupported mode; ACL failures surface as `404 Not Found` (existence-not-leaked semantics per
  CONTRIBUTING.md).
- **Tests meaningful**: execution round-trip tests for both modes (including the "byName with
  identical columns" edge case), both error paths, the full ACL 404/201/404-on-PATCH triad, codec
  round-trip + tolerant-decode, analyze passthrough, kind-parity. These would catch a real regression
  in any of the above.
- **No dead code**: no unused imports, no leftover TODO/FIXME in the new files.
- **No over-engineering**: `UnionConfig` mirrors `JoinConfig`'s shape exactly; no premature
  abstraction.
- **Behavior-preserving**: this is additive-only (new op), not a refactor — no existing behavior
  changed. Confirmed no drive-by changes outside the union surface.
- **Minor, non-blocking**: `backend/src/main/scala/com/helio/services/PipelineService.scala` is now
  497 lines (was 463 before this commit), over CONTRIBUTING.md's "if a file you're editing crosses
  ~400 lines, propose a split in the PR description" guidance. This file has been growing across
  every op-expansion ticket in this batch (dedupe/fillnull/stringops/union) without a split being
  proposed; `check:scala-quality` correctly flags it as informational-only, so this is not a gate
  failure, but it's worth a spinoff ticket to decompose `PipelineService`'s per-op ACL/analyze-arm
  dispatch before the next op lands.

### Phase 3: UI Review — PASS

Servers started via `scripts/concertino/start-servers.sh` + `assert-phase.sh servers` — both reported
healthy (`READY backend=http://localhost:8464/health`, `READY frontend=http://localhost:5557`, `PASS
servers`).

**Live ACL verification (fresh evidence, not trusted from executor report):**

1. Registered a second user (`evaluser_hel384@helio.dev`) via `POST /api/auth/register`. Created
   `A-source`/`A-source2`/`A-source3` (owned by user A) and `B-source` (owned by user B). Created
   pipeline `union-eval-pipeline` (owner A, base source `A-source`).
   - `POST /api/pipelines/:id/steps` with `type: "union"`, `otherDataSourceId = B-source` (cross-user)
     → **404** `{"message":"Data source not found: <B-source-id>"}`. ✓
   - Same request with `otherDataSourceId = A-source2` (own) → **201 Created**, typed
     `UnionStepResponse` returned. ✓
   - `PATCH /api/pipeline-steps/:id` on that step, `otherDataSourceId = B-source` (cross-user) →
     **404**. Re-fetched `GET /api/pipelines/:id/steps` and confirmed the persisted config's
     `otherDataSourceId` is still the original own-source id (unchanged). ✓

2. **Execution correctness**, run via `POST /api/pipelines/:id/run`:
   - `byPosition`: current rows `[{a:"1",b:"2"}]` + other source `[{a:"3",b:"4"}]` → output
     `[{a:"1",b:"2"},{a:"3",b:"4"}]`, exactly the spec's byPosition scenario. ✓
   - `byName`: current rows `[{a:"1",b:"2"}]` (cols a,b) + other source `[{a:"5",c:"6"}]` (cols a,c),
     patched via the live UI mode toggle → output
     `[{a:"1",b:"2",c:null},{a:"5",c:"6",b:null}]`, exactly the spec's null-backfill scenario. ✓

3. **Analyze passthrough**: `GET /api/pipelines/:id/analyze` on the union step returns
   `outputSchema == inputSchema == [{a,string},{b,string}]` and the step object carries no
   `validationError` field. ✓

4. **Migration**: `sbt test`'s Flyway bootstrap applied all 71 migrations cleanly, ending "Migrating
   schema public to version 71 - add union op" / "Successfully applied 71 migrations ... now at
   version v71". `ls backend/src/main/resources/db/migration/ | sort` confirms V71 is the unique max,
   no collision. `V71__add_union_op.sql`'s accepted-op list is `V70__add_stringops_op.sql`'s full list
   plus `'union'` appended, byte-for-byte otherwise. ✓

5. **Frontend**: navigated to `/pipelines/<id>` in a real browser session (logged in as the seed dev
   user). The step card renders "Union / append rows" (not a placeholder). Expanding it shows the
   other-source `Select` (populated, showing `A-source3`) and the `BY POSITION`/`BY NAME`
   `aria-pressed` toggle with mode-specific description text. Clicking `BY POSITION` PATCHed the
   step's config live (confirmed via `GET /api/pipelines/:id/steps` immediately after — config updated
   server-side). Opening "+ Add transformation step" shows "Union / append rows" in the picker menu
   (17th entry) with no "Join" entry present, matching design.md Decision 7 / Decision 9's contrast
   with `join`'s continued exclusion. MCP `add_pipeline_step`'s description string documents `union` +
   its config shape (read directly in the diff, `helio-mcp/src/tools/write.ts`).

6. **Console/network**: one pre-existing 404 on `GET /api/pipelines/:id/schedule` (no schedule set for
   this test pipeline) — handled gracefully by the UI ("No schedule set" renders, no blank screen);
   this is unrelated to the union feature (same 404 pattern exists on every pipeline without a
   schedule) and not introduced by this change.

7. **Breakpoints/keyboard**: not separately re-tested at each of 1440/1100/768/0 — `UnionConfig.tsx`
   reuses the same `PipelineDetailPage.css` layout classes already used by every other step-config
   editor (e.g. `DedupeConfig`, `StringOpsConfig`) on the same card, which are already covered by the
   page's existing responsive rules; no union-specific layout was introduced. Deferred to the
   skeptic's judgment-based review for any subjective breakage.

### Gate re-run (fresh, independent of executor's claimed numbers)

| Gate | Executor claimed | Independently re-run | Result |
| --- | --- | --- | --- |
| `sbt test` | 1907 tests, 0 failed | 1907 tests, 0 failed | Match |
| `npm test` (frontend) | 1347 tests, 0 failed | 1347 tests, 0 failed (130 suites) | Match |
| `npm run lint` | pass | pass (0 warnings) | Match |
| `npm run format:check` | pass | pass | Match |
| `npm run check:schemas` | pass | pass | Match |
| `npm run check:scala-quality` | pass (clean) | pass — clean, 64 pre-existing soft warnings, none union-related | Match |
| `npm run check:openspec` | fails ("complete but not archived") — cited as the sole `-n` bypass reason | fails, identical message | Match |

**Hook bypass scoping**: confirmed appropriately scoped. `check:openspec` is the only failing gate
(archival is a later pipeline phase, not part of this commit); every other pre-commit-equivalent check
(lint, format, schemas, scala-quality, both test suites) was independently re-run above and passes
without needing the bypass. This matches the same precedent already used for the two prior sibling
commits in this batch (HEL-389 `90a6d30e`, HEL-388 `c027d5dc`), consistent with CONTRIBUTING.md's "the
only acceptable use is an environmental hook breakage ... called out explicitly."

### Overall: PASS

### Non-blocking Suggestions

- `PipelineService.scala` has grown to 497 lines across this and the prior op-expansion tickets in the
  same batch — worth a spinoff ticket to decompose the per-op ACL-check / analyze-arm dispatch into a
  smaller structure before the next pipeline op lands (CONTRIBUTING.md's ~400-line "propose a split"
  threshold has been exceeded without a split proposal in this or the prior tickets).
