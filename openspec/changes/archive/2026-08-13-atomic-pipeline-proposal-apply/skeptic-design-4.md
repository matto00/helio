## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Human-approved extra round after round 3's REFUTE was escalated. Re-reviewed the full
planning artifact set with fresh eyes, treating rounds 1-3's reports as claims to
re-verify, not ground truth.

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-proposal-apply/spec.md`, and all three prior `skeptic-design-{1,2,3}.md`
  in full.

**Focus 1 — is round 3's finding now correctly and completely addressed?**

- Round 3 found: `design.md` D2's pre-validation never checked that an inline source's
  `name` or its type-matched `config` field are present, even though both are legally
  absent per the real wire contract.
- Re-verified the wire contract directly (not the design's paraphrase of it):
  - `schemas/pipeline-proposal.schema.json`'s `$defs.PipelineProposalSource` (lines
    29-54) confirmed to have **no `"required"` array** — `sourceId`/`type`/`name`/`config`
    are all individually optional.
  - `backend/src/main/scala/com/helio/api/protocols/PipelineProposalProtocol.scala:20-28`
    — `PipelineProposalSource` case class: `name: Option[String]`, and
    `csvConfig`/`restConfig`/`sqlConfig`/`staticConfig` each `Option[...]`. The reader
    (lines 67-89) leaves `name` `None` if absent and leaves all four config fields `None`
    if `"config"` is absent, regardless of `type` — confirms the gap round 3 found is
    real and confirms the fix is directly implementable against these actual fields.
  - `design.md` D2 (lines 43-60) now adds, in order, before `SqlConnector.checkQuery`:
    (a) `source.name` present and non-blank →
    `BadRequest("source.name is required for an inline source")`; (b) the config field
    matching `type` is `Some` → `BadRequest("source.config is required for an inline
    source")`. Both explicitly stated as running before the query-inspection step, with
    the reasoning stated ("`sqlConfig.query` cannot be inspected if `sqlConfig` might be
    absent").
  - `tasks.md` 2.2 spells out both checks explicitly with the exact ordering and exact
    error messages — no longer left implicit via "structural pre-validation per
    design.md D1/D2" as round 3 flagged.
  - `tasks.md` 4.7 now has two new edge-case tests: inline `type` set with `name`
    omitted; inline `type` set with `config` omitted (`sql` and `rest_api`) — matching
    round 3's required revision almost verbatim, including the "at least sql/rest_api"
    scope round 3 called out as the two consequential branches (`createSql`/`createRest`
    have no name-blank guard, unlike `createStatic`).
  - Re-verified `SourceService.createSql`/`createRest`
    (`backend/src/main/scala/com/helio/services/SourceService.scala:43-86`) still have
    **no** name-blank guard, and `DataSourceService.createStatic`
    (`backend/src/main/scala/com/helio/services/DataSourceService.scala:90-97`) still
    guards `req.name.trim.isEmpty` — confirms the asymmetric risk round 3 described
    (silently-created nameless `sql`/`rest_api` source vs. a clean 4xx for `static`) is
    real and is what the new D2 checks now close for all four inline kinds uniformly.
  - Confirmed all `ServiceError` variants the design references
    (`BadRequest`/`NotFound`/`Conflict`/`UnprocessableEntity`/`BadGateway`) exist as
    written (`backend/src/main/scala/com/helio/services/ServiceError.scala:19-30`).
  - Conclusion: round 3's finding is **correctly and completely addressed**.

**Focus 2 — do rounds 1 and 2's fixes (D5 rollback ordering) still hold?**

- Re-read `design.md` D5 (lines 78-108) and `tasks.md` 2.1/2.3/2.7 in this round's files.
  Text is unchanged from what round 3 confirmed correct: companion-DataType id captured
  at create time (task 2.3) — `CreateSourceResponse.dataType.map(_.id)` for
  `rest_api`/`sql` (no extra query), one `dataTypeRepo.findBySourceId` immediately after
  `createStatic` for the `static` branch (read, while the source still exists) — then
  used at rollback time (task 2.7): delete pipeline → delete pipeline's output DataType
  via `DataTypeService.delete` → delete source via `DataSourceService.delete` → delete
  the already-captured companion DataType id(s) via `DataTypeService.delete`, never
  re-queried after the source is gone. This is the same fix rounds 1-3 iterated to;
  nothing regressed in this revision (the round only touched D2/tasks 2.2/4.7/4.10).
- Spot-re-verified the underlying facts this ordering depends on, independently:
  `DataTypeService.delete`/`checkSourceLink` no-ops on `sourceId = None`
  (`DataTypeService.scala:127-171`, unchanged); `DataSourceService.delete` ends in a
  single synchronous `dataSourceRepo.delete`
  (`DataSourceService.scala:499-516`, unchanged); `data_types.source_id ... ON DELETE SET
  NULL` fires synchronously as part of that delete
  (`V4__data_sources_and_types.sql:12`, unchanged). All still consistent with the
  captured-at-create-time ordering. Rounds 1-2's fix **still holds**.

**Focus 3 — fresh pass for any new issue.**

- Checked `tasks.md`'s new task 4.10 (static-branch mid-apply rollback test, addressing
  the round-2/3 non-blocking note) — accurately describes the distinct
  capture-at-create-time path (`findBySourceId` after `createStatic`) that 4.4's
  `rest_api`/`sql`-only coverage can't reach. Not required (was non-blocking), but
  correctly scoped and doesn't conflict with anything else in the task list. Numbered
  "4.10" placed physically between 4.7 and 4.8 rather than renumbered — cosmetic only,
  doesn't affect execution.
- Checked whether D2's new config-presence check interacts oddly with D3's unconditional
  inline-`csv` rejection: if a caller sends `type = "csv"` with `config` absent, D2's new
  check now fires first with `"source.config is required for an inline source"` rather
  than D3's dedicated `"inline csv sources are not supported by apply-proposal yet"`
  message. Both are 4xx, both create nothing, so no functional/AC regression — just a
  slightly less specific message for this one narrow edge case (type=csv with no config
  at all). Non-blocking.
- Checked `specs/pipeline-proposal-apply/spec.md`'s "Structural pre-validation creates
  nothing on a bad proposal" requirement (lines 23-28) against the now-expanded D2: its
  enumerated SHALL-list (both-set, neither-set, bad type enum, non-read-only SQL,
  bad step type/config) still does **not** mention the two new checks (inline `name`
  missing, type-matched `config` missing) that `design.md` D2 and `tasks.md` 2.2/4.7 now
  require and will test. This is a real gap between the spec-delta and design.md/tasks.md
  post-revision, one degree more incomplete than round 1's own non-blocking finding
  (there, the SHALL-text at least mentioned the case and only lacked a `#### Scenario`
  block; here the SHALL-text doesn't mention either new check at all). It does not block
  implementability — `tasks.md` 2.2/4.7 already spell out both checks and their exact
  messages unambiguously, so an implementer has nothing left to guess — but it means the
  capability spec that will later get archived into `openspec/specs/` will under-describe
  the shipped behavior unless corrected. Flagging as non-blocking per the round-1
  precedent for a same-flavor (lesser) gap, but recommend folding it in before archive:
  add both checks as additional bullets to the requirement's SHALL-text and (optionally)
  dedicated `#### Scenario` blocks, mirroring the existing "Both sourceId and inline type
  set" scenario's shape.
- No other new placeholders, contradictions, ambiguity, or scope drift found in
  `ticket.md`/`proposal.md`/`design.md`/`tasks.md` on this pass. Every AC in `ticket.md`
  still maps to a design decision and at least one `tasks.md` item; `proposal.md`'s "What
  Changes" is consistent with `design.md`'s decisions; no schema/protocol change is
  introduced beyond what `proposal.md`'s Impact section already scopes (reuses HEL-379's
  `PipelineProposal`/`PipelineProposalSource` verbatim).
- `scripts/concertino/next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh`
  are still absent from this worktree's `scripts/concertino/` (only `assert-phase.sh`,
  `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`, `README.md` present;
  `.concertino.env` also absent). Same as rounds 1-3: invoked the main checkout's copies
  (`/home/matt/Development/helio/scripts/concertino/`) against this worktree's change
  directory to produce this report and its durable copy/verdict. Flagging a fourth time
  so the worktree's `scripts/concertino/` can be re-synced.

