## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/metric-definition-persistence/spec.md` fresh (not the round-1 summary).
- Read round-1's report (`skeptic-design-1.md`) to know what the three change
  requests actually demanded, then checked the *current* artifact text word-for-word
  against each:

  1. **`owner_id ... REFERENCES users(id)`** — `tasks.md` 2.2 now reads
     `owner_id UUID NOT NULL REFERENCES users(id)` with an explicit citation to
     `V60__alert_rules.sql`/`V61__alert_events.sql`; `design.md` Decision 2 explains
     the reasoning. Confirmed against ground truth: read
     `backend/src/main/resources/db/migration/V60__alert_rules.sql` in full — it
     has exactly `owner_id UUID NOT NULL REFERENCES users(id)` and
     `CREATE TABLE users` exists (`V6__users.sql`), so the FK target is valid.
     **Resolved.**

  2. **Index on `data_type_id`** — `tasks.md` 2.3 now adds both
     `idx_metrics_owner_id` and `idx_metrics_data_type_id`, citing
     `idx_alert_rules_target_data_type_id`. Confirmed: `V60__alert_rules.sql` does
     contain `CREATE INDEX idx_alert_rules_target_data_type_id ON
     alert_rules(target_data_type_id)` exactly as cited. **Resolved.**

  3. **`RootJsonFormat[MetricDefinition]` precedent-less** — `proposal.md`,
     `design.md` Decision 3a, `tasks.md` 4.1, and `spec.md`'s "MetricDefinition
     JSON formatters" requirement all now specify a `MetricResponse` DTO +
     `fromDomain` + `RootJsonFormat[MetricResponse]`, plus a direct
     `RootJsonFormat[MetricFormat]` (needed for the JSONB column encoding only).
     Confirmed against ground truth:
     - Read `AlertRuleProtocol.scala` in full — it has exactly this shape:
       `AlertRuleResponse` (string-ified `id`/`ownerId`/`targetDataTypeId`,
       string-ified `createdAt`/`updatedAt`), `AlertRuleResponse.fromDomain`, and
       `jsonFormat10(AlertRuleResponse.apply)` via `DefaultJsonProtocol` macro
       derivation — matches the plan's description precisely.
     - Read `DataTypeRepository.scala:207-225` — confirms the exact same
       "protocol-level `RootJsonFormat[DataField]` imported into the repository
       and used directly inside a `MappedColumnType.base[...]`" pattern the plan
       proposes for `MetricFormat` (`DataTypeProtocol.dataFieldFormat` used by
       `DataTypeRepository.dataFieldsColumnType`). Grepped
       `RootJsonFormat[DataField]` — defined once, in `DataTypeProtocol.scala:59`.
     - Re-grepped for `JsonFormat[Instant]` and any direct
       `RootJsonFormat[<domain entity>]` (`RootJsonFormat[AlertRule]`,
       `RootJsonFormat[DataType]`, `RootJsonFormat[PipelineSchedule]`) across
       `backend/src/main/scala/` — zero hits, confirming the plan's claim that no
       such precedent exists still holds.
     - Checked for import-cycle risk: `infrastructure/DataTypeRepository.scala`
       imports `api.protocols.DataTypeProtocol`, and `api/protocols/*.scala`
       imports only `com.helio.domain._`/spray-json/pekko — no back-reference to
       `infrastructure`, so `MetricRepository` importing `MetricProtocol` for
       `RootJsonFormat[MetricFormat]` (as `tasks.md` 3.1/4.1 implies) is safe,
       mirroring the existing `DataTypeRepository` → `DataTypeProtocol` edge.
     **Resolved** — and the "Response DTO" resolution chosen (option b from my
     round-1 report) is the one that best matches established convention rather
     than expanding scope with a bespoke exception.

- Re-checked `JsonProtocols.scala`'s aggregator-trait mix-in list
  (`trait JsonProtocols extends ResourceProtocol with ... AlertRuleProtocol with
  ...`) — confirms `tasks.md` 4.1's instruction to "mix `MetricProtocol` into
  `JsonProtocols.scala`'s aggregator trait" is a drop-in, consistent with every
  other domain protocol trait already listed there.
- Re-verified the value-class-ID convention (`model.scala:8-15`, 585-586, 607,
  737) — `MetricId(value: String) extends AnyVal` fits the established pattern.
- Re-verified `Severity`/`Comparator` `sealed trait` + `fromString: Either[String,
  X]` shape (`model.scala:623-660`) against `design.md` Decision 1's deliberate
  deviation (raw `String` field + `MetricAggregation.validate` at the repository
  boundary, not construction-time). This was flagged non-blocking in round 1 and
  remains transparently documented in `design.md` Decision 1 and called out
  explicitly in `tasks.md` 1.4 ("NOTE: this is a deliberate deviation... Do not
  'fix' this into a full ADT") — the executor guardrail I asked for is present.
- Confirmed `users` table exists (`V6__users.sql`) so the new FK target resolves.
- Confirmed the migration-numbering note remains correctly deferred to
  `ls db/migration/` at execution time (`design.md` Decision 5, `tasks.md` 2.1) —
  latest migration on this worktree is still `V74__api_token_scope_and_run_audit.sql`.
- Re-read `tasks.md` and `spec.md` end-to-end for internal consistency: every
  scope item in `proposal.md`/`design.md` has a corresponding task and a spec
  requirement/scenario; every ticket AC line maps to a task (domain model →
  §1, migration/RLS/FK/indexes → §2, repository CRUD → §3, JSON → §4,
  RLS-isolation/CASCADE/aggregation-validation/JSON-round-trip tests → §5). No
  new placeholders, TODOs, or scope drift introduced by the round-1 edits.

### Verdict: CONFIRM

All three round-1 change requests are correctly and precisely reflected in the
current `proposal.md`/`design.md`/`tasks.md`/`spec.md` text, and each revision is
independently verified against the actual codebase (not just the plan's own
citations) to be accurate: the `owner_id` FK and `data_type_id` index both match
their cited `V60__alert_rules.sql` precedent line-for-line, and the
`MetricResponse`/`fromDomain`/`RootJsonFormat[MetricResponse]` +
`RootJsonFormat[MetricFormat]` shape matches `AlertRuleProtocol.scala` and
`DataTypeRepository`'s JSONB-column pattern exactly, with no import-cycle risk.
No new issues were introduced by the round-1 edits. The design is sound and ready
for implementation.

### Non-blocking notes

- Same as round 1: `MetricDefinition.aggregation` stays a raw `String` validated
  only at the repository insert/update boundary (not construction), and the RLS
  isolation test (`tasks.md` 5.2) will — per this codebase's documented dev/CI
  superuser-bypasses-RLS limitation — only prove app-layer `WHERE owner_id = ?`
  scoping. Both are already transparently documented and guarded against
  executor overclaiming/mis-fixing in `tasks.md`, so neither blocks.
