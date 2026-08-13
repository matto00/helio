## Context

Two existing, unmodified services do all the real work: `DashboardProposalService.apply` (validates,
creates a dashboard+panels atomically, rolls back the dashboard on its own internal failure) and
`PipelineProposalService.apply` (validates, creates source(if inline)+pipeline+steps+run atomically,
rolls back internally on its own failure — see that service's own design.md, HEL-383, for the FK-cascade
reasoning its rollback order depends on). Neither knows about the other. This ticket's only real job is
sequencing + one missing capability: **`PipelineProposalService` has no way to undo an already-successful
`apply` from outside** — its rollback is private, triggered only by its own internal failures. A combined
proposal needs exactly that: pipeline succeeds, dashboard fails later, undo the pipeline.

`ProposalPanel.dataTypeId: Option[String]` (and, for non-`DataPanelKinds` panels, `config.dataTypeId`)
is the existing binding slot `DashboardProposalService`/`ProposalPanelSupport` already validate against
a real, caller-owned, pipeline-output DataType (`ProposalPanelSupport.bindingCandidate` = flat field,
else `config.dataTypeId` for non-data-panel kinds). The combined proposal's only new requirement is
letting that slot carry a placeholder for an id that doesn't exist yet at proposal-authoring time.

## Goals / Non-Goals

**Goals:**
- Atomic source+pipeline+run+dashboard+panels from one request.
- Zero changes to `ProposalPanel`, `DashboardProposalProtocol`, `DashboardProposalService`, or any
  existing `PipelineProposalService` method's signature/behavior.
- Rollback of the pipeline+source when the (already-atomic) dashboard phase fails.

