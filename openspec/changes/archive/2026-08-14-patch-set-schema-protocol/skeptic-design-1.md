## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

I read all five planning artifacts (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/patch-set-contract/spec.md`) and cross-checked every factual claim the design makes about
existing backend/schema source against the actual files in the worktree (no implementation has
started — `git diff main...HEAD` for `backend/` and `schemas/` is empty; only the untracked
`openspec/changes/patch-set-schema-protocol/` planning artifacts exist).

1. **All six reused `Update*Request` case classes + formats exist exactly as claimed.**
   - `UpdatePanelRequest(title, appearance, type, config)` — `PanelProtocol.scala:70-75`, custom
     `RootJsonFormat` at `177-200` (config/appearance raw `JsValue`, exactly as design.md's Context
     section describes).
   - `UpdateDashboardRequest(name, appearance, layout)` — `DashboardProtocol.scala:41-45`,
     `jsonFormat3` at line 212.
   - `UpdateDataSourceRequest(name: Option[String])` — `DataSourceProtocol.scala:106`, `jsonFormat1`
     at line 439.
   - `UpdateDataTypeRequest(name, fields, computedFields)` — `DataTypeProtocol.scala:25-29`,
     `jsonFormat3` at line 69.
   - `UpdatePipelineRequest(name: String)` — `PipelineProtocol.scala:14` — **confirmed `name` is
     non-`Option` (required)**, `jsonFormat1` at line 81, exactly matching design.md D1's claim
     that this ticket adds no extra required-field handling for it.
   - `UpdatePipelineStepRequest(type, config, position)` — `PipelineStepProtocol.scala:142`,
     `jsonFormat3` at line 297.
   - None of the five plain-`jsonFormatN` formats add an "at least one field present" check —
     confirmed by reading each. That check does live in `PanelServiceHelpers.resolvePatch`
     (`backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala:44`: `if
     (resolved.hasAnyField) Right(()) else Left("at least one field is required")`), a
     service-layer concern this ticket correctly does not touch — design.md's claim is accurate.

2. **`PipelineProposalSource`'s multi-`Option`-behind-one-wire-key precedent is real and matches
   the description.** Read `PipelineProposalProtocol.scala:20-105` in full: four `Option` config
   fields (`csvConfig`/`restConfig`/`sqlConfig`/`staticConfig`) collapse to one `"config"` wire key
   on write, dispatched by the sibling `type` field on read — the exact pattern D1 says `Edit`
   will mirror for its six patch fields.

3. **`DashboardProposal`'s `jsonFormat2`-despite-required-fields precedent is real.**
   `DashboardProposalProtocol.scala:49,114-116`: `DashboardProposal(dashboardName: String,
   panels: Vector[ProposalPanel])` uses plain `jsonFormat2` with no custom reader — confirms D4's
   claim that `PatchSet`/`EditTarget` can safely use plain `jsonFormat2` too.

4. **`check-schema-drift.mjs`'s `$defs`-blindness claim is real**, read the full script
   (`scripts/check-schema-drift.mjs:100-135`): it iterates `readdirSync(schemasDir)` for
   `*.schema.json` **files** and diffs each file's top-level `title`/`properties` against a
   matching case class — it never descends into `$defs`. Confirmed `PipelineProposalSource` and
   `ProposalPanel` are indeed nested `$defs` inside their parent's single schema file
   (`pipeline-proposal.schema.json:28`, `dashboard-proposal.schema.json:20`), never standalone
   files — exactly the established pattern D6 says `Edit`/`EditTarget` will follow. `PatchSet`'s
   own top-level shape (`summary?`, `edits`) will match a `PatchSet(summary, edits)` case class
   1:1, so the drift check will pass without a `SKIP` entry.

5. **The `create-panel-request.schema.json` `if`/`then` discriminated-shape precedent is real.**
   Read the full file: nine `allOf`/`if`/`then` blocks conditionally constrain `config` based on
   `type`. The technique (conditional schema composition via `allOf`/`if`/`then`) is the same one
   D3 proposes for requiring `target.id` when `op` ∈ {update, delete} — a valid, already-used
   JSON Schema 2020-12 technique in this codebase, applied to a new location (nested
   `target.required`) but not a new technique.

6. **The "no standalone schema file for the six `Update*Request` shapes" claim is accurate
   enough to be non-misleading.** `schemas/update-dashboard-request.schema.json` exists, but its
   `title` is `UpdateDashboardBatchRequest` (matching `UpdateDashboardBatchRequest`, not
   `UpdateDashboardRequest`) and nests the actual per-field shape as an anonymous, unnamed object
   under `properties.dashboard` — there is no `$id`/`title` a `$ref` could cleanly target as
   "the `UpdateDashboardRequest` schema." The design's rationale for prose-only documentation
   over `$ref` holds.

7. **No naming collision.** `openspec/specs/` has no existing `patch-set-contract` capability
   (checked `find openspec/specs -maxdepth 1 -type d`); the closest sibling,
   `pipeline-proposal-contract`, is unmodified by this change, matching D5's characterization.

8. **`JsonProtocols.scala`'s trait-mixing structure matches tasks.md 1.3's plan.** Confirmed the
   `JsonProtocols` trait's `extends`/`with` list (`JsonProtocols.scala:54-81`) already groups
   `DashboardProposalProtocol`/`PipelineProposalProtocol`/`CombinedProposalProtocol`/
   `PipelineAnalyzeProposalProtocol` together — a natural, low-risk insertion point for
   `PatchSetProtocol`.

9. **Acceptance-criteria traceability** — all 5 ACs in `ticket.md` map cleanly onto tasks:
   AC1→1.1, AC2→1.2+2.1, AC3→1.1 (schema `if`/`then`) +1.2 (backend `deserializationError`),
   AC4→2.2, AC5→ Impact section (no existing files touched besides one additive `with
   PatchSetProtocol` line). No AC is left uncovered; no task is unscoped drift beyond the ACs.

10. **No placeholders/TBDs/deferred decisions that block implementation.** Every open question
    (create-op patch typing, content-level patch validation, whether `Edit` gets its own schema
    file) is explicitly resolved with a stated rationale (D2/D3/D6, Non-Goals), not deferred.

### Verdict: CONFIRM

The design is sound and implementation-ready. Every load-bearing claim about existing backend
source (case-class shapes, formats, the `PipelineProposalSource`/`DashboardProposal` precedents,
`check-schema-drift.mjs`'s behavior, the `create-panel-request.schema.json` `if`/`then` pattern)
checks out against the actual files, not just the design doc's prose. Scope is well-bounded
(explicit non-goals for apply logic, typed create-patch, content-level patch validation), the
six ACs trace cleanly to tasks, and the two enforcement layers (schema `if`/`then` + backend
`deserializationError`) for `target.id` are each independently verifiable via the planned tests.

### Non-blocking notes

1. **Silent `patch`-on-`delete` drop is unspecified but not tested either way.** Per D1/tasks.md
   1.2, `op: delete` leaves all seven patch-carrier fields `None` regardless of whether the wire
   JSON's `"patch"` key was populated — i.e. if a caller sends a delete edit with a non-empty
   `patch`, that data is silently discarded on read (and won't round-trip). This is a reasonable
   choice given `patch` is documented as "unused" for delete, and the ticket's Non-Goals
   explicitly excludes patch-content validation — but the planned test list (tasks.md 2.1) doesn't
   cover this specific case (a delete edit *with* a populated `patch`), only "an Edit's `patch`
   absent (e.g. a delete edit)". Worth a one-line test during implementation for documentation
   value, not a design blocker.
2. **Worktree tooling gap (unrelated to the change under review):** this worktree's
   `scripts/concertino/` was missing `next-report-number.sh`/`persist-evidence.sh`/
   `emit-event.sh`/several other scripts present in the main checkout (the directory is
   gitignored and apparently wasn't fully provisioned for this worktree). I copied the missing
   scripts from `/home/matt/Development/helio/scripts/concertino/` (byte-identical content to the
   files this worktree already had) so I could complete this report via the canonical procedure.
   This is a provisioning gap orthogonal to `patch-set-schema-protocol`'s design soundness, but
   worth flagging so the same gap doesn't silently block the executor/evaluator later in this
   ticket's lifecycle.
