## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (cold, no reliance on evaluator's narrative):**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-proposal-contract/spec.md`, `evaluation-1.md`,
  `files-modified.md`, `workflow-state.md`, `skeptic-design-1.md`,
  `skeptic-design-2.md` in full (design docs and evaluator's report treated as
  claims, not fact).
- Read the actual diff: `git diff main...HEAD --stat` (15 files, matches
  `files-modified.md` exactly — schema, protocol, protocol spec,
  `JsonProtocols.scala` mixin, plus openspec planning artifacts only; no
  scope creep).
- Read the full content of `schemas/pipeline-proposal.schema.json`,
  `backend/src/main/scala/com/helio/api/protocols/PipelineProposalProtocol.scala`,
  `backend/src/test/scala/com/helio/api/protocols/PipelineProposalProtocolSpec.scala`,
  and the `JsonProtocols.scala` diff directly — not summarized from the
  evaluator's report.

**Acceptance criteria traced to real code:**
1. Schema (`pipeline-proposal.schema.json`) requires `pipelineName`/`source`/
   `outputDataTypeName`/`steps`; no id field anywhere in the schema or
   `$defs`. Verified by reading the file directly.
2. `PipelineProposalProtocol.scala`'s hand-written `RootJsonFormat`s mirror
   `DashboardProposalProtocol.proposalPanelFormat`'s write-omits-absent-key /
   read-tolerates-absent-key style — confirmed line-by-line (`.foreach` on
   write, `.get(...).map(...).getOrElse(deserializationError(...))` on read).
3. Inline-source branch reuses `CsvSourceConfigPayload`/`RestApiConfigPayload`/
   `SqlSourceConfigPayload`/`StaticDataPayload` from `DataSourceProtocol` — no
   new DTOs; only `PipelineProposalSource`/`PipelineProposal` are new case
   classes, and `steps` reuses `CreatePipelineStepRequest` verbatim
   (confirmed: `steps: Vector[CreatePipelineStepRequest]`, no new step type).
   The deviation from the ticket's literally-named `SqlCreateSourceRequest`/
   `CreateSourceRequest` wrapper types to their inner per-kind config payloads
   was explicitly flagged and accepted in `skeptic-design-1.md`'s non-blocking
   notes as satisfying the AC's actual intent ("no duplicate DTOs") — this is
   a documented, reviewed reinterpretation, not a silent one.
4. `sbt test` — reproduced fresh myself (not trusted from the report): **full
   suite 2476/2476 passed, 145 suites, 0 failed** (96s run). Isolated re-run
   of `testOnly com.helio.api.protocols.PipelineProposalProtocolSpec` →
   **12/12 passed**, test names match the file's own `it`/`should` blocks.
5. Additive-only confirmed directly from the diff: only new files plus a
   4-line mixin + doc-comment addition to `JsonProtocols.scala`
   (`git diff main...HEAD -- backend/src/main/scala/com/helio/api/JsonProtocols.scala`
   read in full — two hunks, no other changes). No route/service/repository/
   migration touched.

**Design decisions D1–D5 verified directly in the code, not just cited:**
- D1/D5 (single shared `"config"` wire key, not four per-kind keys): the
  writer's four `.foreach` calls all write to `fields("config")`
  (`PipelineProposalProtocol.scala:60-63`); the reader dispatches on `type`
  to decode a single `"config"` key (`:69-78`). The schema's
  `$defs.PipelineProposalSource` has exactly one `config` property (not four).
  Tests assert this directly: `"serialize the inline source's config under a
  single shared 'config' key"` and `"not emit csvConfig/restConfig/
  sqlConfig/staticConfig field names anywhere on the wire"` — both reproduced
  passing above.
- D2 (steps reuse `CreatePipelineStepRequest` verbatim) — confirmed, no new
  step DTO.
- D3 (`type` fields unconstrained in the schema, backend registry
  authoritative) — confirmed: `PipelineProposalStep.type` is
  `{"type": "string", "minLength": 1}`, no enum.
- `outputDataTypeName` matches the existing field name on
  `CreatePipelineRequest` (`grep` confirms `PipelineProtocol.scala:11,20`).

**Design-gate history genuinely resolved, not just asserted resolved:** read
both `skeptic-design-1.md` (REFUTE — design.md D1/D5's four-differently-named
wire-key implication contradicted `tasks.md`/`spec.md`'s single-`config`-key
description) and `skeptic-design-2.md` (CONFIRM — verified the documents were
reconciled, with the shipped code today matching resolution option (a)
exactly, plus the new regression test 3.7).

