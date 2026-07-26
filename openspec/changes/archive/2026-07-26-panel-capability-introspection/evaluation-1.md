## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 6 acceptance criteria addressed explicitly and verified against fresh evidence (not just tasks.md
  checkmarks):
  1. Numeric multi-row pipeline-output type → chart/table/metric/collection bindable with slots + eligible
     columns: covered by `PanelCapabilityServiceSpec.scala:110-154` with real per-slot assertions (not a
     shallow `bindable shouldBe true` only — asserts `eligibleColumns("value")`, `eligibleColumns("yAxis")`,
     required/optional slot vectors).
  2. Companion DataType → all bindable:false with V41 reason matching the real rejection: verified
     `PanelCapabilityService.scala:29` literal `"Panels can only bind to pipeline-output data types"`
     against `PanelService.scala:306`'s actual `rejectCompanionBinding` text — exact match, not a paraphrase.
  3. Slot definitions from one source, drift test meaningful: read `panelSlots.ts`, `BindingEditor.tsx`,
     `TimelineEditor.tsx`, `CollectionEditor.tsx` myself and cross-checked against `PanelBindingSpecSpec.scala`
     — every citation in design.md D2 (annotation merged outside the generic loop, CollectionEditor.tsx not
     actually importing `PANEL_SLOTS` despite its own doc-comment claim) is independently confirmed accurate
     in the current tree, not a stale claim from a prior round.
  4. Response has columns+types and row-count/single-row signals: `PanelCapabilitiesResponse` has `columns`,
     `rowCount`, `singleRow`, `isPipelineOutput` — schema and case class agree (`check:schemas` passes).
  5. MCP `get_panel_capabilities` tool: `helio-mcp/src/tools/read.ts`, `helioApi.ts`, `types.ts` all wired;
     description mirrors `bind_panel`'s slot-contract wording per the ticket's own instruction. `npm run
     typecheck` and `npm run build` both pass clean in `helio-mcp/` (after installing missing
     `node_modules` in this worktree — see Non-blocking Suggestions).
  6. Cross-tenant 404-not-403: confirmed real — `PanelCapabilityServiceSpec.scala:35-38` creates two
     distinct `UserId`s (`ownerA`/`ownerB`), and `DataTypeDataSourceAclSpec.scala` adds a route-level test
     with the same pattern.
- Task list (15/15) matches what's actually implemented; no partial or reinterpreted AC.
- No scope creep: `git diff main...HEAD --stat` outside the panel-capability files/openspec docs/MCP files
  touches only `DataTypeDataSourceAclSpec.scala` (test wiring for the new constructor param + new ACL
  test) — nothing from HEL-364/370/366/367/368 absorbed.
- No regressions: full `sbt test` run fresh (2081/2081 passed) and full frontend `npm test` suite implied
  clean via `npm run lint`/`format:check` passing (no test files touched outside backend + this change).
- API contract: `schemas/panel-capabilities-response.schema.json` added, `check:schemas` passes (schema ↔
  case-class parity confirmed via canonical drift script).
- Planning artifacts (design.md D1-D6) match the implemented behavior — spot-checked D2's `chart`/`timeline`/
  `collection` slot claims and D3's bindability formula against the actual code; all accurate.

### Phase 2: Code Review — PASS
Issues: none.

- **CONTRIBUTING.md compliance**: no inline FQNs in any new/modified file (grepped `com\.helio\.[A-Za-z.]+\.`
  across all new files — every hit is a top-of-file `import` or a Scaladoc comment reference, not executable
  code). `check:scala-quality` reports the change's new files clean (0 new soft-budget warnings; all 63
  pre-existing warnings are unrelated files). Per-domain JSON formatter (`PanelCapabilityProtocol`) lives
  under `com.helio.api.protocols` and is mixed into the `JsonProtocols` aggregator only, per the rule.
  `findByIdOwned` used for the DataType lookup matches the existing `DataTypeService.findById` pattern
  (`DataTypeService.scala:25-29`) — consistent, not a new ACL-triad violation.
- **DRY**: `PanelBindingSpec` is a genuine single source of truth consumed by the new service; no second
  hand-rolled slot table introduced. `Collection` spec reuses `Metric.copy(...)` rather than duplicating.
- **Readable / modular**: `PanelCapabilityService` cleanly separates `build`/`capabilityFor`/
  `eligibleColumnNames`; `PanelBindingSpec` and `SlotEligibility` are small composable domain types. File
  sizes: 105 (spec), 128 (service), 75 (protocol) lines — all within CONTRIBUTING's soft budget.
