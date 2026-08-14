## Skeptic Report — design gate (round 7, skeptic-design-7.md)

### What I verified (with evidence)

- Read the full artifact set fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/patch-set-apply/spec.md`, `specs/patch-set-contract/spec.md`, `workflow-state.md`, and
  round 1-6 skeptic reports (as claims only).
- Re-verified round-6's two fixes against actual backend source:
  - **D4a's pipeline second-read exception**: confirmed `PipelineRepository.scala` has
    `findByIdOwned` (line 85, owner-only, bare `Pipeline`), `findSummaryById` (line 153,
    owner-scoped, joined `PipelineSummary` with `sourceDataSourceName`/`outputDataTypeName`/
    `lastRunRowCount`), and `findSummaryByIdShared` (line 126, sharing-aware joined summary).
    Confirmed `PipelineService.updateName`/`delete` (lines 153-176) both call
    `pipelineRepo.findByIdOwned` (owner-only) — matching design.md D2's claim exactly. Confirmed
    `findSummaryById`'s query (`pipeline.ownerId === ownerUuid`, line 156) has the SAME owner-only
    ACL semantics as `findByIdOwned`, so capturing the joined summary via `findSummaryById` at the
    same point never broadens the ACL gate already established — the D4a/task-3.1 fix is
    internally consistent, not merely a documentation patch. No new gap here.
  - **D4b's `resultingState` field**: confirmed every create/update method the design names already
    returns the full domain object or response type with no second read —
    `PanelService.create`/`update` → bare `Panel` (`PanelService.scala:168,434`, `.fromDomain`
    conversion only), `DashboardService.create` → `(Dashboard, Boolean)` (`:56`),
    `DataSourceService.createStatic`/`update` → `DataSource` (`:90,472`),
    `PipelineService.create`/`updateName` → `PipelineSummaryResponse` directly (`:133,153` — no
    conversion needed at all), `PipelineService.addStep`/`updateStep` →
    `PipelineStepResponse` directly (`:433,521`). D4b's "no second read" claim holds for all six
    kinds, including pipeline (whose create/update methods return the response type already,
    unlike its pre-validation ACL read).
- Checked the round-7-specific addition — design.md's Goals-section backward-compatibility
  statement — against `proposal.md`'s Impact section ("No changes to existing PATCH endpoints or
  request shapes") and `AC6` (`ticket.md:43`). Consistent; the one wire-behavior change (D6's
  stricter `Edit.read` on a `delete`+populated-`patch` combination) is correctly scoped as a
  tightening of an invalid case, not a break to any legitimate existing caller — verified against
  `PatchSetProtocol.scala:82-135`'s actual current reader (read fresh, not from a claim).
- Did a full line-by-line pass over every `ticket.md` Scope and Acceptance-Criteria bullet, tracing
  each to a specific design.md decision / tasks.md task / spec.md scenario (the category the last
  two rounds caught):
  - AC1-AC6: all traced to concrete coverage (D3/tasks 5.1-5.3/7.3; D2/D2a/tasks 3.1-3.2/7.4;
    D2/tasks 4.1/D2a; D4a/task 2.1/7.10; task 7.12; Goals backward-compat statement + proposal
    Impact). No gap found in the ACs.
  - Scope bullet 1 (pre-validate + apply via existing services, no direct DB writes, no inline
    FQNs): pre-validate/apply covered by D2/D2a/task 4.1. Confirmed "patch shape valid" for
    `update` ops is ALREADY enforced by the merged HEL-403 `PatchSetProtocol.scala` at the
    Pekko-HTTP entity-unmarshalling layer (read the actual `Edit.read`, lines 106-121: `patch` is
    decoded into the matching typed `Update*Request` field per `target.kind` at wire-parse time,
    before `PatchSetApplyService` ever runs) — so design.md correctly doesn't re-litigate this;
    only `create`'s `createPatch` (kept untyped `JsValue` by the merged protocol) needs an explicit
    decode step, which D2 provides. Not a gap.
  - Scope bullet 2 ("Atomicity + rollback... Document the rollback approach (prior-state capture
    vs a DB transaction spanning the services) and its limits."): **gap found — see Change Request
    1.** The chosen approach (prior-state capture) and its limits are documented extensively (D3,
    D1's per-kind matrix, Risks section). The named alternative — "a DB transaction spanning the
    services" — and why it was rejected in favor of prior-state capture is never discussed
    anywhere. Grepped `design.md` for "transaction" — zero hits (only `ticket.md` itself uses the
    word). Grepped for "alternative"/"considered and rejected"/"instead of" — six hits, all for
    OTHER decisions (D2a's implement-full-fix vs document-as-limitation, D3a's layout-repointing
    rejection, D2's validate-as-you-go rejection, D3's double-mutation rejection); none address the
    transaction-vs-capture comparison this specific Scope bullet names.
  - Scope bullet 3 (route returning outcome + resulting resource states, RLS enforced, cross-owner
    rejected pre-apply): covered by D4b (round-6 fix, re-verified above), D5, D2/spec.md's
    "POST /api/patch-sets/apply" requirement. Not a gap.
  - Scope bullet 4 (prior-state emission, shared shape): covered by D4a. Not a gap.
  - Scope bullet 5 (tests: mixed set applies cleanly / mid-set rollback / pre-apply rejection):
    covered by tasks 7.2/7.3/7.4. Not a gap.
  - Carried-over follow-up (delete+patch rejection): covered by D6/task 1.1/task 7.1. Not a gap.
- Independently confirmed the concrete architectural reason the un-discussed alternative
  (a DB transaction spanning the services) is not simply available for free in this codebase:
  read `DbContext.scala:50-64` — `withUserContext`/`withSystemContext` each independently call
  `db.run(action.transactionally)` / `privilegedDb.run(action.transactionally)` per invocation;
  there is no ambient/shared transaction or session object threaded across separate service/repo
  calls anywhere in this pattern. Spanning a single SQL transaction across
  `PanelService.update`/`DashboardService.update`/etc. as currently structured would require
  restructuring every touched service to accept an externally-supplied `DBIO`/session — a
  materially different (and larger) design than "reuse existing per-resource services exclusively"
  already commits to. This is exactly the kind of grounded trade-off the ticket's parenthetical
  asks the design to state, and it currently doesn't.

### Verdict: REFUTE

One new, concrete, ticket.md-grounded gap, in the same category the last two rounds caught: a
Scope bullet's explicit, named documentation requirement with zero coverage anywhere in
`design.md`/`proposal.md`/`tasks.md`. All ACs, and the rest of Scope, trace cleanly to real
coverage on this fresh pass; round 6's two fixes hold up against a fresh source cross-check.

### Change Requests

1. **`ticket.md`'s "Document the rollback approach (prior-state capture vs a DB transaction
   spanning the services) and its limits" (`ticket.md:22-25`) is only half-satisfied.** `design.md`
   thoroughly documents the CHOSEN approach (prior-state capture, D3) and its limits (D1's per-kind
   unrecoverable/recreated matrix, the Risks section's five bullets). It never discusses the named
   alternative the ticket explicitly poses ("vs a DB transaction spanning the services") or why it
   was rejected — the word "transaction" appears nowhere in `design.md`/`proposal.md`/`tasks.md`,
   only in `ticket.md` itself. This is the same pattern of miss rounds 5 and 6 each found (a
   Scope-bullet clause with a specific, named ask and zero coverage), and the same document already
   has a live precedent for exactly this kind of "alternative considered and rejected" reasoning
   (D3a: "extending the compensation to also patch `layout` was considered and rejected: ..."). Fix:
   add a short paragraph (e.g. as part of D3, or a new D3b) explicitly stating that a DB transaction
   spanning the services was considered and rejected, grounded in the real constraint —
   `DbContext.withUserContext`/`withSystemContext` (`backend/src/main/scala/com/helio/infrastructure/DbContext.scala:50-64`)
   each independently open and commit their own transaction per call
   (`db.run(action.transactionally)`); there is no shared/ambient transaction object threaded across
   separate per-resource service calls in this codebase, so spanning one SQL transaction across
   (e.g.) a panel update + a dashboard update would require restructuring every touched service to
   accept an externally-supplied `DBIO`, a materially larger change than "reuse existing
   per-resource services exclusively" already commits to — and would still not undo any non-DB
   side effect a future create/step path might grow. This is a documentation-only fix (no task/test
   changes implied) but is squarely what the ticket's Scope bullet asked the design to record.

### Non-blocking notes

- The round-6 non-blocking note (documenting `PanelResponse.fromDomain`'s `dataAsOf` default choice
  in D4a with one sentence) is still unaddressed. Still non-blocking, same as round 6.
- Task 3.1's pipeline bullet cites both `findSummaryById` and `findSummaryByIdShared` as available
  sources for the joined `PipelineSummary` capture without specifying which one applies to the
  owner-only pipeline-level ACL path D2 establishes. Verified this is not a live ACL risk (the
  ACL gate is already established by the preceding `findByIdOwned`/owner-only check in the same
  bullet, and `findSummaryById`'s own query is independently owner-scoped — so either reads no
  more broadly than `findByIdOwned` already permits), but a one-clause edit naming `findSummaryById`
  specifically (dropping the `/findSummaryByIdShared` alternative for this one call site) would
  remove the ambiguity for an implementer skimming quickly.
