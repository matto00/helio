## Context

HEL-406's `PatchSetApplyService`/`PatchSetApplyRollback` already capture full prior state per edit
(`EditOutcome.priorState`/`resultingState`, response-shaped JSON — `PatchSetApplyProtocol`'s own doc
comment names this exact future undo path as the reason those fields reuse each kind's REAL response
shape rather than inventing a new one) and already implement a per-kind "restore" matrix for
rollback-on-failure. `PatchSetApplyRollback.rollback`, however, operates on in-memory `ResolvedEdit`
(a domain-typed `prior: Panel`/`Dashboard`/etc.) that exists only for the duration of one apply call
— nothing this ticket can reach once the call has returned. Only `EditOutcome`'s JSON survives.

## Goals / Non-Goals

**Goals:**
- Persist enough of a successful apply's `EditOutcome`s to reconstruct the SAME per-kind restore
  logic `PatchSetApplyRollback` already has, later, from JSON alone.
- Atomic, conflict-safe undo: either every edit restores, or (on any conflict) none does.
- Bounded retention; additive MCP/in-app surfaces.

**Non-Goals:** multi-level undo/redo; undoing a partially-rolled-back apply (Non-Goals, proposal.md).

## Decisions

**D1 — Journal schema.** New `patch_set_applications` (V79 — next after HEL-411's V78): `id TEXT PK,
owner_id UUID, applied_at TIMESTAMPTZ, edits JSONB, created_at TIMESTAMPTZ`. `edits` is a JSON array —
the JOURNAL's own record shape, distinct from the `/apply` wire response's `EditOutcome` — one entry
per applied edit: `{index, targetKind, op, priorState, resultingState, newId, rawResultingConfig}`.
`targetKind`/`op` come from the original `Edit`; `rawResultingConfig` (panel `update` only) reaches
the journal via a channel separate from `EditOutcome` entirely (D2a) — neither ever touches the
`/apply` response. Owner-scoped RLS, same `FORCE ROW LEVEL SECURITY` +
`owner_id = current_setting('app.current_user_id')::uuid` pattern `V77__authoring_conversations.sql`
establishes (`V78` only `ALTER TABLE ADD COLUMN`s onto that already-RLS-enabled table).

**D2 — When to journal.** `PatchSetApplyService.apply` journals ONLY when `PatchSetApplyResponse.
failure.isEmpty` (every edit's status is `applied`, no rollback occurred) — a partially-rolled-back
apply has nothing coherent to undo beyond what the rollback already restored (proposal.md Non-Goal).
The write happens synchronously, inside `applyResolved`'s own terminal success branch (the same
branch D2a's raw-config accumulator is read from), before `apply` returns its response — not
fire-and-forget, since the response's new `applicationId` field depends on it.

**D2a — Panel UPDATE edits ALSO capture a raw, unmaterialized config snapshot, via a fetch and an
accumulator BOTH entirely separate from `EditOutcome`/`applyOne`/`rollback`'s existing shapes
(round-3 capture-unmaterialized-snapshot decision; round-4 wire-leak fix; round-5 rollback-signature
fix).** `resultingState` for a `panel` `update` edit comes from `panelService.update`'s materialized
return (`resolveSingleBinding`) — for a bound `MetricPanel`, its `dataTypeId`/`fieldMapping`/
`aggregation`/`unit` there are the metric's EFFECTIVE values, byte-identical to a genuine raw override
once present (why D4a's earlier strip-or-compare choice was insufficient). A `create` edit needs no
fetch — `PanelService.create` never materializes, so its `Panel` is already raw. The extra fetch —
ONE bare `panelRepo.findByIdInternal(id)` call, the SAME method `priorState` already uses — happens
in `PatchSetApplyService.applyResolved`'s OWN loop, not inside `PatchSetApplyForward.applyOne`:
`applyResolved`'s enclosing class already has `panelRepo` as a constructor field (`PatchSetApplyService.
scala:45`), so no `PatchSetApplyContext`/`applyOne` signature change is needed at all — `applyOne`'s
return type stays exactly `Future[Either[ServiceError, EditOutcome]]`, untouched. The raw-config value
is collected into a SEPARATE, index-keyed accumulator (`Map[Int, JsValue]`) built alongside `applied`
in the SAME loop, never merged into `applied: Vector[(ResolvedEdit, EditOutcome)]` itself — so the
failure path's existing call, `PatchSetApplyRollback.rollback(appliedSoFar, user, services)`, keeps
receiving the exact 2-tuple shape its signature already expects, completely undisturbed. Only the
terminal SUCCESS branch reads the separate accumulator, to build the journal payload alongside
`applied.map(_._2)` (still exactly `PatchSetApplyResponse.edits`, unchanged). `EditOutcome` gains no
field either way, so it can never leak onto the `/apply` wire response.

**D3 — Retention: count-based, not TTL.** On each journal write, prune rows beyond the 20
most-recent for that owner in the SAME write (no background job — this codebase has none, and a TTL
would need one), via a single atomic `DELETE ... WHERE owner_id = ? AND id NOT IN (SELECT id ...
ORDER BY applied_at DESC LIMIT 20)` — the same self-converging, idempotent-under-concurrent-writers
shape `PipelineRunRepository.deleteOldRunsInternal` already uses, never a non-atomic
SELECT-then-DELETE round trip. `applicationId` returned to the caller either way; a pruned-away id
later 404s on undo exactly like an unowned/nonexistent one — no special-cased response.

**D4 — `PatchSetUndoService`: two-phase, mirroring `PatchSetApplyService`'s own pre-validate-then-act
shape.** Phase 1 (all edits, no mutation): load the journal row (RLS + owner check, 404 otherwise),
then for EVERY journaled edit determine eligibility before any mutation — an `update`/`create` edit
runs the D4a conflict check; a `panel`/`pipelineStep` `delete` (recreatable) is always eligible; a
`dashboard`/`dataSource`/`dataType`/`pipeline` `delete` (structurally unrecoverable — D5) is ALWAYS a
Phase-1 blocker, exactly like a conflict — no live state to check, but "cannot honor the
all-or-nothing guarantee" either way, so it fails the same gate before Phase 2 starts (mirrors
`resolveAll` running fully before `PatchSetApplyForward` begins). ANY Phase-1 blocker aborts the WHOLE
undo with `409`, naming every blocking edit and its reason, restoring nothing. Phase 2: reverse-walk
the edits (matching `PatchSetApplyRollback`'s own reverse order), restoring each via the SAME
per-kind service method rollback already uses. A genuine Phase-2 runtime failure (unforeseeable by
Phase 1 — e.g. a delete-edit's recreate target parent independently deleted since apply) aborts the
REMAINDER of the walk and reports every not-yet-reached edit `notAttempted`; edits already restored
earlier in this SAME walk are NOT compensated back. This is a documented, narrower guarantee than
Phase 1's — `specs/patch-set-undo/spec.md` carries its own explicit Requirement + Scenario for this
carve-out, a real, named third guarantee tier alongside "fully restored"/"fully refused," mirroring
`PatchSetApplyRollback`'s own "never silently overclaims" precedent for its `unrecoverable` tier.

**D4a — Conflict-check equality is field-scoped, not whole-JSON — and for `panel`, `config` is
DECOMPOSED, never compared as one opaque blob.** A naive whole-`XResponse` JSON-equality check is
UNSOUND: `PipelineSummaryResponse.lastRunStatus`/`lastRunAt`/`lastRunRowCount` update on every
pipeline run (scheduled, manual, or hook-triggered — HEL-340, shipped) independent of any patch-set
edit, with no real field to compare instead — `pipeline`'s comparison simply never includes these
three, outside the `name`-only field `PatchSetApplyRollback`'s `PipelineUpdate` case restores. For
every kind whose restored fields are scalar/structural (`pipeline`'s `name`; `dashboard`'s `name`/
`appearance`/`layout`; `dataSource`'s `name`; `dataType`'s `name`/`fields`/`computedFields`;
`pipelineStep`'s `type`/`config`/`position`), comparing exactly D5's restored fields is enough.
`panel`'s `config` needs two different treatments for two different kinds of noise: `metricDeprecated`
(metric/chart/table) is genuinely never patch-decodable (`optionalConfigFieldNames` already excludes
it) — stripped from both sides, unconditionally. `MetricPanelConfig`'s four metric-materialized
EFFECTIVE fields (`dataTypeId`/`fieldMapping`/`aggregation`/`unit`, when `metricId` is set) are
different: round 3 found they ARE real, independently-settable, patch-decodable raw fields whose
materialized value is byte-identical to a genuine raw override once present, so stripping them (an
earlier revision) silently hides a real conflict from an independent raw-field edit. D2a's
`rawResultingConfig` closes this properly instead: for these four fields, compare the CURRENT live
panel's raw config (same unmaterialized `findByIdInternal` path) against the journaled
`rawResultingConfig` — genuine raw-vs-raw, so a real independent edit IS caught, while the metric's
own current deprecated/effective state (which only ever shows up in a MATERIALIZED read) never enters
the comparison.

**D4b — Restore-with-warning was considered and rejected.** It would silently discard a legitimate
later edit made after the original apply — the identical "confidently wrong instead of visibly
rejected" risk class this whole epic's adversarial review (HEL-408/411) has repeatedly found and
fixed elsewhere. Refuse-with-`409` is the only option consistent with that established bar.

**D5 — New inverse-builders, not literal reuse of `PatchSetApplyRollback`'s private ones.**
`PatchSetApplyRollback`'s `fullPanelInverse`/`fullDashboardInverse`/etc. take a domain object
(`Panel`, `Dashboard`, ...); undo only has the persisted RESPONSE-shaped JSON
(`PanelResponse`/`DashboardResponse`/...), decodable via the EXISTING `RootJsonFormat[XResponse]`
(already bidirectional — `jsonFormatN`, confirmed). New `PatchSetUndoInverse` builds the same
full-overwrite `Update*Request` shape FROM a decoded `XResponse`, field-for-field mirroring
`PatchSetApplyRollback`'s mapping. **Must replicate the SAME explicit-null-default treatment
`fullConfigInverse`/`optionalConfigFieldNames` already established** (HEL-406 final-gate CR1: a
`None`-valued Option config field is OMITTED, not `null`, by `PanelConfigCodec.encodeConfig` — the
persisted `PanelResponse.config` JSON exhibits the identical omission, so a naive JSON round-trip
would fail to clear a field the original edit had cleared, the exact bug already fixed once in
rollback). A `delete` edit's undo reuses the SAME per-kind CAPABILITY matrix rollback already has
(recreatable for panel/pipelineStep; structurally impossible — cascades, no restoring API — for
dashboard/dataSource/dataType/pipeline), but undo's own obligation differs from rollback's (D4):
rollback may report `unrecoverable` and still return a response, since it's compensating a FAILED
apply that was never going to fully succeed; undo's spec makes a hard "restore every edit or none"
guarantee for an application that, by definition, DID fully succeed — so undo treats a
structurally-unrecoverable delete-kind as a Phase-1 blocker, never a Phase-2 `unrecoverable` outcome
alongside other edits' successful restores.

**D6 — Route + MCP + in-app.** `POST /api/patch-sets/:id/undo` (id = `applicationId`), mounted beside
the existing `PatchSetRoutes`. MCP `undo_patch_set` added to `helio-mcp/src/tools/refinement.ts`
(joins `propose_patch_set`/`apply_patch_set`). In-app: `PatchSetReviewPage.handleAccept`, on success,
dispatches a `Toast` (existing component, already supports `action: {label, onClick}`) reading
"Applied. Undo" before navigating — no new UI component. `Toast`'s `duration` MUST be set explicitly
to `duration: 0` (no auto-dismiss), not the shared 4000ms default, which would vanish roughly 4
seconds after the user is already mid-navigation away from the page — dismissed only by an explicit
close/Undo click, or the next successful apply's toast replacing it.

## Risks / Trade-offs

- [A delete-edit's undo recreates under a NEW id] → documented v1 limit, inherited unchanged from
  `PatchSetApplyRollback`'s own D3a; a dashboard's layout entry for the OLD id is not repointed.
- [Reimplementing inverse-builders risks re-introducing the omitted-Option-field bug] → D5 names the
  exact prior fix to replicate; tasks.md requires a dedicated regression test for it.
- [A retention floor of 20 could be exhausted within one long agent-driven session] → handled
  gracefully (D3: pruned-away 404s like nonexistent), not a correctness bug.
