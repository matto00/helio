## Context

See proposal.md (Why). Current state, measured on `main` @ 26094322:

- `DataSourceService.delete` (`services/sources/DataSourceService.scala` ~L637) calls
  `DataSourceRepository.rootReferences`, which reads `pipeline_roots` on the privileged pool and names only pipelines
  passing an explicit owner-or-grant predicate (`PipelineRootRepository.findReadEdgesVisibleTo`). Nothing else counts.
- `WorkspaceTeardownRepository.sourceDependentPipelineConflict` runs inside `ctx.withUserContext` (app pool, RLS) and
  joins `pipelines` (FORCE RLS): a pipeline the caller cannot see is invisible to it. It also checks roots only.
- `pipeline_steps.config` is `TEXT` (V23), not JSONB. Form panel config lives in `panels.form_config JSONB` (V108) —
  the ticket's "`panels.config`" is a mis-citation.
- Dev and CI connect as a BYPASSRLS superuser (MISTAKES.md): any RLS-sensitive claim needs the two-pool
  non-superuser harness `V100ZeroRootGuardNonSuperuserSpec` already uses.

## Goals / Non-Goals

**Goals:** one RLS-independent reference finder used by both the delete guard and teardown; a complete, code-derived
inventory of reference kinds; no identity of an invisible resource ever reaching a response.

**Non-Goals:** closing the check-then-delete TOCTOU window (HEL-989 accepted it); repairing already-dangling data;
fixing the stale DataType scenarios in `workspace-tag-teardown` (carried verbatim, see Planner Notes).

## Decisions

### D1. Reference inventory (block on these; everything else is not a live reference)

| # | Kind | Where | Match |
|---|------|-------|-------|
| R1 | `root` | `pipeline_roots.data_source_id` (FK, cascade) | equality |
| R2 | `join`/`lookup`/`union` | `pipeline_steps.config` → `secondaryInput` | kind `source` and `dataSourceId` == id |
| R3 | `upsertTarget` | `pipeline_steps.config` (op `upsertsource`) → `target` | kind `existingSource` and `dataSourceId` == id |
| R4 | form panel | `panels.form_config->>'dataSourceId'` (kind `form`) | equality |

