## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read fresh (cold, no reliance on the round-1 report's narrative except as
  a list of claims to re-check): `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/pipeline-proposal-contract/spec.md` in full, plus
  `skeptic-design-1.md` (treated as a claim to verify, not fact).

- **Round-1 contradiction — re-verified as resolved, via option (a).**
  Round 1 REFUTEd because `design.md` D1/D5 (as originally written) implied
  the four per-kind `Option` fields (`csvConfig`/`restConfig`/`sqlConfig`/
  `staticConfig`) would serialize to four differently-named wire keys, while
  `tasks.md` 1.1 and `spec.md`'s "Source is an existing reference or an
  inline spec" requirement both described one generic `config` wire property.
  Reading the current documents:
  - `design.md` D1 (lines 64–79) now states explicitly: **"Wire key is
    `config`, singular — not four differently-named keys."** It explains the
    four `Option` fields exist "for Scala-side type safety only" and that the
    writer "serializes *that one* to the `"config"` key," with the reader
    "dispatches on `type` to decode `"config"`" — i.e. one wire key,
    kind-selected by `type`.
  - `design.md` D5 (lines 105–112) now states the same explicitly as "the one
    deviation from a mechanical field-name-is-key mirror": the four fields
    "serialize through a single shared `"config"` key... not through four
    separate keys — everything else... follows the ordinary
    one-field-one-key rule unchanged."
  - `tasks.md` 2.1 (lines 11–17) now states: "These four fields are
    Scala-side only — on the wire they serialize through **one** shared
    `"config"` key (selected by `type`), never through four separately-named
    keys (design.md D1/D5)."
  - `tasks.md` 2.3 (lines 20–28) now spells out the formatter's write/read
    behavior against this single key explicitly.
  - `tasks.md` gained a new task **3.7**: "assert the serialized JSON's
    `source` object has a single `config` key (not `csvConfig`/`sqlConfig`/
    etc.)" — a regression test tied directly to this exact point, so a future
    divergence fails a test rather than shipping silently. The former final
    task ("run `sbt test`") is correctly renumbered **3.8**.
  - `spec.md` is unchanged from round 1 and was already consistent with the
    single-`config`-key shape (its "Inline-source form validates" scenario:
    `type: "sql"`, `name`, and "a `config` object").
  - **All three documents now agree**: one wire key, `"config"`, selected by
    `type`. This is resolution option (a) from the round-1 report, applied
    correctly and completely — no half-applied edit found (checked
    `design.md`, `tasks.md`, and `spec.md` for any leftover reference to
    `csvConfig`/`restConfig`/`sqlConfig`/`staticConfig` as a *wire* key; none
    found — those names now appear only as Scala-side field names, which
    matches the resolution).

- **Independently re-verified the ground-truth precedent the resolution
  leans on** (not just trusting design.md's citations):
  - `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala`
    — confirmed `DataSourceResponse`'s per-subtype `config` field (e.g. line
    34 `config: CsvSourceConfigPayload`, line 45 `config: RestApiConfigPayload`,
    line 56 `config: SqlSourceConfigPayload`) and the doc comment "subtype
    emits its own typed `config` payload" (line 11) — this is the real,
    already-shipped convention D1 now cites for "single `config` key varies
    by `type`."
  - `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala:138`
    — confirmed `CreatePipelineStepRequest(type: String, config: JsObject)`
    with `jsonFormat2` at line 296, exactly as D2/tasks.md 2.2 state.
  - `schemas/create-panel-request.schema.json` — confirmed `"config": {
    "type": "object" }` with `if/then` branches on `type` (lines 25–67),
    matching design.md's cited JSON-Schema-level precedent for the same
    pattern.
  - `backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala`
    — confirmed `ProposalPanel`'s hand-written `RootJsonFormat` (`.foreach`
    write-omits-absent-key, wire key == Scala field name, e.g.
    `p.fieldMapping.foreach(v => fields("fieldMapping") = v)`) — the pattern
    D5 says `PipelineProposalProtocol` mirrors for every field *except* the
    four config fields.
  - `backend/src/main/scala/com/helio/domain/PipelineStep.scala:142–174`
    (`PipelineStepKind`) — confirmed `All: Set[String] =
    PipelineStep.Registry.keySet` is registry-derived, and independently
    counted the 22 constants (`Rename`...`Lookup`) — 10 in the ticket's
    illustrative list + 12 beyond it (`SplitText, ExtractHeadings,
    ChunkByTokenCount, DateBucket, Pivot, Window, Unpivot, Dedupe, FillNull,
    StringOps, Union, Lookup`). Confirms round 1's non-blocking note (design.md
    previously said "other 10 already-shipped ops," should say 12) was also
    fixed — `design.md` line 91 now correctly reads "the other 12
    already-shipped ops."
  - `StaticColumnPayload`/`StaticDataPayload`/`StaticDataSourceRequest` —
    confirmed present in `DataSourceProtocol.scala:176-181` as design.md's
    Context section describes.

- **Re-checked the plan is otherwise sound** (round-1's non-contradiction
  findings, re-verified fresh rather than trusted):
  - No `TODO`/`TBD`/"figure out later"/placeholder text anywhere in
    `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, or `spec.md` (grep
    across all five, zero hits).
  - `tasks.md` task numbering is sequential and gap-free after the round-1
    edit (1.1; 2.1–2.4; 3.1–3.8) — the new 3.7 and renumbered 3.8 did not
    leave a stale reference or duplicate number anywhere.
  - Every AC in `ticket.md` traces to a concrete task: AC1 (schema shape) →
    1.1; AC2 (protocol round-trips + tolerates absent optionals) → 2.1–2.4,
    3.1–3.5; AC3 (inline-source reuses existing config payload types, no
    duplicate DTOs) → design.md Context + D1 + tasks 2.1; AC4 (`sbt test`
    green) → 3.8; AC5 (additive/backward-compat) → design.md Migration Plan
    + proposal.md Impact section (no route/repository/migration, no existing
    wire shape changed).
  - Scope stays within the ticket's own Scope/Out-of-scope: no apply path, no
    MCP surface, no step/source-kind validation — all correctly deferred to
    HEL-342 per design.md's Non-Goals and Open Questions.
  - `git status`/`git log` in the worktree confirm no code has been touched
    yet (still pre-execution; `openspec/changes/pipeline-proposal-schema-protocol/`
    is the only untracked path) — this remains purely a plan-artifact review.

### Verdict: CONFIRM

The round-1 contradiction is genuinely resolved — not just asserted resolved.
All three planning artifacts (`design.md`, `tasks.md`, `spec.md`) now describe
the identical wire contract (one `"config"` key, kind-selected by `type`),
the resolution matches a real, independently-verified codebase convention
(`DataSourceResponse`, `CreatePipelineStepRequest`,
`create-panel-request.schema.json`), and a new task (3.7) adds a regression
test that would catch a future silent drift back to the four-key shape. No
new contradiction, placeholder, or scope drift was introduced by the
revision. The plan is sound enough to implement.

### Non-blocking notes

- None beyond what round 1 already noted as non-blocking (the op-count typo),
  which is now also fixed.
