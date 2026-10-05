## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)
- Head 11bd0228; base resolved live (f09ba92f). Diff touches none of ApiRoutes.scala, Main.scala, PipelineRunService, NodeSnapshotRepository, analyze, Flyway (grepped the stat).
- AC1 (item per breakpoint, HEL-1071-valid): single create, batch, duplicate all go through PanelLayoutPlacement.insertAndAppend (FOR UPDATE lock first, then insert, then layout append, one transaction); apply-proposal and replace-contents via ProposalLayoutSupport.buildLayout now append unauthored panels. Placement is below each breakpoint's own bottom at x=0, so no overlap by construction. First-run/templates ride the proposal/panel paths.
- AC2 (red test): red-evidence.md shows real failing output on the unfixed tree (16 backend, 2+ frontend), with pass-on-unfixed cases honestly labelled as guards.
- AC3 (orphans): C1 honoured. DashboardLayoutRepair widened to incomplete-but-valid breakpoints, append-only (stored items must come back unchanged or 400), stored-bad precedence kept; non-owners render-only. e2e confirms one repair POST, no "Unsaved changes", stable box after reload.
- Gates re-run by me: `nice -n 19 sbt testFull` 5740 passed / 0 failed / 398 suites (FirstRunRoutesSpec no timeout; sbt --client shutdown separately); frontend repairPatch|storedLayoutRepair|layoutCreateSeam|panelThunks 42/42; typecheck and lint exit 0.
- Vacuity check (own mutation): dropped xs append in CreatePlacement.append; PanelCreateSeamSpec and PanelCreatePlacementSpec went red in 10+ tests (every-kind, batch, duplicate, pending-drag seam, concurrent, response). Source restored (git status clean apart from evaluation-1.md).
- RLS evidence: single create uses withUserContext inside the same transaction; test pool is a non-superuser, non-BYPASSRLS role with a posture assertion read through the same pool, and editor-grantee tests only pass if V36 select+update admit the FOR UPDATE. Real. (Stranger/viewer tests short-circuit at service ACL; not RLS proof, but the editor case carries it.)
- Deadlock (insert-before-lock) was found by the concurrency test and fixed by lock-first; documented.
- e2e transient: servers confirmed (/proc cwd of 6692 and 9599 = this worktree). I ran hel1260-orphan-owner-repair.spec.ts 3 more times in own headless context (light+dark tests): 4/4, 4/4, 4/4. Hook logic reviewed by the evaluator (guard consumed only after all preconditions; all are effect deps) and 14/14 randomized-latency loads sent exactly one repair POST. I judge it a cold-backend latency artefact, not a defect; widening the 15s poll is a nit.
- UI: change adds no new visual surface (placement only); e2e covers UI create + orphan repair in light and dark with box stability across reload. No mtime-ordering claims relied on.

### Verdict: CONFIRM

### Non-blocking notes
- Widen the 15s repair-POST poll in the e2e to 30s to remove the cold-start flake risk.
- Comment in PanelCreatePlacementSpec that stranger/viewer cases are service-ACL, not RLS, tests.
- Throwaway users hel1260-*@example.test remain in the shared dev DB (not deletable via API); I created 12 via e2e, dashboards deleted by their own tests.
