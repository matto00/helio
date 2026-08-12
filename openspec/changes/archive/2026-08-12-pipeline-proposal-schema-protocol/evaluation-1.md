## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Details:
- All five ticket ACs addressed:
  1. `schemas/pipeline-proposal.schema.json` defines `PipelineProposal` (`pipelineName`,
     `source`, `outputDataTypeName`, `steps` required), no id fields anywhere. `$defs` for
     `PipelineProposalSource` (sourceId-or-inline, `type` enum `csv|rest_api|sql|static`) and
     `PipelineProposalStep` (`type`/`config`, `type` unconstrained per D3). Matches spec.md
     scenarios exactly (`openspec validate pipeline-proposal-schema-protocol --strict` passes).
  2. `PipelineProposalProtocol.scala` round-trips the schema with a hand-written
     `RootJsonFormat` mirroring `DashboardProposalProtocol.proposalPanelFormat` — writer omits
     keys for absent `Option`s, reader tolerates absent optionals, `deserializationError` only
     on the four required `PipelineProposal` fields.
  3. Inline-source branch reuses `CsvSourceConfigPayload`/`RestApiConfigPayload`/
     `SqlSourceConfigPayload`/`StaticDataPayload` from `DataSourceProtocol.scala` — no new DTOs.
     The ticket text names the outer request wrappers (`SqlCreateSourceRequest`,
     `CreateSourceRequest`) as the reuse target, but design.md's Context section explicitly
     documents why those wrappers aren't reusable wholesale (their `config` field is exactly
     what's reusable; the wrappers themselves don't fit the flat per-kind-Option shape) — this
     is a **documented, skeptic-reviewed reinterpretation** (`skeptic-design-1.md`/
     `skeptic-design-2.md` present), not a silent one, and it still satisfies the AC's actual
     requirement ("no duplicate DTOs").
  4. `sbt test`: 2476/2476 green, including the new 12-test spec (verified via a fresh run, see
     Phase 2).
  5. Additive-only confirmed by diff: new schema file, new protocol file, new test file, and a
     4-line mixin addition to `JsonProtocols.scala`'s trait list + doc comment. No existing
     route/service/repository/wire shape touched.
- Design.md D1 (source config through one shared `"config"` wire key) and D5 (hand-written
  format, not `jsonFormatN`) verified directly in the diff: the writer's `foreach` chain sets
  `fields("config") = v.toJson` for whichever of the four `Option` fields is populated (never
  `csvConfig`/`restConfig`/etc. as a key name); the reader dispatches on `type` to decode a
  single `"config"` key. Test `"serialize the inline source's config under a single shared
  'config' key"` and `"not emit csvConfig/restConfig/sqlConfig/staticConfig field names anywhere
  on the wire"` assert this directly (spec lines 45-48 in tasks.md / tests in
  `PipelineProposalProtocolSpec.scala`).
- Design.md D2 (steps reuse `CreatePipelineStepRequest` verbatim) verified: `PipelineProposal.
  steps: Vector[CreatePipelineStepRequest]`, no new step case class introduced.
- All `tasks.md` items (1.1, 2.1–2.4, 3.1–3.8) marked `[x]` and each is verifiably implemented
  as described — checked every item against the diff individually.
- No scope creep: `git diff main...HEAD --stat` touches exactly the files `files-modified.md`
  claims (schema, protocol, protocol spec, `JsonProtocols.scala` mixin, plus the openspec
  planning artifacts). No unrelated files changed.
- No regressions: full backend suite green, full frontend/mcp Jest suite green (see Phase 2).
- Schema/protocol parity: `npm run check:schemas` passes (`schemas in sync with JsonProtocols
  (37 checked across 30 protocol files)` — up from 36, confirming the new schema was picked up).
- Planning artifacts (proposal/design/tasks/spec/files-modified) all accurately describe the
  final implemented behavior; no drift found between docs and code.

### Phase 2: Code Review — PASS

Issues: none.

