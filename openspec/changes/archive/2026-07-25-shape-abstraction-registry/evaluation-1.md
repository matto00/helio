## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 6 ticket ACs addressed explicitly:
  1. `PipelineShape` trait + `Registry` exist (`domain/shapes/PipelineShape.scala`); `expand(params)` returns `Either[String, Vector[ShapeStepExpansion]]`; `outputContract` declared on the trait.
  2. `GET /api/pipeline-shapes` returns the catalog (id/label/paramsSchema/outputContract), authenticated identically to sibling pipeline routes — live-verified below.
  3. Expansion validity against the real step CRUD/validation path is proven by `PassthroughShapeSpec`'s cross-check (`CreatePipelineStepRequest` → `PipelineStepConfigCodec.decode`), matching spec.md's "Expansion is valid against the existing step decode path" scenario.
  4. `schemas/pipeline-shape-catalog.schema.json` added; `check:schemas` confirms parity with `PipelineShapeProtocol`.
  5. Tests present for registry lookup (`PipelineShapeSpec`), reference-shape expansion (`PassthroughShapeSpec`), and catalog endpoint response shape (`PipelineShapeRoutesSpec` + `ApiRoutesSpec`).
  6. Backward-compatible: no Flyway migration added (confirmed — V72 remains latest, matching origin/main); no existing test regressed (1940/1940 pass).
- No AC silently reinterpreted. The ticket's example path (`GET /api/pipelines/shapes`, marked "e.g." in the ticket) was deliberately revised to `GET /api/pipeline-shapes` per design.md Decision 6 — this is a documented, design-gate-driven correction of a real routing bug, not a scope reinterpretation, and is called out explicitly in tasks.md/design.md/proposal.md.
- No unnecessary changes outside ticket scope. The `origin/main`-scoped diff (correcting for a stale local `main` ref in this worktree — see note below) touches exactly the files listed in `files-modified.md`: new `domain/shapes/*`, `services/PipelineShapeService.scala`, `api/protocols/PipelineShapeProtocol.scala`, `api/routes/PipelineShapeRoutes.scala`, plus minimal `ApiRoutes.scala`/`JsonProtocols.scala`/`package.scala` wiring, the schema file, and tests/planning docs. No scope creep.
- No regressions to existing behavior: full `sbt test` suite (1940 tests) and frontend suite (1361 tests) both pass with 0 failures.
- API contract updated: `schemas/pipeline-shape-catalog.schema.json` added and verified in sync via `npm run check:schemas`.
- Planning artifacts (design.md, tasks.md, spec.md) match the shipped implementation field-for-field (verified directly against source below).

**Note on diff base**: this worktree's local `main` ref is stale (`1bb95832`), while the actual merge-base with `origin/main` is `6cf4c3f4` (which already contains the unrelated HEL-386/384/389/388/etc. op tickets visible in a naive `git diff main...HEAD`). Diffing against `origin/main` instead correctly isolates HEL-391's actual changes (29 files, ~1630 insertions) — the review above is scoped to that diff.

### Phase 2: Code Review — PASS
Issues: none.