**Independently re-ran every gate myself, fresh, in this worktree (not
trusted from the evaluation report):**
- `cd backend && sbt test` → **2476/2476 passed, 0 failed** — reproduced,
  matches evaluator's claimed count exactly.
- `sbt "testOnly com.helio.api.protocols.PipelineProposalProtocolSpec"` →
  **12/12 passed**.
- `npm run check:schemas` → `schemas in sync with JsonProtocols (37 checked
  across 30 protocol files)` — clean.
- `npm run check:scala-quality` → clean (84 pre-existing soft file-size
  warnings, none for the two new files — reproduced the exact same warning
  list the evaluator cited).
- `npm run format:check` → clean.
- `npm run lint` → clean, 0 warnings/errors.
- `openspec validate pipeline-proposal-schema-protocol --strict` → `Change
  'pipeline-proposal-schema-protocol' is valid`.
- `npm run check:openspec` → flags only the expected "complete (13/13) but
  not archived" hygiene item — confirmed this is the intended pre-archive
  state at this point in the workflow (archiving is the orchestrator's Phase
  3 step, not the executor's), and confirmed the commit message
  (`git log -1 --format=%B 94c643e6`) explicitly names this one bypassed
  check per CONTRIBUTING.md's bypass-disclosure requirement.

**CONTRIBUTING.md compliance, checked directly:**
- No inline FQNs from `FQN_PREFIXES` (`check-scala-quality.mjs:33-46`) in
  either new file. The one inline qualifier present,
  `scala.collection.mutable.Map[String, JsValue]()`
  (`PipelineProposalProtocol.scala:56`), is not in `FQN_PREFIXES` (`scala.`
  isn't listed) and is byte-for-byte precedent-consistent with the existing
  `DashboardProposalProtocol.scala:66`
  (`scala.collection.mutable.Map[String, JsValue](` — confirmed via `grep`)
  — not a new violation introduced by this ticket.
- No dead code, no TODO/FIXME/XXX in either new file.
- No scope creep — diff stat matches `files-modified.md` exactly.

**Phase 3 (UI review) — correctly N/A.** `git diff --name-only main...HEAD`
touches no `frontend/**`, no `ApiRoutes.scala`, no canonical
`openspec/specs/**` tree (only this change's own delta directory). No server
start / screenshots required for this ticket — it ships a schema file and
backend case classes/protocol only.

### Verdict: CONFIRM

Every acceptance criterion traces to real, independently-reproduced evidence:
the schema is id-free with the required fields, the protocol round-trips and
tolerates absent optionals (12/12 tests, reproduced), the inline-source
branch reuses existing per-kind config payload types with no duplicate DTOs
(and the one reinterpretation of the ticket's literal reuse-candidate names
was explicitly design-gate-reviewed, not silent), the full backend suite is
green (2476/2476, reproduced fresh), and the change is additive-only by diff
inspection (no existing route/service/repository/wire shape touched). The
one prior design-gate contradiction (round 1) was genuinely fixed, not just
asserted fixed — I independently confirmed today's shipped code matches the
resolved single-`"config"`-wire-key design and that a regression test
(3.7/tested above) would catch a future silent reversion. No UI surface to
judge (correctly N/A). This ships.

### Non-blocking notes

- `check-schema-drift.mjs` only compares each schema *file's* top-level
  `title`/`properties` against a same-named top-level case class; it does not
  descend into `$defs` sub-schemas (e.g. `PipelineProposalSource`), so the
  single-shared-`"config"`-key wire shape is verified only by the hand-written
  ScalaTest assertions (tasks.md 3.7), not by the automated drift checker.
  This is a pre-existing structural limitation of that script shared by
  `ProposalPanel`'s identically-shaped fields, not something this ticket
  weakens — flagging only so a future ticket touching this area knows the
  drift checker's actual coverage boundary.
- Environmental note (not a code issue): this worktree's `scripts/concertino/`
  was missing `next-report-number.sh`, `persist-evidence.sh`, and
  `emit-event.sh` (present in the main checkout's gitignored, generated
  tooling directory but apparently not copied into this worktree at setup
  time). I copied those three scripts from the main checkout
  (`/home/matt/Development/helio/scripts/concertino/`) into this worktree so
  the standard collision-safe-filename / durable-evidence / event-emission
  steps of my own reporting protocol could run as specified — these are
  gitignored generator-output tooling files, not part of the ticket's diff
  or code under review, and this is worth surfacing to the orchestrator/user
  as a worktree-setup gap independent of this ticket's disposition.
