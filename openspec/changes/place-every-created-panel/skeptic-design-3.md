## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)
- Round-2 item (duplicate sizing) RESOLVED identically in all places: design.md D1 (source stored size, clamped; else source lg scaled; else kind default per breakpoint), specs/panel-duplication (same three-step ordered rule, plus scenarios "Source missing an item at one breakpoint" w6/h4 lg -> sm w3 h4, and "Source orphaned at every breakpoint" -> 4/4/3/2 x 5), task 1.5 (verbatim same), and specs/dashboard-layout-validation (defers to panel-duplication with the same three steps). Scaling formula identical everywhere: clamp(round(lgW*cols/12),1,cols); 6*6/12=3 matches the sm scenario.
- Independent pass: spec/design/tasks consistency checked end to end. Every AC is covered (AC1: 0.1-0.3, 1.x, 3.1; AC2: 0.7 red evidence; AC3: C1 repair 1.7, 2.1-2.2, 3.2-3.3, 3.5b). Repair spec, breakpoint-layout-resolution reversal, stored-bad precedence, append-only (first stored entry per live id, deleted entries droppable), 409 behaviour, classification (D5/2.4/3.5a), RLS posture (D2/3.5), copy paths (D3/3.5b), e2e stubs (3.7/3.8), red-first and mutation (D6/3.9) are mutually consistent. No TODO/TBD placeholders. Out-of-bounds files (ApiRoutes/Main/PipelineRunService/NodeSnapshotRepository/analyze, V115) are explicitly untouched; no migration planned.
- C1 judged on implementability only: sound.

### Verdict: CONFIRM

### Non-blocking notes
- Task 3.5 (NOBYPASSRLS dashboards/panels harness) is the largest task; budget for it.
- Confirm in 3.7 that A_lg_only/B_partial seeding still yields lg-only/partial now that creates place all four breakpoints.
- Task 0.7: run the red tests before any production edit, as D6 requires.
