## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
Round-1 items against code and artifacts:
1. CR1 (DB context) RESOLVED. D2 now decides: single create keeps `withUserContext(caller)`; PanelRepository.insert is `ctx.withUserContext(panel.ownerId.value)` (PanelRepository.scala:213) and PanelService.create sets ownerId = user.id (:330), so caller == editor. Batch/duplicate keep their system tx (insertBatch, PanelMutationRepository.duplicate:61). V36 comments confirm dashboards_select/update admit owner or editor. Layout write is layout+last_updated only; the false "Output path proves editor writability" claim is gone and the stale-read update is named as the defect.
2. CR2 (task 3.5) RESOLVED. A named mechanism exists: ProductTelemetryDbHarness (non-superuser NOBYPASSRLS owner, privileged pool SET ROLE) is real in testsupport; reuse for dashboards/panels is plausible.
3. CR3 (dashboard duplicate/import) RESOLVED by explicit decision: faithful copies, orphans left to the C1 owner repair (caller is the new owner), pinned by task 3.5b and a spec scenario. Coherent with C1.
4. CR4 (classification) RESOLVED. D5 states class 3 for all-orphan append, class 4 otherwise, identical outcome, header rewrite (2.4) and unit tests (3.5a) including pending-local-edit.
5. CR5 (precedence) RESOLVED in D5, spec ("treated as stored-bad", scenario "Stored-bad rules win over append-only") and task 3.3.
6. CR6 (sizes) RESOLVED. Content default now per breakpoint 4/4/3/2 x 5, matching dashboardLayout.ts defaultItemWidth (colCount>=10 ? 4 : >=6 ? 3 : 2) and defaultItemHeight=5; spec scenario pins all four. Output scaling matches current placeDefaultLayout (PanelService.scala:270-274).
7. CR7 (lost-update claim) RESOLVED: Goals now say only creates serialize; PATCH/replace race is explicitly not claimed. Task 1.8 covers panel.schema.json.
C1 soundness: client `resolveDashboardLayout` returns own items verbatim when a breakpoint holds all panels and places orphans around anchors, so an append-only patch by construction is credible; server check (first stored entry per live id, deleted entries droppable, stored-bad precedence) is implementable against DashboardLayoutRepair.plan (currently stored-bad only, lines 15-29).
Batch is single-dashboard (PanelService.batchCreate:509-516), so one lock per call suffices. AC coverage: AC1 tasks 0.1-0.3/1.x/3.1; AC2 task 0.7; AC3 C1 repair 1.7/2.1-2.2/3.2-3.3.

### Verdict: REFUTE

### Change Requests
1. Duplicate sizing contradicts itself. design.md D1 says: duplicate takes the source's stored item size per breakpoint; "where the source has no item, fall back to the content default". specs/panel-duplication says the opposite: "The source's lg size SHALL be scaled to the breakpoint when the source has no item there." Neither addresses a source that has no item in ANY breakpoint (an orphaned source, which this very change says exist, and which dashboard duplicate/import will also carry). Pick one rule, state it identically in design D1, the panel-duplication spec and task 1.5, and add a scenario (source with no item at a breakpoint; source orphaned everywhere) so the tests pin it.

### Non-blocking notes
- Confirm in 3.7 that A_lg_only seeding still produces lg-only after creates now place all four breakpoints (already noted in Risks).
- Task 3.5 harness has no existing dashboards/panels fixture helpers; expect it to be the largest task, budget accordingly.
