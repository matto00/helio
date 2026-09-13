## Context

`upsertsource` (HEL-1099) is a config model only — `target: NewSource(name) | ExistingSource(dataSourceId)`,
`mode: append|replace` — and is deliberately NOT in `PipelineStep.Registry`/`PipelineStepKind.All`
yet (`UpsertSourceConfig.scala`; `PipelineCreateTransactionalSpec.scala:174` pins its rejection).
HEL-1100 registers the real engine step and is `blockedBy` this ticket. No persisted pipeline can
contain an `upsertsource` step today, so this ticket's tests construct the graph/config directly
rather than through the live create/addStep APIs for the write-edge half of each scenario.

Write paths that can add a read or write edge, enumerated from `PipelineService.scala`: `create`
has **two** distinct paths — a simple roots-only path (`PipelineService.scala:150-161`, calls
`pipelineRepo.create` directly, no steps/outputs) and `createTransactional`
(`runTransactionally` at `:369`, one composed DBIO for roots + steps + outputs) — both are wiring
points; `addRoot`; `addStep`; `updateStep`. `removeRoot`, `deleteStep`, and `duplicateStep` (copies
an already-valid step's existing config, introducing no new edge value) cannot introduce a new
cycle and are not checked. `PipelineProposalService.apply` funnels into `PipelineService.create`
(verified at design-gate round 1: `PipelineProposalService.scala:101-112`), and the patch-set
apply/rollback/undo paths (`PatchSetApplyForward.scala:87/93/99`, `PatchSetApplyRollback.scala:
156/206`, `PatchSetUndoService.scala:232/266`) all go through `pipelineService.create`/`addStep`/
`updateStep` too — so every one of these is covered transitively by wiring the four service-level
choke points above, with no separate wiring needed.

Read-side edges come from `pipeline_roots` (`PipelineRootRepository`, `data_source_id` column) —
one row per pipeline root. Write-side edges come from `pipeline_steps` rows of kind `upsertsource`
whose config decodes to an `ExistingSource` target — today there are none (unregistered), so the
write half of the graph is empty in production until HEL-1100 ships; the validator and its wiring
still need to be correct and tested now, per HEL-1099's spec's explicit ordering requirement.

## Goals / Non-Goals

**Goals:**
- General (N-hop) cycle detection over the pipeline-owned source dependency graph, not just the
  2-hop case in the AC.
- One choke point (a new `PipelineCycleValidator`), called from every edge-adding write path.
- Tenant-scoped graph construction; no cross-tenant existence leak in the rejection message.
- No N+1 queries: two bounded reads (all of the caller's own `pipeline_roots` rows, all of the
  caller's own `upsertsource`-kind `pipeline_steps` rows with a decodable `ExistingSource`
  target), independent of pipeline count.
- Close the concurrent-edit race without a schema migration.

**Non-Goals:**
- Registering `upsertsource` in `PipelineStep.Registry` (HEL-1100).
- Engine execution of the step (HEL-1100).
- Detecting a cycle that only exists across resources the caller cannot see (impossible without
  a cross-tenant oracle, and out of scope — see spec's tenancy requirement).

## Decisions

**Revision note (post design-gate round 1 REFUTE):** round 1 claimed the advisory lock ran
"inside the existing `.transactionally` block" without checking that most write paths don't
compose their pre-checks and their persistence into one DBIO/transaction at all. Verified by
reading the actual code (`PipelineService.scala`, `PipelineRootRepository.scala`,
`PipelineStepRepository.scala`): `addRoot`/`addStep`/`updateStep`'s pre-checks run as separate
`Future`s ahead of a persistence call that opens its own `ctx.withUserContext`/`withSystemContext`
(each of which independently wraps its action in `.transactionally` — see `DbContext.scala:50,64`
— on its own connection). `create`'s simple (roots-only) path calls `pipelineRepo.create`
directly; only `createTransactional` composes one DBIO. Decisions 2 and 4 below are rewritten to
require restructuring each path so the lock, the graph reads, and the edge write are one DBIO
composed under whatever context (`withUserContext`/`withSystemContext`) that path already uses —
not a claim that the existing structure already provides this.

1. **Graph model: nodes are data sources, edge `S1 -> S2` means "some pipeline reads `S1` and
   writes `S2`", labelled with the writing pipeline's id and name (a multigraph, not a plain
   graph — see Decision 6).** This directly represents both the direct case (self-loop `S -> S`)
   and every transitive case (a path `S1 -> S2 -> ... -> S1`) as one plain graph-cycle question,
   so the same DFS/back-edge check handles the AC's two named cases, the 3-pipeline case, and the
   diamond false-positive guard with no special-casing. Alternative considered: model pipelines as
   nodes (edge `P1 -> P2` if P1's write source is one of P2's read sources) — rejected because it
   requires an extra join to attribute a cycle back to source names for the error message, which
   the chosen model gets for free (nodes already are sources). Confirmed sound by design-gate
   round 1 (no change requested on this decision).

2. **Validator computes the full candidate graph (current graph visible to the ACTING caller +
   the pending edit's edges) and runs one cycle check**, rather than incrementally patching a
   cached graph. "Visible to the acting caller" is an EXPLICIT filter, never RLS/the
   `app.current_user_id` GUC — see the round-2 revision note below for why RLS alone is
   insufficient once the step-write paths are considered. The filter mirrors
   `helio_can_access_pipeline`'s own predicate (`V39__pipeline_sharing_grants.sql:28-58`) inline in
   Scala/Slick: a pipeline is visible to user `U` iff `pipelines.owner_id = U` OR `U` appears as a
   `grantee_id` in `resource_permissions` for `resource_type = 'pipeline'`, `resource_id =
   pipelines.id`. Both new edge queries take the acting user's id as an explicit bind parameter and
   join against `pipelines`/`resource_permissions` directly, so they return the correct scoped set
   regardless of which connection/context (`withUserContext` or `withSystemContext`) runs them —
   this is what makes them safe to call from inside the step paths' existing `withSystemContext`
   DBIO (Decision 4), where RLS does not apply (`helio_privileged`, BYPASSRLS). An editor grantee
   who is not the owner still gets a graph built from everything THEY can see (owner rows they're
   NOT the owner of are excluded by this same filter unless they're a named grantee), and the
   rejection message only ever names nodes from that same fetched set (tenancy requirement, and
   change request 2's "how does the message avoid naming things the editor can't see"). Two
   queries per check: `PipelineRootRepository.findReadEdgesVisibleTo(userId)` and a new
   `PipelineStepRepository.findUpsertWriteEdges(userId)` (kind = `upsertsource`, config decoded via
   `UpsertSourceConfig.decode`, filtered to `ExistingSource`) — both take the explicit
   `userId` filter above, never the RLS-bypassing "Internal" methods' unfiltered form.

   **Round-2 revision note:** round 1's design said these queries reuse "the existing
   `findByIdShared`/owner-JOIN ACL pattern", which round 2 found does not exist as stated —
   `PipelineRootRepository.list` gets its visibility purely from RLS (`rootsTable.filter(_.pipelineId
   === ...)` under `withUserContext`, no explicit join), and `PipelineStepRepository`'s Internal
   write methods run on the BYPASSRLS privileged pool with no visibility filter at all and no
   acting-user parameter. Verified by reading `DbContext.scala` (`withSystemContext` uses
   `privilegedDb`, no `SET LOCAL app.current_user_id`), `PipelineRootRepository.list`, and
   `PipelineStepRepository`'s `spliceInsertAtInternal`/`attachTailInternal`/`updateInternal`
   signatures (none take `AuthenticatedUser`). The explicit-filter approach above is what actually
   makes the graph correct on every call site, addressing round 2 change request 1 in full.

3. **Cycle message names the concrete path**: `"<sourceName> -> <pipelineName> -> <sourceName> ->
   ... -> <sourceName>"`, built by walking the DFS parent-pointer chain from the closing edge back
   to its start. Every name in it comes from the caller-scoped graph already fetched (Decision 2),
   so nothing outside the caller's visibility is ever included.

4. **Concurrency: a single fixed-key `pg_advisory_xact_lock(72901101)` (a project-constant magic
   number, this ticket's own id, documented at the call site) taken as the FIRST statement of one
   DBIO chain that also performs the graph reads and the edge write**, composed per path as
   follows — this directly replaces round 1's vaguer "inside the existing `.transactionally`
   block" claim:
   - **`create` (simple, roots-only) and `createTransactional`**: both already build one DBIO
     handed to a single `ctx.withUserContext`/`withSystemContext` call (`createTransactional`'s
     `runTransactionally`). Prepend `sql"select pg_advisory_xact_lock(72901101)".as[Unit]` to that
     DBIO via `andThen`, before the read-edge queries and the row inserts that follow it in the
     same chain.
   - **`addRoot`**: restructure `PipelineRootRepository.add` (or add a sibling method) to accept
     the lock statement and the graph-read queries as part of its own `ctx.withUserContext { ... }`
     block — i.e. move the cycle check INSIDE `add`'s existing `flatMap` chain, immediately after
     the lock and before the `rootsTable += row` insert, rather than as a separate pre-check
     `Future` in `PipelineService.addRoot`. Reject (short-circuit the DBIO with a failed
     `DBIO.failed`) before the insert if the check fails — no root is ever persisted only to be
     rolled back, but the check and the insert share one transaction so no other write can
     interleave between them.
   - **`addStep`/`updateStep`**: same restructuring against `PipelineStepRepository`'s
     `spliceInsertAtInternal`/`attachTailInternal`/`updateInternal`, each of which already runs
     under one `withSystemContext(action.transactionally)` — prepend the lock and splice in the
     graph-read + check ahead of the actual row write, inside that same DBIO. These three methods
     gain a new `actingUserId: String` parameter (threaded from `PipelineService.addStep`/
     `updateStep`, which already receive `user: AuthenticatedUser` — no new plumbing needed at the
     service layer) so the explicit-filter graph queries from Decision 2 can be scoped correctly
     even though the surrounding DBIO runs on the BYPASSRLS privileged connection. The row
     write itself is unaffected — it still runs privileged, exactly as today, since the owner-only
     `pipeline_steps` write RLS policy is what necessitates system context for editor grantees in
     the first place (see `PipelineService`'s own doc comment on this).
   - A single fixed lock key (rather than a per-owner `hashtext(ownerId)` key) serializes ALL
     edge-adding pipeline writes tenant-wide, which directly resolves change request 2's finding
     that a caller-keyed lock does not serialize against the pipeline owner's own concurrent write
     when caller != owner — with a single key there is no "whose id" question to answer. Pipeline
     structural edits (adding a root/step, creating a pipeline) are low-frequency relative to
     pipeline runs or panel reads, so serializing all of them cluster-wide is an acceptable
     trade-off for closing the race outright rather than reasoning through cross-owner lock-key
     correctness. Alternative considered: `SERIALIZABLE` transaction isolation — rejected as
     broader-blast-radius (site-wide retry/error-handling changes) for a race this narrowly
     scoped. Alternative considered: a new `pipeline_graph_lock` table/migration — unnecessary
     once a fixed advisory-lock key was on the table, so no escalation is raised.

5. **`removeRoot`/`deleteStep` are not checked.** Removing an edge can only shrink the graph; it
   cannot create a new cycle. `duplicateStep` copies an existing (already-validated) step's exact
   config, so it introduces no new edge value and is likewise not checked.

6. **Multiple pipelines can produce the same `S1 -> S2` edge** (two different pipelines each read
   `S1` and write `S2`). The graph is therefore a labelled multigraph — each edge instance carries
   its own writing pipeline's id/name, never collapsed to a plain `S1 -> S2` boolean. When more
   than one edge could close the same cycle, the message names the specific edge/pipeline that is
   actually part of the pending write being validated (i.e. the edge introduced or changed by
   THIS request) at the point it closes the cycle, and otherwise breaks ties by ascending
   pipeline id among the fetched (already-visibility-scoped) candidates — deterministic and never
   dependent on query/iteration order, so the exact-path tests in task 2.2 are reproducible.

## Testability of the write-edge wiring (change request 3)

`upsertsource` is rejected by `PipelineStepKind.All`'s allow-list before any step-specific config
validation runs, in both `addStep` (`PipelineService.scala:1720`) and `create`'s
`validateStepKinds` (`PipelineService.scala:1495`) — confirmed by reading both call sites. That
allow-list check is orthogonal to (and happens before) anything this ticket adds, and this ticket
does not touch it (Non-Goals — no registry change). This means a live HTTP-shaped
`addStep`/`create` request naming step type `"upsertsource"` cannot reach this ticket's cycle
check at all today, and tasks 3.1/3.3/3.4 must not claim otherwise. This ticket's own tests take
option (b) from the design-gate report:
- **Read-edge side (addRoot, and create/createTransactional with roots only)**: tested at the
  real service level, against a write-edge fixture inserted directly through
  `PipelineStepRepository`'s internal (test-only) row-insert path — bypassing the HTTP kind
  allow-list the same way `PipelineCreateTransactionalSpec`'s own fixtures already seed rows
  directly for cases the live API can't produce. This is a legitimate, realistic scenario: the
  write edge existing is the pre-condition under test, not the thing being validated.
- **Write-edge side (`addStep`/`updateStep` computing and checking a pending `upsertsource`
  write edge)**: unit-tested directly against the extracted `PipelineCycleValidator` +
  `findUpsertWriteEdges` query and the exact edge-derivation logic `addStep`/`updateStep` will
  call, proving the derivation and the check are correct ahead of HEL-1100's registration — NOT
  through a live `addStep` HTTP-shaped call, which cannot carry an `upsertsource` kind. HEL-1100
  is responsible for adding its own end-to-end `addStep`-with-`upsertsource` test once the
  registry change lands, confirmed by this ticket's ordering guarantee (Decision 4's lock/check
  runs before `PipelineStepRepository`'s row write, so once HEL-1100 registers the kind, the
  check is already live on that same call path with no additional wiring).

## Planner Notes

- Self-approved: modeling nodes as data sources rather than pipelines (Decision 1) — a pure
  internal representation choice with no externally visible difference.
- Self-approved: a single fixed advisory-lock key over a per-owner key (Decision 4) — trades a
  small amount of write concurrency for actually closing the editor-grantee race without a new
  migration, within "assess honestly; prevent or document" from the ticket.
- Self-approved: option (b) for testability (read-edge tested at service level, write-edge tested
  at the validator/query level) rather than option (a)'s test-only registry injection — avoids
  adding a test-only seam to production registry code for a step this ticket deliberately does
  not register.

## Post-CONFIRM non-blocking fixes (round 3)

- **Data-source name visibility in the error message.** `data_sources` rows are owner-only
  readable (V35). An editor grantee of a pipeline that reads a source they don't themselves own
  could otherwise get an error naming a source they can't independently read. Resolution: the
  message uses the data source's id (`DataSourceId.value`), never its name, whenever the acting
  caller is not that source's owner; when the caller IS the owner, the name is used for
  readability. Task 3.6's editor-grantee test pins this choice.
- **Lock key as a named constant.** `pg_advisory_xact_lock(72901101)` is defined once as
  `PipelineCycleValidator.AdvisoryLockKey: Long = 72901101L` (this ticket's own id, documented
  inline), referenced by name at every call site instead of repeating the literal.
- HEL-1100 comment reference: posted at
  https://linear.app/helioapp/issue/HEL-1100/engine-implementation-append-or-replace-into-a-dataset
  (comment id `d6352ecb-7842-4208-b272-d262502cd783`, 2026-09-13).

## Risks / Trade-offs

- [A single global advisory-lock key serializes ALL edge-adding pipeline writes tenant-wide, not
  just contending ones] → acceptable: these are low-frequency structural edits (adding a root/
  step, creating a pipeline), not the hot path (runs, reads); the trade-off is against a
  known race, not a marginal optimization.
- [Restructuring `addRoot`/`addStep`/`updateStep` to compose the check inside their repository's
  existing DBIO chain touches repository-layer code, not just the service layer] → necessary:
  Decision 4 exists specifically because a service-layer-only check (separate `Future`s ahead of
  the repository call) cannot be atomic with the write, per design-gate round 1's finding 1.
- [Empty write-edge graph until HEL-1100 registers the step] → tests construct
  `PipelineStepRepository`-shaped rows / call the validator directly with `ExistingSource` targets
  the way HEL-1099's own tests did (see "Testability" above), so the check is proven correct ahead
  of HEL-1100's wiring, not merely written and unexercised.
- [A fixed lock key is a magic number with no schema-level documentation] → mitigated: documented
  inline at every call site and in this design doc; a future reader has one place (this file) to
  find the rationale.
- [A real cycle that only exists through a pipeline/source the acting editor cannot see is
  accepted here and would loop at run time] → accepted consequence of the tenancy requirement (no
  cross-tenant/cross-visibility existence oracle); HEL-1100's engine is the last line of defense
  for a cycle that reaches this gap — flagged there via the Linear comment posted on HEL-1100
  during this ticket's planning, alongside the end-to-end wiring test HEL-1100 owns (see
  "Testability" above).