Ruled out, with reason: `dataset_rows` (the source's own content, cascades); `resource_permissions` on the source
(its own ACL); `data_types.source_id` (table dropped V94); `node_snapshots.root_id` (cascades with the root);
`SecondaryInput.Lane`, `UpsertTarget.NewSource`, empty-string draft ids (name no source); outputs/output panels and
alerts (bind outputs, not sources); connectors (source→connector direction); audit events, patch-set snapshots,
proposals, visit history, search index (historical/derived records, not live config). **Task 1.1 re-derives this
table from migrations + domain codecs; any additional live kind found is added (the ruling says ANY) and recorded.**

### D2. `DataSourceReferenceRepository` — privileged reads, explicit visibility

New file `infrastructure/persistence/sources/DataSourceReferenceRepository.scala` (`DataSourceRepository` is already
1219 lines; `rootReferences` moves here). One call resolves a SET of source ids for one viewer, all on
`ctx.withSystemContext` so RLS never filters a row:

- R1: existing `pipeline_roots` read.
- R2/R3: `SELECT id, pipeline_id, op, config FROM pipeline_steps WHERE op IN ('join','lookup','union','upsertsource')
  AND strpos(config, <id>) > 0`, then decoded in Scala with the domain codecs (`SecondaryInput` / `UpsertTarget`
  formats). Rejected alternative: `config::jsonb` in SQL — one malformed `TEXT` row would make every delete error;
  and the domain codec is the single definition of what the engine resolves. A row whose reference sub-object fails
  to decode is not a reference; it is logged at debug only (its step may belong to a hidden pipeline).
- R4: `panels JOIN dashboards` where `kind = 'form'` and `form_config->>'dataSourceId' = ANY(ids)`.
- Each referencing pipeline/panel carries owner id, tag, and a `visible` flag computed by an explicit predicate:
  pipeline = `owner_id = caller` OR a `resource_permissions` row (`resource_type='pipeline'`) with
  `grantee_id = caller` (mirrors `helio_can_access_pipeline`, V39); panel = its dashboard's `owner_id = caller` OR a
  `resource_type='dashboard'` row with `grantee_id = caller` (mirrors `helio_can_access_dashboard`'s authenticated
  branch, V36). **Decision:** a public-viewer (`grantee_id IS NULL`) grant or a grant to another user never confers
  visibility — that branch of V36 is for anonymous readers only. Never derived from RLS or the GUC.
- Decoding inspects only the reference sub-object (`secondaryInput` via `SecondaryInput`'s strict decoder, `target`
  via `UpsertTarget`'s format), so a malformed unrelated key cannot hide a real reference; reuse the write-edge scan in
  `PipelineStepRepository` (~L166-195) for R3 where it fits.

Hidden resources' ids exist only inside the repository/service result type; the conflict builders accept only
visible entries plus counts, so a hidden identity has no path into a body or message.

### D3. Delete guard

`DataSourceService.delete` swaps `rootReferences` for the finder. Body (additive to HEL-989):
`pipelines: [{id, name, references: [root|join|lookup|union|upsertTarget]}]`, `panels: [{id, title, dashboardId,
dashboardName}]`, `hiddenPipelineCount`, `hiddenPanelCount` (integers, counts only). `reason` is a sentence that names visible pipelines/panels and appends unnamed counts for hidden ones — counted in
RESOURCES (pipelines, panels), never reference edges, identically in delete and teardown — directing the
user to remove each reference first. The P0001 race-path mapping and check-before-file-delete ordering are unchanged,
but its `log.warn(..., ex)` (DataSourceService ~L668) is scrubbed: the V100 trigger text embeds orphaned pipeline ids,
which may be hidden. Warn+ logs carry only the source id and SQLSTATE; never `ex`'s message or a referencing id.

### D4. Teardown — privileged pre-check, exempt only what this call deletes

Before the user-context transaction, teardown runs the finder for its tagged sources. The exempt sets are exactly
what the transaction deletes: pipelines and dashboards **owned by the caller and tagged T** (not "tag == T" — another
user's T-tagged pipeline is not deleted, so it must still block). Remaining references → one `TeardownConflict` per
source (wire shape unchanged), reason naming visible dependents and counting hidden ones. The existing in-transaction
RLS root check stays as the last read before the deletes (narrows the TOCTOU for visible roots), but it only BLOCKS:
its conflict carries no pipeline identity (generic "a dependent pipeline outside this tag batch") — on a BYPASSRLS
connection it would otherwise see and name hidden pipelines, making non-leakage RLS-dependent. A comment states it is
a narrowing re-check, not the authoritative exemption (it compares tag only). The pre-check reads the tagged-source,
-pipeline and -dashboard sets itself on the privileged pool with an explicit `owner_id = caller AND tag = T` filter
(never RLS). Teardown's spec MODIFIES "Teardown is owner-scoped" so a foreign-owned referencing dependent may block
(never deleted or counted). The pre-check also runs on
`dryRun`, so a dry run reports the same conflicts a real call would hit. A P0001 from teardown's own DELETE is mapped
so trigger text (which names pipeline ids) reaches neither a body nor a warn+ log.

Rejected: a `SECURITY DEFINER` function owned by `helio_privileged` (V40/V100 precedent) called in-transaction. It
would close the window fully but costs a V115 migration with an ownership change (prod Flyway runs non-BYPASSRLS;
shared dev DB) plus JSON-in-TEXT parsing in SQL, for a race HEL-989 already accepted. Rejected: `SET LOCAL ROLE`
inside the user transaction (mixes privilege into a user-scoped transaction).

### D5. Other callers of `DataSourceService.delete`

`PatchSetApplyForward`, `PatchSetApplyRollback`, `PatchSetUndoService`, `PipelineProposalService` and
`FirstRunDashboardService` call it. Each is checked: a rollback that deletes a source it created must first remove
anything it created that references it (now including steps and form panels), or it will 409 and leave residue.
Where a composite operation can create such a reference, a test exercises the rollback.

### D6. Frontend and MCP

`sourcesSlice` parses `panels` and `references` tolerantly (absent → empty). `SourceDeleteConflictNotice` says
"still referenced by", lists pipelines (with reference kinds) linking `/pipelines/:id` and panels linking
`/dashboards/:dashboardId`. It composes its own copy from the structured fields (each visible reference once, the
hidden counts stated, no raw ids) and falls back to the server `message` only for a body with no structured fields
(older server); it handles panel-only and hidden-only conflicts. DESIGN.md applies; verify both
themes in the running app. The helio-mcp
`delete_data_source` description lists the reference kinds and how to clear each.

### D7. Proof obligations (RLS parity)

A non-superuser spec (two genuinely distinct pools, as in `V100ZeroRootGuardNonSuperuserSpec`) proves: teardown is
blocked by another user's hidden root and hidden join reference with no foreign id/name in the response; delete 409s
on hidden R2/R3/R4 with empty arrays and no leak; visible references are named; a hidden pipeline shared with a THIRD
user and a hidden panel whose dashboard is shared with a third user plus publicly are NOT named. The teardown-hidden
test MUST be recorded red against the pre-fix teardown, per scenario (a hidden SOLE root fails pre-fix with the
V99/V100 P0001; a multi-root or join reference commits silently) so the red is not misread. Mutations, each turning a
named test red: drop each kind's matcher; widen the visibility predicate to `true`; drop `grantee_id = caller`.
Log scrubbing is pinned by a test capturing warn+ log output on the race path.

## Risks / Trade-offs

- [More 409s for existing users, including patch-set/undo flows] → D5 audit + rollback tests; message tells the user
  what to remove.
- [`strpos` prefilter scans join/lookup/union/upsert rows] → bounded by op filter; acceptable at current scale.
- [Hidden ids held in memory server-side] → typed so builders cannot receive them; no info+ logging of them.
- [Pre-check → transaction window in teardown] → accepted (HEL-989 precedent); visible roots re-checked in-tx.

## Migration Plan

No migration. Rollback = revert the commit; the 409 body change is additive.

## Planner Notes

- Self-approved: no V115; reference-kind names `root|join|lookup|union|upsertTarget`; panels named by title.
- The ticket cites `panels.config`; the column is `panels.form_config` (V108).
- `workspace-tag-teardown`'s two DataType scenarios are stale since HEL-904. Verified this run: `openspec validate`
  errors when a MODIFIED block omits them ("Copy them into the MODIFIED block ... archive refuses to drop them").
  Carried verbatim. Follow-up candidate, not this change.
- Design-gate round 1 (skeptic-design-1.md): visibility pinned to caller-as-grantee (C1); hidden ids kept out of
  warn+ logs (C2). Round 2 (skeptic-design-2.md): owner-scoped requirement modified; in-tx re-check is identity-free;
  task 1.2 records the superuser/non-superuser contrast.
- Final-gate round 1 (skeptic-final-1.md): showing the server reason in the notice rendered raw UUIDs and listed each
  reference twice, so the 409 gained structured hidden counts and the UI composes its own copy; server reasons are
  sentences with remediation tailored to the kinds present.
