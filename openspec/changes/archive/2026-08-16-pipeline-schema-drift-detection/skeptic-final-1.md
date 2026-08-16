## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (not taken from evaluation-1.md):**
- `git log -1` on the worktree: HEAD is `bdec2540 HEL-462 Add pipeline schema-drift detection (baseline capture + analyze-time diff)`, matching the orchestrator's brief. `git status --short` shows only workflow artifacts dirty (`workflow-state.md`, `evaluation-1.md`), no code drift since the commit.
- `git diff main...HEAD --name-only` — 21 files touched, exactly matching `files-modified.md` (10 code/schema/migration files + tests + planning artifacts). No scope creep.

**Migration-number collision (explicitly my responsibility this gate):**
- `git fetch origin main` + `git ls-tree origin/main -- backend/src/main/resources/db/migration/` → highest is still `V84__pipeline_run_assertions.sql`. No `V85` on `origin/main`. Worktree has exactly one `V85__pipeline_last_source_schema.sql`. No collision, no renumber needed.

**Acceptance criteria traced to real code/tests:**
- AC1 (nullable JSONB column, populated on each successful run) — `V85__pipeline_last_source_schema.sql`: `ALTER TABLE pipelines ADD COLUMN last_source_schema JSONB;`. `PipelineRunService.onUnblockedRunSuccess` (services/PipelineRunService.scala:552-568) resolves the source schema via the shared `deriveSourceSchema` helper and writes it through `pipelineRepo.updateLastSourceSchema`, wrapped in `.recoverWith`. Verified with `PipelineRunServiceSpec`'s new HEL-462 block: persists on real success, skipped on dry run, skipped on blocked run, overwritten on a subsequent run (real embedded-Postgres integration tests, not mocks) — all pass (see gate re-run below).
- AC2 (`sourceSchemaDrift` optional, absent when no baseline/no drift) — `PipelineService.analyze` (services/PipelineService.scala:203-233) fetches baseline via `findLastSourceSchema`, tolerant-parses it, computes `PipelineSchemaDrift.diff`, sets the field. `PipelineAnalyzeRoutesSpec`'s new "omit sourceSchemaDrift entirely from the serialized JSON when None" test asserts `json should not include "sourceSchemaDrift"` — a real serialization check, not an assumption. Route-level test also confirms omission when no baseline exists.
- AC3 (ScalaTest proves (a) no drift on first run, (b) removed column, (c) type change) — `PipelineSchemaDriftSpec` has all three as literally-labeled tests with real value assertions (e.g. `result.get.removedColumns shouldBe Vector(field("created_at", "string"))`), plus reordered/added/duplicate-name/empty edge cases. `PipelineAnalyzeRoutesSpec` re-proves (a)/(b)/(c) at the HTTP-route level with a real Pekko route + embedded Postgres.
- AC4 (schema updated + validated) — `schemas/pipeline-analyze-response.schema.json` gained `SourceSchemaDrift`/`TypeChangedColumn` `$defs`, reusing the existing `SchemaField` `$def`; two dedicated tests validate the serialized response against the schema (present and absent cases), both pass. `npm run check:schemas` (re-run by me) → "schemas in sync with JsonProtocols (60 checked across 45 protocol files)".
- AC5 (additive/backward-compatible, `sbt test` green) — verified below.

**Design D1-D6 traced to implementation:**
- D1 (shared derivation) — `PipelineAnalyzeService.deriveSourceSchema` (domain/PipelineAnalyzeService.scala) is used by both `PipelineService.analyze` and `PipelineRunService.onUnblockedRunSuccess`; I diffed the analyze-path change against `main` and confirmed it's a verbatim extraction of the pre-existing inline expression, no logic change.
- D2 (column kept off `*`/`PipelineRow`/domain model) — confirmed by reading `PipelinesTable`: `lastSourceSchema` is a table-local `def`, absent from the `*` projection (still the same 11-field tuple) and from `PipelineRow`. `updateLastSourceSchema`/`findLastSourceSchema` are targeted-projection methods mirroring `updateLastRun`'s exact `ctx.withUserContext` + `r.ownerId === ownerUuid` shape (infrastructure/PipelineRepository.scala:335-364).
- D3 (pure diff object) — `PipelineSchemaDrift.diff` matches the documented semantics exactly (None-baseline → None; order-insensitive equality → None; last-wins on duplicate names).
- D4 (best-effort persist hook, dry runs excluded) — confirmed: `onDryRunSuccess` never calls `onUnblockedRunSuccess`; the baseline write is wrapped in `.recoverWith` returning `Future.successful(())`.
- D5 (drift computed in `analyze` only) — `analyzeProposal` untouched (grepped; only comment/doc references to the name, no wiring changes).
- D6 (wire shape) — `SourceSchemaDriftResponse`/`TypeChangedColumnResponse` match the schema `$defs` field-for-field; `sourceSchemaDrift` is optional, not in `required`.

