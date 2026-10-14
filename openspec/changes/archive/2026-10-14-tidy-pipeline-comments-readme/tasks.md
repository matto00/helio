## Standing Constraints

## 1. Backend (comments only)

- [x] 1.1 Rewrite the `gatedSubmit` comment in `PipelineSchedulerService.scala` per design D1; verify each sentence
- [x] 1.2 Rewrite the explicitRootId comment in `PipelineRunBackfill.scala` per D2; verify the `PipelineRunService.scala` copy
- [x] 1.3 Re-derive `services/pipelines/README.md` per D3 (all files, re-derive command, no completeness claim)
- [x] 1.4 Record every factual sentence + verification command + output in `evidence/claims.md`

## 2. Tests

- [x] 2.1 Remove FireTimeRunConfigGateSpec's four banners per D4 (re-verify each fact is already in the class doc/test names)
- [x] 2.2 Record test count/names before and after; run FireTimeRunConfigGateSpec (foreground, `HELIO_TEST_JVM_XMX=3g`)
- [x] 2.3 Bounded repro per D5: own servers on 6883/9790, DEV_PORT=6883, -g "at 430px surface 7: Connectors page", 1 test x 20; record in `evidence/e2e-flake-probe.md`
- [x] 2.4 Root-cause and fix only if 2.3 reproduced
- [x] 2.5 Pre-commit gates pass; `sbt compile` clean