Gate re-run (fresh, in `WORKTREE_PATH`; `EVALUATOR_CLEAN_WORKTREE: false` in workflow-state.md,
so no clean-worktree re-run required — gates run directly against the executor's commit):

- `cd backend && sbt test` → **2476/2476 passed**, 145 suites, 0 failed. Isolated re-run of
  `testOnly com.helio.api.protocols.PipelineProposalProtocolSpec` → **12/12 passed**, matching
  the executor's claimed count and the file's own test names.
- `npm run check:scala-quality` → clean (0 hard FQN violations; 84 pre-existing soft
  file-size warnings, none for the two new files — both are well under the 250-line budget:
  `PipelineProposalProtocol.scala` 127 lines, `PipelineProposalProtocolSpec.scala` 158 lines).
- `npm run check:schemas` → clean, schema/protocol parity confirmed for the new schema+class.
- `npm run format:check` → clean.
- `npm run lint` → clean (0 warnings).
- `npm test` (root, runs mcp Jest then `npm --prefix frontend test`) → mcp 112/112 passed,
  frontend 1506/1506 passed. (No `frontend/**` files changed in this diff, so `npm --prefix
  frontend run build` wasn't required by the gate-selection rule, but the full frontend Jest
  suite ran clean regardless as part of `npm test`.)
- `openspec validate pipeline-proposal-schema-protocol --strict` → valid.
- `git status --short` in the worktree shows only the orchestrator-managed
  `workflow-state.md` as modified — no stray uncommitted files from the executor's session.

All of the executor's reported gate results are independently confirmed.

CONTRIBUTING.md compliance:
- **Imports & Qualifiers**: no inline FQNs from `FQN_PREFIXES` in `check-scala-quality.mjs`
  (`com.helio.`, `spray.json.`, `org.apache.pekko.`, etc.) in either new file. The one inline
  qualifier present, `scala.collection.mutable.Map[String, JsValue]()` in
  `PipelineProposalProtocol.scala` (source formatter's `write`), is not in the script's
  hard-fail prefix list and is an exact mirror of the existing pattern in
  `DashboardProposalProtocol.scala:66` (`proposalPanelFormat.write`) — precedent-consistent,
  not a new violation.
- **File-size budgets**: both new files well under the 250-line soft budget.
- **Per-domain protocol placement**: new formatter lives in its own
  `com.helio.api.protocols.PipelineProposalProtocol` trait; `JsonProtocols.scala` only adds a
  4-line mixin + doc-comment entry, consistent with "the aggregator only mixes them in."
- **`git commit -n` bypass**: `check:openspec`'s "complete but not archived" flag is a known,
  intended pre-archive state at this point in the delivery workflow (verified by reading
  `scripts/check-openspec-hygiene.mjs` — it flags any `openspec list --json` change with
  `status: "complete"` as needing archival, which every change is until the orchestrator's
  Phase 3 archive step runs). CONTRIBUTING.md requires the bypass be called out explicitly in
  the commit body for cases like this — the commit message does so precisely, naming the one
  check bypassed, confirming every other hook (lint/format/check:schemas/check:scala-quality/
  test) passed in an unbypassed attempt first, and citing the orchestrator doc as the reason
  archiving isn't the executor's job. Compliant, not a violation.
- No dead code, no TODO/FIXME/XXX in either new file (grepped explicitly).
- DRY: source-kind config payload types, `CreatePipelineStepRequest`, and the
  `DashboardProposalProtocol`-style hand-written-format pattern are all reused rather than
  reinvented.
- Type safety: no untyped escape hatches (`Any`/`asInstanceOf` in production code); the one
  `asJsObject`/`.convertTo[X]` unsafe-cast usage is standard spray-json protocol idiom
  identical to the rest of the codebase's hand-written formats.
- Error handling: `deserializationError` raised for each of the 4 required top-level fields
  individually with a descriptive message, matching `proposalPanelFormat`'s convention.
- Tests are meaningful, not tautological: they assert on the actual serialized `JsObject`'s
  key set (not just round-trip equality) for both the omit-on-absent and single-shared-
  `"config"`-key behaviors, so a regression to four separately-named config keys or to `null`-
  emission would fail a test, not just silently ship (this is exactly what tasks.md 3.5/3.7
  call for).
- No over-engineering: no new abstractions beyond what `DashboardProposalProtocol` already
  established; `PipelineStepProtocol`/`DataSourceProtocol` mixed in for reuse, not
  re-implemented.
- Design-standard (`DESIGN.md`) N/A — no `frontend/**` files in this diff.

### Phase 3: UI Review — N/A

No UI-affecting files changed: no `frontend/**`, no
`backend/src/main/scala/routes/ApiRoutes.scala`, no `schemas/**` route/response shape consumed
by a route, and no `openspec/specs/**` (the new `spec.md` lives under this change's own
`openspec/changes/.../specs/` delta directory, not the canonical `openspec/specs/` tree).
Confirmed via `git diff --name-only main...HEAD` — none of the Phase 3 triggers match.

### Overall: PASS

### Non-blocking Suggestions

- `PipelineProposalSource`'s `scala.collection.mutable.Map[String, JsValue]()` inline
  qualifier (`PipelineProposalProtocol.scala:38`) is precedent-consistent with
  `DashboardProposalProtocol.scala:66` and passes the mechanical FQN gate as-is, so no change
  is required here — but if `DashboardProposalProtocol.scala` is ever revisited, both could be
  tidied to `import scala.collection.mutable` at the top for full consistency with the letter
  of the Imports & Qualifiers rule, not just its mechanically-enforced subset.
