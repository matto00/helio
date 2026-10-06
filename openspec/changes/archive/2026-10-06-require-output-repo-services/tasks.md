## Standing Constraints

- [C1] Any fixture whose expected test outcome changes (not just its constructor args) is a finding listed in the call-site table, never a silent re-baseline; the 6 ApiRoutes specs gaining dbContext get their assertions diffed specifically.
- [C2] The red run against main is reproducible: files-modified.md states the exact method (separate checkout/commit, command, captured output).

## 1. Backend

### Backend

- [x] 1.1 Drop `= null` on `outputRepo` in PanelService, PipelineService, PipelineRunService, DashboardService, DashboardContentsService, DashboardProposalService, ProposalPanelSupport.preValidateBindings; add D2 `require`; verify `grep -n "OutputRepository = null"` over src/main returns nothing
- [x] 1.2 Delete every `outputRepo == null`/`!= null` branch in those seven files per D3 and rewrite stale comments; verify `grep -n "outputRepo [!=]= null"` in those files returns nothing
- [x] 1.3 ApiRoutes per D4: `dbContext` required, one real `OutputRepository`, no `.orNull` for it; verify `sbt compile` and `grep -n "outputRepoOpt.orNull" ApiRoutes.scala` is empty; Main.scala unmodified (`git diff --stat`)

## 2. Tests

### Tests

- [x] 2.1 Update every fixture constructing the seven services / ApiRoutes per D5 (real repo or typed mock, never null); verify `sbt Test/compile` and `grep -rn "outputRepo *= *null" src/test` is empty
- [x] 2.2 Write files-modified.md call-site table: file, construction site, what it passes, and whether the test's expected outcome changed (D5)
- [x] 2.3 Add the D6 PanelService tests (nonexistent + other-user outputId, create + update, no row written); verify they pass
- [x] 2.4 D6 red evidence: run the same assertions against main with the repo omitted and capture the failure; mutate rejectMissingOutput to Right(()) and capture red; revert
- [x] 2.4a Add a test that constructing PanelService (and one more of the seven) with an explicit null outputRepo throws IllegalArgumentException (skeptic note A); mutation: remove the require -> red
- [x] 2.5 D6 undo-path case, or a written reason it is not cheap
- [x] 2.6 `nice -n 19 sbt testFull` (HEL924_TEST_GROUP_CONCURRENCY<=2, Bash timeout 600000) green; report any FirstRunRoutesSpec timeout or "Java heap space"; `sbt --client shutdown` as a separate call