**Gates re-run independently by me (not trusted from evaluation-1.md):**
- `cd backend && sbt -batch "testOnly com.helio.domain.PipelineSchemaDriftSpec com.helio.api.routes.PipelineAnalyzeRoutesSpec com.helio.services.PipelineRunServiceSpec"` → 38/38 passed, embedded Postgres migrated cleanly to v85.
- `cd backend && sbt -batch test` (full suite) → **3060/3060 tests passed, 194 suites, 0 failed**, "All tests passed", 136s — matches evaluation-1.md's claimed numbers exactly, independently reproduced.
- `npm run check:schemas` → PASS, same "60 checked across 45 protocol files" as claimed.
- `npm run check:scala-quality` → exit 0, "clean (113 soft warning(s))" — same count as claimed; spot-checked the warning list, all pre-existing test-file-size warnings, none newly introduced by this diff's touched files at blocking severity.
- `openspec validate pipeline-schema-drift-detection --strict` (via the system `openspec` binary, since `npx openspec` failed with "could not determine executable" in this worktree — a local tooling quirk, not a code issue) → "Change 'pipeline-schema-drift-detection' is valid".
- `npm run check:openspec` → exit 1, sole issue "complete (12/12) but not archived" — expected pre-archive state, matches evaluator's account.

**CONTRIBUTING.md spot-checks:**
- No inline FQNs in any new/touched file (grepped `com\.helio\.` occurrences outside import blocks — none).
- Repository read/write pattern (`findByIdOwned`-shape, `owner_id = ?` filter under `withUserContext`) matches the ACL triad's mutation-path guidance and mirrors `updateLastRun` exactly — not a new one-off pattern. I traced a subtlety here: this filter matches `owner_id = <calling user's id>`, so for a grantee-triggered run (non-owner "editor" role) the baseline write would silently no-op — but this is *identical, pre-existing* behavior already covered by `PipelineRunServiceSpec`'s existing "editor-grantee-triggered run resolves normally despite no persisted run row" tests (`insertRun` already silently no-ops for non-owners, a documented existing behavior). HEL-462 does not introduce or worsen this; it inherits the same convention `updateLastRun`/`updateRunTerminal` already use. Not a regression, not in scope to fix here.
- `dataTypeRepo != null` guard on the new baseline-persist block matches the file's own pre-existing convention (identical guard at `main`'s line 503, confirmed via `git show main:...`).

**Frontend footprint (this change is backend-only per the brief) — verified myself, not taken on faith:**
- `grep -rn "sourceSchemaDrift" frontend/src` → zero matches.
- No `frontend/**` files in the diff (confirmed via `git diff --name-only`).
- Given zero frontend footprint, I did not start `start-servers.sh` against the shared dev Postgres — the full HTTP-route-level test (`PipelineAnalyzeRoutesSpec`, real Pekko routes + embedded Postgres + JSON-schema validation) already exercises the exact contract a consumer would receive, and starting a live server here would add risk (HEL-521 precedent) without exercising any code path a browser check could add. Section 4 (UI/design judgment) of my brief is N/A — there is no UI to judge.

### Verdict: CONFIRM

All five acceptance criteria trace to real, independently-reproduced evidence. Design D1-D6 all match the implementation on inspection of the actual diff. The migration-number collision check (my explicit responsibility this gate) came back clean against a freshly-fetched `origin/main`. Full `sbt test` (3060/3060), `check:schemas`, `check:scala-quality`, and `openspec validate --strict` were all re-run by me with matching results to the evaluator's claims — no discrepancies found, so no re-run-for-instability was needed. Tests are substantive (real value assertions, not `shouldBe defined`-only checks). No scope creep, no frontend risk, no FQN violations, no new anti-patterns.

### Non-blocking notes

- Same as evaluation-1.md's suggestion: `PipelineService.parseBaselineSchema`'s malformed-JSON tolerant-parse branch has no direct test feeding it an actually-malformed string. Low-risk (the column is only ever written by this change's own serializer) and not an AC requirement — worth a one-line follow-up test if this path is ever touched again.
- `PipelineAnalyzeService.scala`/`PipelineRunService.scala`/`PipelineService.scala` are all now past the ~400-line soft-split budget; pre-existing condition this change grew modestly, already flagged by the evaluator as a queue-worthy (non-blocking) follow-up.
- The owner-scoped baseline write silently no-ops for grantee-triggered (non-owner) runs — pre-existing, inherited convention from `updateLastRun`, not introduced by this change. Flagging for awareness only; not a defect of this ticket.