**Non-Goals:**
- NL authoring, multi-pipeline proposals, frontend UI (ticket's own Out of Scope).
- Re-validating anything `DashboardProposalService`/`PipelineProposalService` already validate — this
  service adds exactly one new check (sentinel-position validity) and nothing else.

## Decisions

**D1 — The pipeline-output reference is a reserved sentinel string, `"$pipelineOutput"`, carried in the
EXISTING `dataTypeId`/`config.dataTypeId` slot — not a new field on `ProposalPanel`.** Considered adding
a typed field (e.g. `outputRef: Option[Boolean]`) directly to `ProposalPanel`; rejected because
`ProposalPanel` is a widely-shared type (propose_dashboard, apply_proposal, replace_dashboard_contents,
and every MCP tool built on `panelSchema`) — any change there, however additive, increases the blast
radius `DashboardProposalService`/`ProposalPanelSupport` (which would ALSO need modification to treat
that field as "resolvable, not missing") touch. The sentinel approach requires zero changes to any of
those: the combined service does a pure textual substitution pass on an ordinary `DashboardProposal`
value BEFORE handing it to the completely unmodified `DashboardProposalService.apply`. `$` is never
legal in a UUID, so collision with a real id is not a practical concern; the JSON Schema's description
documents the sentinel explicitly (matching this codebase's established preference for descriptive text
over structural enforcement — HEL-379 design.md D3's own reasoning).

**D2 — "Dangling ref" (the ticket's own AC) is validated structurally, BEFORE the pipeline is applied,
by checking the sentinel appears ONLY in the ONE blessed position `bindingCandidate` would actually
read for that specific panel's real state — never a kind-unconditional "either slot is fine" check, and
never merely "the flat field doesn't equal the sentinel."** **Round-1 skeptic correction:**
`ProposalPanelSupport.bindingCandidate` is `panel.dataTypeId.orElse(nonFlatConfigDataTypeId(panel))`,
where `nonFlatConfigDataTypeId` returns `None` outright for any `DashboardProposalService.DataPanelKinds`
panel (`metric`/`chart`/`table`/`collection`/`timeline`) — so `config.dataTypeId` is **never** consulted
for those kinds, only for panel types outside that set. **Round-2 skeptic correction:** `Option.orElse`
only evaluates its argument when the receiver is `None` — `bindingCandidate` falls through to
`config.dataTypeId` only when the flat `dataTypeId` is **absent entirely**, not merely "not equal to the
sentinel." A non-`DataPanelKinds` panel whose flat `dataTypeId` already holds some OTHER real id never
has `config.dataTypeId` consulted at all, sentinel or not. The blessed-position check must mirror both
facts together, per panel: the flat `dataTypeId` is the blessed slot if it holds the sentinel;
`config.dataTypeId` is the blessed slot ONLY when `panel.type` is outside `DataPanelKinds` AND the flat
`dataTypeId` is absent (`isEmpty`) — never merely non-sentinel-valued.

Implementation: for each panel, build a copy with the ONE legitimate blessed occurrence (if any)
stripped out — clear the flat `dataTypeId` if it equals the sentinel; else, only when `panel.type` is
outside `DataPanelKinds` AND the flat `dataTypeId` is absent, clear `config.dataTypeId` if it equals the
sentinel — then re-serialize that cleared copy to JSON and check whether the sentinel string still
appears anywhere in it. If it does, the panel has one of: no blessed slot at all for its kind (the
kind-mismatch case), a blessed `config.dataTypeId` slot that's actually shadowed because the flat field
is already set to something else (the round-2 fidelity gap), or a **second** dangling occurrence
duplicated alongside a legitimate one (round-1's second finding: a naive "does it appear anywhere, and
does it appear in a blessed slot" pair of independent booleans would let a duplicate elsewhere hide
behind a real one in `dataTypeId`) — any of the three, reject with `BadRequest`
naming the panel, before `PipelineProposalService.apply` is even called, so a dangling ref never
triggers a pipeline creation that then has to be rolled back. (If the sentinel is simply absent from a
panel, that panel keeps whatever `dataTypeId` it already had — a combined proposal MAY mix panels bound
to this call's new pipeline with panels bound to pre-existing types.)

**D3 — Actual substitution happens only after the pipeline apply succeeds, using its real
`outputDataTypeId` — a pure, in-memory `DashboardProposal` transform, never touching `PipelineProposal`
or the wire request itself.** Uses the exact same blessed-slot logic as D2 (flat `dataTypeId` if it holds
the sentinel; else, only when `panel.type` is outside `DataPanelKinds` AND the flat `dataTypeId` is
absent, `config.dataTypeId`) — since D2 already guarantees, by the time this runs, that the sentinel
appears in at most one, real, blessed slot per panel, this step is a simple, unconditional substitution
at that one location, never an ambiguous choice.

**D4 — `PipelineProposalService` gains one new public method, `rollback(response:
PipelineProposalApplyResponse, user): Future[Unit]`, additive only.** It re-derives what `apply`'s
internal rollback already knows how to delete — the pipeline (cascades steps/runs), its output DataType,
and (if `response.source` is present, meaning this call's `apply` created it inline) that source and its
companion DataType(s) — but as a NEW entry point for "this already succeeded, a step outside my own
`apply` call now needs it undone," which `apply`'s existing private `rollbackAll`/`rollbackSourceOnly`
cannot serve (they only fire on `apply`'s own internal failures). Crucially, `rollback` is called
**before any deletion has happened yet** in this fresh invocation, so a fresh
`dataTypeRepo.findBySourceId` read to find the companion DataType id(s) is safe here — unlike inside
`apply` itself, where design.md's own D5 (HEL-383) explicitly warns that query returns nothing once
issued AFTER the source delete. Composed entirely through `pipelineService.delete`/
`dataTypeService.delete`/`dataSourceService.delete` — never a raw repository call, matching every other
delete in this codebase's proposal-apply family.

**D5 — Response nests the two sub-services' own existing response types verbatim, not a new flat
shape.** `CombinedProposalApplyResponse(pipeline: PipelineProposalApplyResponse, dashboard:
DuplicateDashboardResponse)` — `DuplicateDashboardResponse` is the exact type `POST /api/dashboards/
apply-proposal` already returns. An agent who knows either standalone endpoint's response shape
recognizes both halves of the combined response immediately.

**D6 — Route: `POST /api/proposals/apply`, a brand-new top-level `pathPrefix("proposals")`.** Not nested
under `/api/dashboards/*` or `/api/pipelines/*` since it is neither exclusively — and a fresh prefix has
zero route-mount-order risk (the HEL-383 final-gate skeptic's non-blocking note, HEL-656, was about
`PipelineIdSegment`'s unconstrained-Segment matcher backtracking; a brand-new prefix shares no path
space with it or with `DashboardIdSegment`, so this route can never be shadowed or shadow anything).

**D7 — MCP: one new tool, zero schema changes to the existing `panelSchema`.** The sentinel travels
through the panel shape MCP tools already send; the new tool's description documents the literal string
value to use. Mirrors HEL-385's now-established file split (zod-free handler module for TS2589 safety)
for consistency, though this tool's own handler is simpler (no client-side pre-validation to extract —
the combined service's structural check happens server-side only, matching `apply_pipeline_proposal`'s
"pure pass-through" precedent, D6 in HEL-385's design.md).

## Risks / Trade-offs

- [A sentinel string is less discoverable than a typed field for an agent that hasn't read the tool
  description] → Mitigated by the tool/schema description stating the literal value explicitly, the
  same mitigation this codebase already relies on for `add_pipeline_step`'s unconstrained `type` string
  and HEL-385's D2 `csv`-rejected-at-apply-time note.
- [`rollback`'s fresh `findBySourceId` read assumes nothing else deletes the source between the pipeline
  apply succeeding and the dashboard apply failing] → Acceptable: this is the same non-transactional,
  app-level-rollback risk `PipelineProposalService`/`DashboardProposalService` already carry individually
  (HEL-383/HEL-225's own accepted risk), not a new one introduced here.

## Migration Plan

Purely additive: one new schema, one new protocol file, one new service, one new route, one new public
method on an existing service (no existing method touched), one new MCP tool + its client/type plumbing.
No migration. Rollback = revert the new files and the one added method.

## Open Questions

None blocking.

## Planner Notes

Self-approved: capability name `combined-proposal-apply`; sentinel value `"$pipelineOutput"` (reserved,
`$`-prefixed, never a legal UUID substring); route `POST /api/proposals/apply` under a fresh top-level
prefix rather than nesting under an existing one.
