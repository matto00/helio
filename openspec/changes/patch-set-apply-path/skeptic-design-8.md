## Skeptic Report — design gate (round 8, skeptic-design-8.md)

### What I verified (with evidence)

- Read the full artifact set fresh, cold: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/patch-set-apply/spec.md`, `specs/patch-set-contract/spec.md`, `workflow-state.md`, and
  `skeptic-design-7.md` (as a claim only — its finding was re-derived independently below, not
  trusted).

- **Verified round-7's fix (D3's new alternative-considered-and-rejected paragraph) against actual
  source, byte-for-byte:**
  - Read `backend/src/main/scala/com/helio/infrastructure/DbContext.scala:50-64` directly.
    `withUserContext[R](userId)(action)` = `db.run((setUserVar(userId) andThen action).transactionally)`
    (line 51); `withSystemContext[R](action)` = `privilegedDb.run(action.transactionally)` (line 64).
    Each is a single, self-contained call — there is no session/transaction handle returned or
    threaded elsewhere. This matches D3's new paragraph's claim exactly: "each independently
    `db.run(...).transactionally` — open AND commit their own transaction per call, with no
    mechanism for an external caller to hand in an already-open session/transaction for a DIFFERENT
    service's repository call to join."
  - Confirmed this pattern actually holds at the call sites, not just in `DbContext.scala`'s own
    doc comment: `grep -rln "withUserContext\|withSystemContext"` shows these calls live at the
    **repository** layer (`PanelRepository.scala`, `DashboardRepository.scala`, etc.), never in the
    service layer. Spot-checked `PanelRepository.scala`: `insert`, `updateTitle`,
    `updateAppearance`, `delete` are each an independent `ctx.withUserContext(...)` /
    `ctx.withSystemContext(...)` call — i.e., every mutating repository method opens and commits its
    own transaction on every invocation, confirming there is no ambient shared transaction a second
    service call could join.
  - Confirmed `infrastructure/Database.scala` exposes only `initApp`/`initPrivileged` (pool
    construction) — no session-passing/DBIO-composition helper exists anywhere that could make a
    cross-service shared transaction "free." The paragraph's framing of the two real alternatives
    (thread a transaction handle through every service's public API — a signature change the ticket
    forbids reusing services "unmodified" — or a raw multi-repo transaction bypassing the services,
    violating AC3's "no direct DB writes") is accurate, not a straw man.
  - Confirmed the direct quotes D3 attributes to `ticket.md` are verbatim: "applies via existing
    per-resource services... no duplicated mutation logic" (`ticket.md:39-40`, AC3) and "no direct
    DB writes" (`ticket.md:21`, Scope bullet 1). The new paragraph is precisely grounded, not
    hand-waved.

- **Redid the full `ticket.md` Scope + Acceptance-Criteria line-by-line pass myself** (the category
  the last three REFUTEs all came from), tracing every clause independently rather than trusting
  round 7's "not a gap" table:
  - Scope bullet 1 (pre-validate target+ownership+shape, apply via existing services, no direct DB
    writes, no inline FQNs): D2/D2a (pre-validate), task 3.1/3.2, task 4.1 (apply via existing
    services), Goals section ("zero direct repository writes"). Independently confirmed the "shape
    valid" half of this bullet against the actual merged `PatchSetProtocol.scala`: `Edit.read`
    (lines 106-121) already decodes `patch` into the correct typed `Update*Request` per
    `target.kind` for `op == "update"` at the Pekko-HTTP unmarshalling layer, and leaves
    `createPatch` as raw `JsValue` for `op == "create"` (line 119) — matching design.md's claim that
    only `create`'s decode is D2's concern. "No fully-qualified names inline" is a
    CONTRIBUTING.md-wide code-style convention (not itself a design decision point) and isn't
    something a design doc needs a dedicated decision for — consistent with rounds 1-7 never
    flagging it. No gap.
  - Scope bullet 2 (atomicity + rollback, document the approach vs. the named DB-transaction
    alternative and its limits): now covered — D3's new paragraph (verified above) plus D1's
    per-kind matrix and the Risks section already document the chosen approach's limits. No gap.
  - Scope bullet 3 (route returning outcome + resulting resource states, RLS enforced, cross-owner
    rejected pre-apply): D4b, D5, D2, `specs/patch-set-apply/spec.md`'s "POST
    /api/patch-sets/apply" requirement + its "cross-owner, no-grant edit is rejected pre-apply"
    scenario. No gap.
  - Scope bullet 4 (emit prior-state set, shared shape for the undo ticket): D4a, task 2.1, task
    7.10. No gap.
  - Scope bullet 5 (tests: mixed set applies cleanly / mid-set rollback restores original states /
    pre-apply rejection of invalid-or-unauthorized edit): tasks 7.2/7.3/7.4. No gap.
  - AC1-AC6 (`ticket.md:35-43`): each traces to concrete design/task/spec coverage — AC1 → D3, tasks
    5.1-5.3, 7.3; AC2 → D2/D2a, tasks 3.1-3.2, 7.4/7.9; AC3 → D2, task 4.1; AC4 → D4a, task 2.1,
    7.10; AC5 → task 7.12; AC6 → design.md Goals' backward-compat statement + `proposal.md`'s
    Impact ("No changes to existing PATCH endpoints or request shapes"). No gap.
  - Carried-over follow-up (delete-op `patch` field): D6, task 1.1, task 7.1. Independently
    re-verified against the actual current `PatchSetProtocol.scala` that the silent-drop bug is
    real today (`case "create" => (..., patch)` at line 119 vs. the `case _ =>` wildcard at line 120
    that `op == "delete"` falls into, discarding `patch` entirely) — D6's planned fix (raise
    `deserializationError` when `op == "delete"` and `"patch"` is present) directly closes it. No
    gap.
  - Out of Scope / Non-Goals / Dependencies sections: consistent between `ticket.md` and
    `proposal.md`'s Non-Goals; no scope drift found (nothing in design.md/tasks.md goes beyond
    `ticket.md`'s stated Scope).

- **Spot-checked a sample of previously-cited source facts against current source** (not assuming
  prior rounds' "verified" claims still hold, since nothing about the design changed elsewhere this
  round that would explain skipping this):
  - `PanelService.scala:220` — `PanelId(UUID.randomUUID().toString)` inside `buildForCreate`,
    confirming no caller-specified id path for panel create.
  - `PanelService.scala:434-475` (`update`) — `panelRepo.findByIdInternal` (no ACL) +
    `authorizeEditorOnDashboard`, then `rejectCompanionBinding`/`rejectUnresolvableMetric` on the
    incoming config patch — confirms D2/D2a's claims precisely.
  - `PanelService.scala:483-524` (`rejectCompanionBinding`/`rejectUnresolvableMetric`) — confirmed
    `rejectCompanionBinding` uses `dataTypeRepo.findByIdOwned` and only rejects when
    `dt.sourceId.isDefined` (a companion binding), passing a foreign-owned/nonexistent id through
    unchanged; `rejectUnresolvableMetric` uses `metricRepo.findByIdOwned` and actively rejects
    `None` (foreign/nonexistent). Matches design.md/spec.md's corrected (round-4) framing exactly.
  - `DashboardService.scala:86-96` (`delete`, owner-only, direct `ownerId == user.id` check, no
    `accessChecker`) vs. `DashboardService.scala:123-142` (`update`, sharing-aware via
    `accessChecker` for non-owner grantees) — confirms D2's dashboard update/delete divergence
    claim exactly.
  - `DataTypeService.scala:69,127` — only `update`/`delete` defined, no `create` method — confirms
    D1's "dataType create rejected, no create API exists" claim.
  - `PipelineRepository.scala:85` (`findByIdOwned`), `:126` (`findSummaryByIdShared`), `:153`
    (`findSummaryById`), `:378` (`PipelineSummary` case class) — confirms D4a's pipeline
    second-read-exception citations are accurate line references, not stale.

- No new gap found anywhere in this fresh pass. All prior rounds' findings remain fixed; round 7's
  specific finding is precisely and correctly closed.

### Verdict: CONFIRM

Round 7's gap (the ticket-named DB-transaction alternative never being explicitly addressed) is now
closed with a paragraph I independently verified against `DbContext.scala`'s actual behavior line by
line — the claim holds exactly as stated. A fresh, independent line-by-line pass over every
`ticket.md` Scope bullet and Acceptance Criterion — the category that produced the last three
REFUTEs — traces cleanly to real design.md/tasks.md/spec.md coverage with no new gap. Spot-checks of
several previously-cited source facts (panel/dashboard/dataType/pipeline ACL and method-existence
claims) all still match current source exactly. The design is sound enough to implement.

### Non-blocking notes

- (Carried from round 7, still open, still non-blocking) Documenting `PanelResponse.fromDomain`'s
  `dataAsOf` default choice in D4a with one sentence would remove a minor ambiguity for the
  implementer, but does not block the design.
- (Carried from round 7, still open, still non-blocking) Task 3.1's pipeline bullet cites both
  `findSummaryById` and `findSummaryByIdShared` without specifying which applies at the owner-only
  pipeline ACL path; verified this is not a live ACL risk (both are independently owner-scoped), but
  naming `findSummaryById` specifically would remove ambiguity for an implementer skimming quickly.
- **Environmental note, not a design issue**: this worktree's `scripts/concertino/` directory is
  missing several canonical scripts present in the main checkout (`next-report-number.sh`,
  `persist-evidence.sh`, `emit-event.sh`, and others) because that directory is gitignored
  (`.gitignore:57`) and only a handful of its files were force-tracked into git history; newer
  scripts added to the main checkout as local/untracked files were never copied into this worktree.
  I worked around this by invoking the main checkout's copies (identical, canonical, deterministic —
  `next-report-number.sh` only scans the passed `<change-dir>` argument, no cross-repo state) against
  this worktree's change directory, rather than guessing a fallback report filename. Flagging so the
  worktree-setup step can be checked for this gap going forward.
