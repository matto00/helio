## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read the source-of-truth spec, `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all
  20 `specs/*/spec.md` deltas.
- **Delta coverage of REMOVED capabilities is complete** — for each of the 13 capabilities the
  proposal marks Removed, the delta's `### Requirement` count exactly equals the live
  `openspec/specs/<cap>/spec.md` count (e.g. `panel-datatype-binding` 28/28,
  `data-type-persistence` 9/9, `metric-crud-api` 5/5). No requirement silently dropped.
- **Migration ground truth checks out**: `V93__connectors.sql` is the highest applied
  migration, so `V94` is correct; every column the ticket lists for the `panels` drop set
  exists in the migration history (`type_id`, `field_mapping`, `aggregation`, `metric_id`,
  `metric_label`, `metric_unit`, `chart_options`, `collection_options`, `timeline_options`,
  `column_widths`, `table_density`, `column_order`, `chart_annotation`) and no
  `table_display_config` exists — the ticket's column list is accurate.
  `alert_rules.target_data_type_id` (V60:19) and `alert_events.target_data_type_id` (V61:28)
  are as described.
- **Cross-checked the OpenSpec surface**: `grep -rl "DataType\|Metric" openspec/specs` yields
  135 capability specs; the change dir has deltas for only 16 of them.
- **Cross-checked the backend consumer surface**:
  `grep -rln "DataTypeRepository|DataTypeService|MetricRepository|MetricService|DataTypeId|MetricId|DataTypeRowRepository"`
  over `backend/src/main/scala/com/helio` returns **83 files**; several high-hit-count files
  appear in no planning artifact.
- **Read `scripts/check-schema-drift.mjs` and `.husky/pre-commit`** to test design.md's
  Gate-Chain Implications Checklist against the actual script.

### Verdict: REFUTE

Three blocking gaps, all of the same kind: the planning artifacts defer scope to `ticket.md`
("full technical scope … already fully specified in ticket.md"), but the ticket's own
enumeration is demonstrably incomplete against the live repo, and the artifacts add no
coverage of their own. Each item below is a concrete, closable revision.

### Change Requests

1. **Backend-facing OpenSpec capability specs this ticket must own have no delta and no task.**
   `tasks.md` 5.5 scopes OpenSpec work to "the ones already archived from this change's own
   `specs/` deltas" — i.e. only the 16 capabilities with deltas. But at minimum these live
   specs describe behaviour this ticket changes or deletes and are **not** frontend (P1.5/P1.6)
   or MCP (P1.4):
   - `backend-persistence` (`:41-42` "Panels table stores DataType binding"; `:66,:70` index
     requirements naming `data_types.owner_id` / `panels.type_id`; `:78` `data_types.fields`)
   - `rls-owner-tables` (`:8,:13,:17,:22` — enumerates `data_types`/`data_type_rows` as
     RLS-covered; needs `outputs`/`node_snapshots`)
   - `rls-policy-guard` (`:15-16` allowlist includes `data_types`, `data_type_rows`) — this is
     the spec backing task 4.4's `RlsPolicyGuardSpec` change
   - `acl-resource-type-registry` (`:44` `"data-type"` resolved via `DataTypeRepository.findById`;
     `:61` "DataType type is registered") — resolver of a repository this ticket deletes
   - `pipeline-create-api` (`:9-18` — `outputDataTypeName` required, endpoint creates a DataType
     row) — directly contradicted by task 3.5
   - `alert-rule-crud-api` (`:20,:25,:27,:35` — `targetDataTypeId` request/response field)
   - `alert-event-persistence`, `alert-event-state-machine` (denormalized `target_data_type_id`)
   - `workspace-resource-search` (`:5,:12-13,:27` — DataTypes/metrics as searchable kinds), the
     spec behind task 3.2
   - `workspace-tag-teardown` (`:4,:10,:13,:17,:31`), the spec behind the teardown rewire
   - `dashboard-contents-replace` (`:24` companion-DataType rule), the spec behind task 3.2
   - `patch-set-contract` (`:43` `UpdateDataTypeRequest`), behind task 3.3
   - `panel-batch-create` / `panel-batch-update` (`:43,:53,:57-58` DataType binding rules) —
     `tasks.md` 5.2 already reshapes their **schemas**, so their specs must move with them
   - `panel-type-field` (`:6,:53` persisted panel `type` enum) — the column being dropped
   - `external-run-hooks` (`:17,:44` "prior DataType snapshot")
   Required revision: enumerate these explicitly (add the missing `specs/<cap>/spec.md` deltas,
   or state per-capability which P-ticket owns it), and rewrite `tasks.md` 5.5 to name them
   rather than self-referencing the existing delta set. As written, AC 6.2's
   `grep -rn "DataType\|Metric" openspec/specs` cannot pass and the merged specs would
   contradict the shipped code.

