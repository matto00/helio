## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/patch-set-preview/spec.md`,
and `skeptic-design-1.md` in full. `git status` is clean except the untracked
`openspec/changes/patch-set-diff-preview/` dir — no code written yet, pure design-soundness
review. I independently re-verified every round-1-cited fact against current source (not
trusting either doc's prose) and then traced one additional consequence the round's brief asked
me to chase.

**Round-1 finding 1 (content-check parity overclaim) — fix verified accurate:**
- `PanelServiceHelpers.resolvePatch` (`PanelServiceHelpers.scala:21-48`) — read in full; blank-title
  check (`trimmedTitle.contains("")`, line 24), cross-type-PATCH check (lines 26-30), confirmed as
  cited.
- `PanelService.validateScatterAggregationConflict` called at `PanelService.scala:450` inside
  `update` (lines 434-470, read in full) — confirmed the exact call site and control flow design.md
  describes (`resolvePatch` first, `validateScatterAggregationConflict` second, both `Left` → 400).
- `PipelineService.updateName`, `PipelineService.scala:153-165` (read in full) — `if
  (req.name.trim.isEmpty) Future.successful(Left(ServiceError.BadRequest("name must not be
  empty")))` at lines 154-155 — exact match to design.md's citation.
- `DataTypeService.applyUpdate`, `DataTypeService.scala:79-125` (read in full) —
  `RequestValidation.MaxExpressionLength` check at line 83, `ExpressionEvaluator.validateTolerant`
  per computed field at line 99 — both confirmed, matching design.md's D1/D1a citation.
- `DataTypeService.delete`, `DataTypeService.scala:127-141` (read in full) — `checkSourceLink` called
  first (131), then `dataTypeRepo.existsBoundToAnyOwnedPanel(id, user)` (134) → `Conflict` on `true`
  (135-136) → `dataTypeRepo.delete` on `false` (137-138). `checkSourceLink`, `DataTypeService.scala:
  159-171` (read in full) — `dt.sourceId` defined + `dataSourceRepo.findByIdInternal` existence →
  `Conflict`. Both citations exact.
- Task 6.4's plan to assert preview's rejection message matches `apply`'s real message for all seven
  content-check cases genuinely closes round-1 CR1/CR3 (an implementer can't claim parity without
  proving it byte-for-byte).

**Round-1 finding 2 (dataType-delete hint direction) — the corrected *logic* is accurate, re-verified
against `DataTypeRepository` directly, not assumed:**
- `DataTypeRepository.existsBoundToAnyOwnedPanel`/`existsBoundToAnyOwnedPanelAction`
  (`DataTypeRepository.scala:186-205`, read in full): `SELECT COUNT(*) FROM panels WHERE type_id =
  ${id.value} AND owner_id = $ownerStr::uuid` — genuinely `owner_id`-scoped, with the method's own
  doc comment stating outright: *"Cross-user bindings (another user's panel bound to the same type)
  are not counted — the caller can only see the panels they own."* This independently confirms
  design.md's corrected D1a/D4 claim: rejection fires only for the deleting user's own bound panels.
- `V5__panel_type_binding.sql:1`: `panels.type_id ... ON DELETE SET NULL` — confirmed exact, matches
  design.md's citation.
- I additionally verified the *architectural plausibility* of the "cross-owner bound panel" scenario
  the corrected hint depends on, since round 1 didn't: `V36__rls_sharing_aware_tables.sql:164-167`'s
  `panels_insert` policy requires `owner_id = <the inserting/acting user>` — i.e. a panel's owner is
  whoever creates/edits it, not necessarily the dashboard owner, and `panels_select`
  (`V36__rls_sharing_aware_tables.sql:146-148`) is delegated to dashboard ACL (owner or sharing
  grant), not panel ownership. `PanelService.rejectCompanionBinding`
  (`PanelService.scala:483-495`, read in full) confirms by its own doc comment that a `dataTypeId`
  which "doesn't resolve for this owner (nonexistent / cross-user)" is deliberately passed through
  unrejected, "preserving the existing silent-unbind-on-read behavior." So a panel owned by user B
  can genuinely end up bound to a DataType owned by user A, and `DataTypeService.delete`'s
  owner-scoped guard genuinely cannot see it — the scenario design.md's D4 depends on is real, not
  invented.

### Verdict: REFUTE

### Change Requests

1. **D4's corrected dataType-delete impact hint ("a cross-owner-shared bound panel exists" →
   surface the unbind hint; "no bound panel exists at all" → no hint) names no mechanism that can
   actually distinguish those two cases, and none exists in the codebase today.** This is exactly
   the check the round-2 brief asked me to verify against "`DataTypeRepository`'s real query
   scoping," and it does not hold up:
   - `DataTypeRepository.scala`'s only `type_id`-keyed query is `existsBoundToAnyOwnedPanel` —
     `owner_id`-scoped, and by the branch design.md itself describes (task 2.3: "ONLY when 2.2's
     owned-panel check (a) returned `false`"), that check is *already known to be `false`* by the
     time the hint logic runs. It cannot also be the source of "a cross-owner-shared bound panel
     exists" — that requires a *different*, non-owner-scoped query, which does not exist:
     `grep -rn "type_id\|typeId" backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala`
     shows only the column definition, no finder/count method keyed on `type_id` at all.
   - Contrast with the *sibling* hint in the same task: `dashboard` `delete`'s panel-count hint
     explicitly names its query (`panelRepo.findAllByDashboardId(id, Some(user), Page(0,
     1)).map(_.total)`, tasks.md 2.3). The dataType-delete hint gets no equivalent citation anywhere
     in design.md D4, tasks.md 2.3, or spec.md — it is simply asserted as a fact preview will
     surface, with no grounded "how."
   - `proposal.md`'s Impact section — the file list that is supposed to be the authoritative
     inventory of every file this ticket touches — lists no change to `DataTypeRepository.scala` or
     `PanelRepository.scala` at all. An implementer following the Impact list literally would have no
     reason to add the query this hint requires.
   - This is not merely a missing citation — the two implementations that *would* close the gap are
     materially different and neither is chosen: (a) an RLS-scoped query (`ctx.withUserContext` as
     the deleting user, no `owner_id` filter) would only detect a cross-owner bound panel when the
     deleting user *also* has dashboard-ACL access to wherever that panel lives — narrower than "any
     cross-owner-shared panel," and arguably not what "sharing grant" implies; (b) a
     privileged/system-context query (mirroring `checkSourceLink`'s use of `findByIdInternal`) would
     see *every* tenant's panels bound to the type, including ones the deleting user has zero
     relationship to or visibility into — which would leak the *existence* of an unrelated user's
     private resource to the deleting user via the hint text, a privacy-relevant design choice
     design.md does not discuss at all. `PanelService.rejectCompanionBinding`'s own doc comment
     (cited above) shows cross-owner binding is possible via *any* channel that can supply a
     `dataTypeId`, not only a legitimate "sharing grant" — so the design's own framing of the
     detectable population is narrower than the actual population, independent of which query
     variant is chosen.
   - Required fix: design.md D4 (and tasks.md 2.3, spec.md's corresponding requirement +
     scenario) must name the actual query — RLS-scoped or privileged, pick one and justify it against
     the information-disclosure question above — and `proposal.md`'s Impact file list must be updated
     to include whichever repository file gains the new method. Until this is decided, AC3 ("Impact
     hints surface stale-rows / unbind / re-run consequences") has no implementable basis for its
     sole surviving "unbind" case (the "owned" case is now correctly a rejection, not a hint, per the
     round-1 fix) — an implementer left to fill this gap unassisted is exactly the scenario this gate
     exists to prevent.

### Non-blocking notes

- tasks.md 2.2's panel-update projection bullet lists `PanelServiceHelpers.resolvePatch` **and**
  `PanelAppearance.applyPatchJson` as separate steps in the composition ("...via
  `PanelServiceHelpers.resolvePatch`... + `PanelAppearance.applyPatchJson` + `PanelConfigCodec.
  applyConfigPatch`..."). Per `PanelServiceHelpers.scala:36-39`, `resolvePatch` already invokes
  `applyPatchJson` internally and returns the resolved appearance as `ResolvedPanelPatch.appearance`
  — the wording could read as "call `applyPatchJson` again after `resolvePatch`," which would be
  redundant (harmless if idempotent, but worth phrasing as "already produced by `resolvePatch`'s own
  `spec.appearance`" to avoid an implementer double-applying the patch or wondering why it's listed
  twice). `PanelConfigCodec.applyConfigPatch` is correctly a separate, additional call — `resolvePatch`
  only stores the raw `configPatch` JSON, per its own doc comment.