- **Canonical code-quality compliance**: `npm run check:scala-quality` reports "clean, 0 new warnings" — no inline FQNs in any HEL-391 file (`check:scala-quality` is the mechanical enforcement of CONTRIBUTING.md's Imports & Qualifiers rule). All new files are well under the 250-line soft budget (largest is `PipelineShapeProtocol.scala` at 104 lines). Per-domain formatter placement rule honored: `PipelineShapeProtocol` lives under `com.helio.api.protocols`, `JsonProtocols` only mixes it in (`JsonProtocols.scala:48`).
- **DRY**: `ShapeParamDescriptor` mirrors `ConnectorFieldDescriptor`'s descriptive-metadata role rather than reinventing it; `PipelineShapeService`/`PipelineShapeRoutes` mirror the existing `ConnectorRoutes` thin-shell pattern. No duplication introduced.
- **Readable**: clear naming throughout (`RowCountContract`, `ShapeStepExpansion`, `OutputFieldContract`); no magic values — `RowCountContract`'s wire discriminators (`"exactly-one"`, `"at-most-param"`, `"unbounded"`) are the only string literals and they're the intentional wire contract.
- **Modular**: small, single-purpose files (`OutputContract.scala`, `PipelineShape.scala`, `PassthroughShape.scala`, `ShapeStepExpansion.scala`, `ShapeParamDescriptor.scala` all under 60 lines).
- **Type safety**: `expand` returns `Either[String, ...]` rather than throwing; `RowCountContract` is a genuine sealed trait with exhaustive pattern matches in the protocol's `write`; no `Any`/`asInstanceOf` escape hatches found.
- **Layering (design.md Decision 1)**: verified via `grep -rn "^import com.helio.api" backend/src/main/scala/com/helio/domain/shapes/` → zero matches. `com.helio.domain.shapes` genuinely has no import of `com.helio.api.protocols`; the only string occurrences of `com.helio.api.protocols` in that package are doc comments explaining the deliberate non-dependency.
- **`OutputFieldContract` field count (design.md Decision 2 / round-2 fix)**: verified `final case class OutputFieldContract(name: String, dataType: DataFieldType, nullable: Boolean)` (`OutputContract.scala:31`) — exactly 3 fields, no `role`. All other `role` occurrences in the diff are doc-comment explanations of why it was dropped, not a re-introduced field.
- **`DataFieldType` FQN correction**: confirmed `com.helio.domain.DataFieldType` is the real type (`domain/model.scala:229`), matching the round-2 skeptic fix (proposal cited a nonexistent `domain.model.DataFieldType` in an earlier draft).
- **Error handling**: `PassthroughShape.expand` returns descriptive `Left` messages for missing/empty/non-string `fields`; `PipelineShape.shapeFor` returns `Left` listing valid ids.
- **Tests meaningful**: see Phase 1 mapping — every spec.md requirement/scenario has a corresponding test (registry lookup success/failure, expand valid/invalid, AC3 cross-check, catalog 200/401 both isolated and composed-route-tree, and the RowCountContract 3-variant wire-shape test added specifically to close the round-4 design-gate gap). Confirmed by reading `PipelineShapeProtocolSpec.scala`, `PipelineShapeSpec.scala`, `PassthroughShapeSpec.scala`, `PipelineShapeRoutesSpec.scala`, and the `ApiRoutesSpec.scala` diff directly — not just trusting file names.
- **No dead code**: no leftover TODO/FIXME in the new files; no unused imports observed.
- **No over-engineering**: registry is a plain `Map`, no premature parity-test scaffolding (explicitly deferred in design.md Risk section until a 2nd shape exists, which is a reasonable YAGNI call for a foundation ticket).
- Not a structural refactor — new, additive code; behavior-preservation of existing pipeline/step code confirmed by the full existing test suite passing unmodified (1940/1940).

### Phase 3: UI Review — N/A (backend-only per orchestrator classification), substituted with live backend endpoint verification per orchestrator instructions

Started servers via canonical script; `assert-phase.sh servers` → `PASS servers`.

Live curl verification against the real running server (not just unit tests):
- `GET /api/pipeline-shapes` unauthenticated → **401** (confirmed).
- `POST /api/auth/login` with dev credentials → 200, session cookie set.
- `GET /api/pipeline-shapes` authenticated → **200** with `[{"id":"passthrough","label":"Passthrough","description":"...","paramsSchema":[{"name":"fields",...}],"outputContract":{"rowCount":{"kind":"unbounded"},"fields":[],"description":"..."}}]` — matches spec.md's wire-shape requirement exactly (id/label/description/paramsSchema/outputContract present, `rowCount` discriminated union).
- **Routing-collision regression check**: additionally curled the *old, rejected* path `GET /api/pipelines/shapes` (authenticated) and got **404 `{"message":"Pipeline not found: shapes"}`** — this independently reproduces, live, the exact routing bug design.md Decision 6 was written to avoid (`PipelineRoutes`'s `path(PipelineIdSegment)` catch-all swallowing a literal `"shapes"` segment). This confirms the shipped `/api/pipeline-shapes` distinct-prefix decision was not just theoretically correct but is genuinely what prevents the collision on the real, composed route tree — not merely asserted by a unit test in isolation.

No console errors possible to observe (no frontend surface for this backend-only change); N/A for breakpoint/accessibility/loading-state checks (no UI changed).

### Verification summary (fresh evidence, all re-run independently this cycle)
- `cd backend && sbt test` → **1940 tests, 0 failed** (all suites, including 105 suites total).
- `npm test` (root + frontend) → **1361 frontend tests, 0 failed**; root `jest --passWithNoTests` clean.
- `npm run lint` → 0 warnings (zero-warnings policy).
- `npm run format:check` → clean.
- `npm run check:schemas` → "schemas in sync with JsonProtocols (19 checked across 23 protocol files)".
- `npm run check:scala-quality` → clean, 0 new warnings (all file-size soft-budget warnings are pre-existing test files unrelated to this change; none of the new HEL-391 files appear in the warning list).
- `npx openspec validate shape-abstraction-registry --strict` → "Change 'shape-abstraction-registry' is valid".
- `npm run check:openspec` → reproduces exactly the executor's documented bypass reason: `change "shape-abstraction-registry" is complete (21/21) but not archived`. This is a process-ordering hygiene check (archiving is the orchestrator's Phase-4 job, not the executor's), not a failing quality gate — confirmed against real HEL-386/HEL-389 precedent (`git log --all --oneline --grep="HEL-386"` / `--grep="HEL-389"` both show a distinct, later "Archive ..." commit following the implementation commit, exactly as the executor's commit message claims). The `-n` bypass is legitimate.
- `git rev-parse origin/main` vs. the migration directory: latest file is still `V72__add_lookup_op.sql` on both origin/main and this branch — **no new Flyway migration added**, confirming AC6 / spec.md's "no new Flyway migration file is added" scenario.
- `grep -rn "^import com.helio.api" backend/src/main/scala/com/helio/domain/shapes/` → zero matches (layering clean).
- `grep -n "case class OutputFieldContract" backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala` → `OutputFieldContract(name: String, dataType: DataFieldType, nullable: Boolean)` — exactly 3 fields, no `role`.
- tasks.md: 21/21 checked, 0 unchecked — matches `check:openspec`'s own "(21/21)" count.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- None beyond what design.md's own Risks section already documents (e.g., deferring the registry-parity test until a 2nd shape exists) — those are reasonable, explicitly-justified deferrals for a foundation ticket, not gaps.