2. **The Gate-Chain Implications Checklist is factually wrong about `check-schema-drift.mjs`,
   and its conclusion ("no transitional state, backend-only") does not hold.** The checklist
   says the script is "purely a filesystem walk over `schemas/` and a regex/text scan of the
   backend source tree" and that the environment involves "no shell-out". In fact
   (`scripts/check-schema-drift.mjs:22-32, 202-309`) it also reads and cross-validates the
   panel-type set against **four non-backend/non-schema surfaces**:
   `services/proposals/DashboardProposalService.scala`'s `DataPanelKinds: Set[String]` (`:220-226`),
   `helio-mcp/src/tools/proposal.ts` (`:275-280`), `helio-mcp/src/tools/proposalValidation.ts`
   (`:294-297`), and `frontend/src/features/dashboards/ui/ProposalReview.tsx` (`:306-309`),
   with `agentFacingPanelTypes = canonicalPanelTypes.filter(t => t !== "divider")` (`:218`).
   Collapsing the bound panel kinds to `OutputPanel` changes `canonicalPanelTypes` and therefore
   **necessarily** desynchronizes helio-mcp and the frontend file — so `proposal.md`'s
   "Frontend and MCP untouched here" and the ticket's out-of-scope line are incompatible with
   "`check:schemas` green at the end of this ticket". Required revision: re-answer the
   checklist against the real script, and make an explicit decision (and task) for how the
   helio-mcp + `ProposalReview.tsx` + `DataPanelKinds` cross-surface arms are kept consistent
   in this ticket — either touch those three files here (and say so in scope), or change the
   script's cross-surface check here. Also note `.husky/pre-commit` additionally runs
   `check:helio-mcp-types`, `typecheck`, and `npm test` on every commit, which the checklist
   does not consider.

3. **Live consumers with no owner in ticket, design, or tasks.** The ticket's consumer list and
   `tasks.md` §3/§4 omit these files, each of which imports a repository/service this ticket
   deletes (hit counts from `grep -c 'DataType\|Metric'`):
   - `services/pipelines/PipelineProposalService.scala` (35 hits; `:48` takes `DataTypeService`,
     `:23` rollback path goes through `DataTypeService.delete`) — what a pipeline proposal
     creates/rolls back after Outputs is an unmade design decision, not a mechanical rewire.
   - `services/proposals/ProposalPanelSupport.scala` (26 hits; `:81` `dataTypeRepo`,
     `MetricRepository`)
   - `services/proposals/DashboardProposalService.scala` (`:12-13,:44`) — also the home of
     `DataPanelKinds`, see finding 2.
   - `services/panels/PanelCapabilityService.scala` (16 hits; `:8` takes both
     `DataTypeRepository` and `DataTypeRowRepository`) — the ticket deletes only the *route*
     `GET /api/types/:id/panel-capabilities`, never this service.
   - `services/workspace/WorkspaceContextService.scala` (34 hits; `:5` imports `DataTypeService`)
     — the ticket mentions it only as a "do not touch `asNumeric`" caution, giving no
     instruction for the 34 real references.
   - `infrastructure/persistence/alerts/AlertRuleRepository.scala` — the
     `alert-evaluation-engine` delta requires a new
     `AlertRuleRepository.listEnabledByOutputInternal`, but no task adds it.
   - `infrastructure/persistence/panels/PanelRepository.scala` /
     `services/pipelines/PipelineRunService.scala` (snapshot writes, not just the `:649` alert
     hook) — referenced only incidentally.
   - `api/ApiRoutes.scala`'s `"data-type"` ACL resource-type registration (pairs with finding 1's
     `acl-resource-type-registry`).
   Required revision: add explicit tasks (and, for `PipelineProposalService` /
   `ProposalPanelSupport` / `DashboardProposalService`, an explicit design decision about what
   proposals bind to post-Outputs) covering each file above.

4. **Dangling internal reference in `tasks.md`.** Task 1.1 says "add `Pipeline.outputDataTypeId`
   removal deferred to section 6 (keep additive here)", but §6 is "Final verification" and
   contains no such removal task; §4 doesn't either. Likewise task 1.4 adds `targetOutputId`
   "alongside, not yet replacing, `targetDataTypeId`" with no later task removing
   `targetDataTypeId` from the domain model. Add the explicit removal tasks (or point 1.1/1.4
   at the correct section).

### Non-blocking notes

- The migration content itself (V94 numbering, panels column list, alert FK shapes) verified
  clean against the live migration history — I found no data-loss path in the *stated* steps.
  My objection is coverage, not the migration's SQL logic.
- `design.md` deliberately does not restate scope; that is defensible in general, but for a
  ~78-file irreversible delete it means the artifacts inherit every gap in the ticket's
  enumeration (findings 1 and 3 are exactly that). Consider making the authoritative consumer
  list a generated grep output committed into the change dir, so it is checkable rather than
  recalled.