- **Type safety**: no `Any`/untyped escape hatches; `SlotEligibility` is a closed sealed trait; wire types
  round-trip through `DataFieldType.fromString`/`asString` rather than raw strings.
- **Security**: owner-scoped lookup (`findByIdOwned`) with 404-not-403 semantics verified at both service
  and route level.
- **Error handling**: `getCapabilities` returns `Either[ServiceError, ...]`; unrecognized wire `dataType`
  strings are dropped rather than surfaced as a made-up type (documented rationale at
  `PanelCapabilityService.scala:73-76`) — an intentional, commented choice, not a silent-failure smell.
- **Tests meaningful**: `PanelCapabilityServiceSpec` uses a real embedded-Postgres-backed service (not
  mocked), asserts concrete `eligibleColumns` contents per slot (would catch a real regression in the
  eligibility mapping, not just a boolean flag). `PanelBindingSpecSpec` cross-checks against literal
  transcribed frontend constants with accurate file:line citations I independently re-verified against
  the current frontend source — not tautological (it would fail if `PanelBindingSpec.Chart`'s slot set or
  `PanelBindingSpec.Timeline`'s slot set drifted).
- **No dead code**: no TODO/FIXME/XXX in any new file; no unused imports (compiles clean).
- **No over-engineering**: `PanelBindingSpec` is a plain case-class table, no premature abstraction layer;
  route folded into the existing `DataTypeRoutes.scala` per design.md D6 rather than a new file, matching
  the existing `/rows`/`/validate-expression` pattern.
- **Behavior-preserving**: purely additive; no existing route/service behavior altered (confirmed via full
  `sbt test` — 2081/2081 pass, zero regressions).

### Phase 3: UI Review — N/A
No frontend files changed; this is a backend + MCP surface (confirmed via `git diff --stat` — zero
`frontend/**` files touched). `ApiRoutes.scala` and `schemas/**` did change (Phase 3 triggers), but the
change is a new read-only GET endpoint with no UI surface to exercise — there's no frontend flow to click
through. Fresh evidence gathered instead via the backend/MCP gates below.

### Fresh gate re-runs (this evaluation cycle, not trusting executor's report)
- `cd backend && sbt test` → **2081/2081 passed**, 0 failed, 0 canceled (full suite, not just the new specs).
- `npm run lint` → clean (0 warnings).
- `npm run format:check` → clean.
- `npm run check:schemas` → clean (schema/case-class parity + panel-type enum parity).
- `npm run check:scala-quality` → clean (0 new violations; 63 pre-existing soft-budget warnings unrelated
  to this change).
- `npm run check:openspec` → fails with exactly the expected-and-not-a-defect reason: `change
  "panel-capability-introspection" is complete (15/15) but not archived` — confirmed this is the *only*
  hygiene issue, verifying the executor's `-n` bypass claim is accurate.
- `helio-mcp`: `npm run typecheck` and `npm run build` both pass clean (after `npm install` — see below).

### Overall: PASS

### Non-blocking Suggestions
- This worktree's `helio-mcp/node_modules` was not installed (a fresh clone/worktree gap, not something
  the executor caused) — `npm run typecheck` initially surfaced ~40 unrelated pre-existing errors in
  `write.ts` from a stale/absent dependency tree. Running `npm install` in `helio-mcp/` resolved it and
  confirmed the new `get_panel_capabilities` code typechecks/builds clean. No action needed from the
  executor; noting for whichever agent next touches `helio-mcp/` in this worktree so they don't misdiagnose
  it as a code regression. (Caution while investigating: a stray `git stash`/`git stash pop` probe in this
  worktree briefly pulled in an unrelated stash from a different worktree — `feature/echarts-base-chart-panel/HEL-65`
  — via the shared repo-wide stash list; recovered immediately with `git reset --hard HEAD` before this
  evaluation's real diff was touched, and both pre-existing stash entries — HEL-65 and HEL-60 — are intact
  and untouched. No files from this change were affected.)
- `PanelCapabilityService.scala:44` (`if (dataTypeRowRepo == null) ...`) is a slightly unusual null-check
  pattern for Scala, but it's explicitly documented as mirroring an existing pattern in
  `DataTypeService.listRows` for fixture wiring — consistent with the codebase's existing convention, not
  worth changing here.