### Verdict: CONFIRM

Round 3's finding is correctly and completely addressed (both the `name`-presence and
type-matched-`config`-presence checks are now in `design.md` D2, spelled out explicitly
in `tasks.md` 2.2, and covered by two new edge-case tests in `tasks.md` 4.7). Rounds 1
and 2's rollback-ordering fix (`design.md` D5) still holds against a fresh re-read of the
real `DataTypeService`/`DataSourceService`/FK implementations. No new blocking issue
found on this pass. Sound enough to implement.

### Non-blocking notes

1. `specs/pipeline-proposal-apply/spec.md`'s "Structural pre-validation creates nothing
   on a bad proposal" requirement's SHALL-text does not yet mention the two new
   validation checks (inline `name` missing, type-matched `config` missing) that
   `design.md` D2 / `tasks.md` 2.2 add this round. Recommend adding both as bullets (and
   ideally `#### Scenario` blocks) before this change is archived, so the capability spec
   that lands in `openspec/specs/` accurately describes the shipped behavior.
2. If an inline proposal sets `type = "csv"` with `config` entirely absent, the new D2
   check will reject it with `"source.config is required for an inline source"` rather
   than D3's more specific `"inline csv sources are not supported..."` message. Same
   outcome (4xx, nothing created), just a less-specific message for this one edge case —
   not worth special-casing.
3. (Carried forward from rounds 1-3, still non-blocking) `scripts/concertino/` in this
   worktree is still missing `next-report-number.sh`/`persist-evidence.sh`/
   `emit-event.sh`/`.concertino.env`; re-sync before the next round needs them.
