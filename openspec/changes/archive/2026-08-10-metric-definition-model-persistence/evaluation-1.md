## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 6 ticket acceptance criteria are addressed explicitly and non-partially:
  1. `metrics` table w/ owner-only RLS (`ENABLE`+`FORCE`), `data_type_id` FK
     `ON DELETE CASCADE`, `owner_id` index — `V75__metrics.sql:18-46`.
  2. `MetricDefinition` round-trips through `MetricRepository` (insert /
     findByIdOwned / listByOwner / update / delete) under a user context —
     `MetricRepositorySpec.scala:112-233`.
  3. `aggregation` allow-list validation with descriptive `Left` — validated
     at the repository insert/update boundary rather than at construction.
     This is a **documented, deliberately-approved deviation** from a literal
     "domain boundary" reading (design.md Decision 1), reviewed and CONFIRMed
     by the skeptic in both design-gate rounds (`skeptic-design-2.md:67,98`).
     Not a silent reinterpretation — called out in the ticket's own tasks.md
     1.4 note and the commit message.
  4. RLS-isolation (app-layer, dev/CI superuser-bypass gap documented,
     matching `AlertRuleRepositorySpec` precedent) and CASCADE-delete tests
     present — `MetricRepositorySpec.scala:169-180,235-244`.
  5. Additive only — no existing table/column/panel changes; confirmed via
     `git diff main...HEAD --stat` (only new files + 3 small aggregator/guard
     edits). `sbt test`: 2372/2372 pass (fresh run, see Phase 2).
  6. No inline FQNs — confirmed via `check:scala-quality` clean run (Phase 2).
- Tasks.md: all 22 items checked and each matches the actual diff (verified
  file-by-file against `files-modified.md` and `git diff`).
- No scope creep: no REST routes, no `ApiRoutes.scala` change, no
  panel/service wiring — matches the ticket's explicit "Out of scope" list.
- No regressions: full `sbt test` suite green, `RlsPolicyGuardSpec` updated
  correctly to include `metrics` in `rlsTables`.
- No API-contract changes needed (no REST surface added in this ticket) —
  `check:schemas` confirms schemas remain in sync.
- Planning artifacts (proposal/design/tasks/spec.md) accurately reflect the
  final implementation; design.md's two revised decisions (RLS shape,
  wire-DTO-not-direct-format) are both reflected in the code as written.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Fresh gate re-run** (backend-only change; no `frontend/**` files touched):
- `cd backend && sbt test` → **2372/2372 passed**, 0 failed (matches
  executor's claimed count).
- `npm run check:scala-quality` → clean, 0 hard errors (81 pre-existing soft
  line-count warnings unrelated to this change; `MetricRepositorySpec.scala`
  at 319 lines is a soft-only warning, consistent with dozens of other
  pre-existing spec files over the 250-line budget).
- `npm run check:schemas` → in sync (32 protocols checked).
- `npm run check:openspec` → **fails as expected**: "change
  \"metric-definition-model-persistence\" is complete (22/22) but not
  archived." This is the sole bypassed gate (`git commit -n`), explicitly
  called out in the commit body with a cited precedent
  (`b8fa5cd7`/`78b8aadc`, HEL-447). Verified: HEL-447 and at least 5 other
  tickets (HEL-266, HEL-377, HEL-373, HEL-460) in this repo's history follow
  the identical two-phase execute-then-archive commit pattern (a `HEL-N Add
  ...` commit followed later by a separate `HEL-N Archive ... change`
  commit). This is an established, repo-wide pattern, not a novel shortcut —
  accepted per CONTRIBUTING.md's `--no-verify` carve-out combined with this
  documented precedent.

**Code quality (diff + full-file reads: `model.scala` additions,
`V75__metrics.sql`, `MetricRepository.scala`, `MetricProtocol.scala`,
`JsonProtocols.scala` diff, `RlsPolicyGuardSpec.scala` diff, both new test
files):**
- Canonical code-quality compliance: no inline FQNs (mechanically confirmed);
  imports at top; `java.sql.Timestamp` used inline in `instantColumnType`
  matches the exact pre-existing pattern in `AlertRuleRepository.scala:116`,
  `DataTypeRepository.scala:210`, `PipelineRepository.scala:372` — `java.sql.`
  is not in `check-scala-quality.mjs`'s `FQN_PREFIXES` list, so this is not a
  violation, just consistent with established repo convention.
- DRY: `MetricRepository` mirrors `DataTypeRepository`/`AlertRuleRepository`
  JSONB `MappedColumnType` conventions exactly; no new serialization
  mechanism invented.
- Readable: clear field names, no magic values (allow-list values are named
  constants in `MetricAggregation.values`).
- Modular: repository/domain/protocol cleanly separated; `MetricProtocol`
  correctly lives under `com.helio.api.protocols` and is mixed into the
  `JsonProtocols` aggregator only (per CONTRIBUTING.md "Per-domain JSON
  formatters" rule).
- Type safety: no `Any`/untyped escape hatches; `Either[String, ...]` used
  consistently for validated writes.
- Security: RLS `FORCE` + owner policy at the DB layer; app-layer
  owner-scoping in every non-internal repository method; `findByIdInternal`
  has the required ACL-bypass justification comment per CONTRIBUTING.md's
  ACL triad.
- Error handling: `insert`/`update` return `Left` for invalid `aggregation`
  with no partial write; tests confirm no row is written on rejection.
- Tests meaningful: 15 repository-spec cases + `MetricAggregation.validate`
  unit cases + 3 JSON round-trip cases cover every ticket AC and would catch
  a real regression (e.g., a broken CASCADE FK, a broken RLS index, a
  weakened allow-list).
- No dead code: no leftover TODO/FIXME; `findByIdInternal` has zero callers
  today but is explicitly justified in both design.md and the class doc
  comment as anticipated 418-B future use, mirroring an existing precedent
  (`DataTypeRepository.findByIdInternal`) — acceptable, not premature
  over-engineering, since it's requested directly by the ticket text ("a
  privileged lookup ... where warranted").
- No over-engineering: `MetricAggregation` is a flat `Set` + function, not a
  sealed-trait ADT — a deliberate, documented simplification matching the
  ticket's literal field list (raw `String`), not gold-plating.
- N/A for "behavior-preserving refactor" — this is a purely additive change,
  not a refactor.

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala` (confirmed
absent from diff), `schemas/**`, or `openspec/specs/**` files changed. This
is a backend-only data-layer ticket with no REST routes and no UI surface,
matching the ticket's explicit scope.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/infrastructure/MetricRepositorySpec.scala`
  is 319 lines (soft budget 250, non-blocking per CONTRIBUTING.md). If a
  future ticket touches this file again, consider splitting CRUD-round-trip
  cases from allow-list/CASCADE cases into two spec files, consistent with
  how several other infrastructure specs in this codebase already exceed the
  budget without being flagged as a hard issue.
