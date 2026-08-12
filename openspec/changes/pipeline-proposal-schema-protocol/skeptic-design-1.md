## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-proposal-contract/spec.md` in full.
- Cross-checked every reused type the plan names against the real source:
  - `DashboardProposalProtocol.scala` — confirmed the hand-written
    `RootJsonFormat[ProposalPanel]` pattern (`.foreach` write-omits-absent-key,
    `.get(...).map(...)` tolerant read) that design.md D5 says
    `PipelineProposalProtocol` will mirror. Confirmed: each `Option` field's
    wire key is literally the Scala field name (e.g. `p.fieldMapping.foreach(v
    => fields("fieldMapping") = v)`).
  - `DataSourceProtocol.scala` — confirmed `CsvSourceConfigPayload`,
    `SqlSourceConfigPayload`, `RestApiConfigPayload`, `StaticDataPayload`,
    `StaticColumnPayload`, `SqlCreateSourceRequest`, `CreateSourceRequest`,
    `StaticDataSourceRequest` all exist exactly as design.md's Context
    describes (line numbers 115–181).
  - `PipelineStepProtocol.scala:138` — confirmed `CreatePipelineStepRequest(type:
    String, config: JsObject)` with `jsonFormat2` at line 296, matching design.md
    D2/tasks.md 2.2 verbatim.
  - `PipelineProtocol.scala:8-13` — confirmed `outputDataTypeName` is the
    existing field name on `CreatePipelineRequest`, matching the ticket's
    chosen field name.
  - `domain/PipelineStep.scala:142-174` (`PipelineStepKind`) — confirmed
    `All: Set[String] = PipelineStep.Registry.keySet` is registry-derived, not
    a hard-coded list, backing design.md D3's rationale for leaving `type`
    unconstrained in the schema.
  - `JsonProtocols.scala:41-61` — confirmed the trait-stack mixin pattern
    (`with DashboardProposalProtocol`) tasks.md 2.4 plans to replicate.
  - `git status`/`git log` in the worktree — confirmed no code has been
    touched yet (design gate, pre-execution), so this review is purely against
    the plan documents and ground-truth precedent code.

### Verdict: REFUTE

### Change Requests

1. **The plan's own artifacts disagree with each other on the inline-source
   wire shape — this is a real contradiction, not a nitpick, because it hits
   the exact type the ticket calls out as the hard part.**

   - `design.md` D1 (lines 52-61) specifies the Scala shape as **four
     separately-named, separately-typed `Option` fields**: `csvConfig`,
     `restConfig`, `sqlConfig`, `staticConfig`. Given D5's explicit
     instruction to mirror `ProposalPanel`'s writer (wire key == Scala field
     name, confirmed above against `DashboardProposalProtocol.scala`), the
     wire object this produces has keys literally named `csvConfig` /
     `sqlConfig` / etc. — a different key per source kind.
   - `tasks.md` 1.1 describes the JSON Schema's `PipelineProposalSource` as
     `sourceId OR type/name/config` — a single, generically-named `config`
     property.
   - `specs/pipeline-proposal-contract/spec.md`'s "Source is an existing
     reference or an inline spec" requirement and its "Inline-source form
     validates" scenario both say the inline branch supplies `type`, `name`,
     and **"a `config` object"** — again one field named `config`, and its
     example literally shows `type: "sql"` + a `config` object (not
     `sqlConfig`).

   These cannot both be implemented as written: an engineer building the
   schema per tasks.md/spec.md produces a property named `config`; an
   engineer building the protocol per design.md D1 (as tasks.md 2.1 itself
   instructs: "per design.md D1 (flat `Option`-per-kind fields:
   `csvConfig`/`restConfig`/`sqlConfig`/`staticConfig`...)") produces four
   differently-named keys instead. Whichever gets implemented, the other
   artifact is now wrong, and ticket.md's AC #2 ("Backend `PipelineProposal`
   protocol round-trips the schema") is unverifiable as planned — tasks.md's
   test list (3.1–3.7) only round-trips the Scala protocol against itself; no
   task validates the protocol's JSON output against
   `schemas/pipeline-proposal.schema.json`, so this divergence would ship
   silently.

   This isn't an arbitrary call between two equally-valid options either:
   there's a real, established codebase convention on both sides that the
   plan should reconcile against, not invent a third:
   - The single-`config`-keyed-by-`type` shape is precisely how
     `create-panel-request.schema.json` already models
     "`config` shape varies by `type`" at the JSON-Schema level (`if/then` on
     `type`, one `config` property, verified via `grep -n "\"config\"" schemas/*.json`),
     and how `CreatePipelineStepRequest`, `CreateSourceRequest`,
     `SqlCreateSourceRequest`, and the `DataSourceResponse` ADT
     (`DataSourceProtocol.scala:29-96`, doc comment: "Each subtype emits its
     own typed `config` payload") all name the per-kind payload field on the
     wire — always `config`, never `csvConfig`/`sqlConfig`.
   - The four-separately-named-`Option`-fields shape is precisely how
     `ProposalPanel` (`DashboardProposalProtocol.scala`) already models
     "several kind-dependent facets coexist as options on one case class" —
     but there each field is a genuinely distinct *concept*
     (`content`/`url`/`orientation`/`chartType`), not four typed variants of
     the *same* concept ("this source kind's config").

   **Required revision**: pick one and align all three documents before
   execution starts:
   - (a) Single wire key `config` (matching the `CreatePipelineStepRequest`/
     `DataSourceResponse`/`create-panel-request.schema.json` precedent): keep
     `design.md`'s four typed `Option` fields for Scala type-safety
     internally, but state explicitly in D1/D5 that the hand-written
     formatter serializes whichever one is populated to wire key `"config"`
     (not to its own field name) and, on read, decodes `"config"` against the
     concrete payload type selected by `type`. Update tasks.md 2.1/2.3 to say
     so explicitly. `tasks.md`/`spec.md` need no change under this option. OR
   - (b) Four wire keys (`csvConfig`/`restConfig`/`sqlConfig`/`staticConfig`,
     matching `design.md` D1/D5 as literally written): update `tasks.md` 1.1
     and `spec.md`'s "Source is an existing reference or an inline spec"
     requirement + its "Inline-source form validates" scenario to describe
     four optional per-kind properties instead of one `config` property.

   Either resolution is fine; shipping the three documents as they currently
   stand is not, since they describe two different wire contracts for the
   same field.

### Non-blocking notes

- `design.md` D3 (line 76) says hard-coding the ticket's illustrative op list
  would "go stale against the other 10 already-shipped ops" but then lists 12
  op names (`datebucket/pivot/window/unpivot/dedupe/fillnull/stringops/union/
  lookup/splittext/extractheadings/chunkbytokencount`). Confirmed via
  `PipelineStepKind` (`domain/PipelineStep.scala:142-165`) that the real count
  beyond the ticket's 10-op list is 12, not 10. Doesn't affect the decision
  (still registry-derived, unconstrained `type`), just a stale count in the
  prose — worth a one-word fix but not blocking.
- Everything else checked out cleanly: no placeholders/TODOs, no scope drift
  (schema + protocol + tests only, no route/service/repository as ticket
  requires), the deviation from the ticket's literally-named reuse candidates
  (`SqlCreateSourceRequest`/`CreateSourceRequest` as outer wrappers) to their
  inner per-kind config payloads is well-justified in `design.md`'s Context
  section and still honors the AC's "no duplicate DTOs" intent, and the
  Non-Goals/Out-of-scope sections line up with `ticket.md`'s own Out of scope.
