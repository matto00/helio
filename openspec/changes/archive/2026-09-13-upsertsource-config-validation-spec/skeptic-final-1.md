## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 323f49dc4dc9fae7b7411602a0f38111fd04ead4. Base resolved live with resolve-review-base.sh: 0fd32ab4.

### What I verified (with evidence)
- Spawn-cwd guard: READY.
- Diff `0fd32ab4...HEAD`: 10 files, +1023. Only backend files: UpsertSourceConfig.scala (+263) and UpsertSourceConfigSpec.scala (+251). There is also a spec and archived change artifacts. evaluation-1.md is untracked, so it is not in the PR.
- AC "an openspec spec exists": openspec/specs/pipeline-upsertsource-config/spec.md is present. `openspec validate --specs --strict` gives 387 passed, 0 failed. `check-openspec-hygiene.mjs` prints "openspec/ is clean".
- Not-registered scope decision: `grep -rni upsertsource backend/src/main/scala` finds matches only in UpsertSourceConfig.scala and in the unrelated `DataSourceService.upsertSourceDataType`. Nothing in PipelineStep.Registry or PipelineStepKind.All.
- PipelineCreateTransactionalSpec lines 174-188: the pinned `Seq("upsertsource", ...)` rejection that expects `Invalid step type` is still in place and unchanged.
- I ran `sbt testOnly UpsertSourceConfigSpec *PipelineCreateTransactionalSpec` myself: 49 tests, 0 failed. The rejection cases are included.
- Linear (get_issue HEL-1100, includeRelations): `blockedBy: [HEL-1101]` exists, and the description has the design-gate note.
- Code logic: write-path validation rejects a wrong-typed target or mode, an unknown kind, and an unsupported mode, and names the field in each case. Read-path decode tolerates absent fields. The ownership check uses `findByIdOwned`, which returns the same "not found" for an unknown id and another tenant's id, and a spec test asserts this. `data_sources.id` is `column[String]`, so a non-UUID dataSourceId returns None instead of throwing.
- `check-scala-quality.mjs`: clean. It does not check for inline FQNs.

### Verdict: REFUTE

### Change Requests
1. The file breaks CONTRIBUTING.md:70 ("Always import at the top of the file; never inline a fully-qualified name when an import would do"). Line 270 of the same file says to follow this rule strictly. backend/src/main/scala/com/helio/domain/steps/UpsertSourceConfig.scala inlines `scala.util.Try`, `scala.util.Failure` and `scala.util.Success` 7 times, in `validateRawConfig`, `decodeErrorFor` and `modeError`. Fix: add `import scala.util.{Failure, Success, Try}` at the top of the file and use the short names. The sibling steps (CastStep, LimitStep, RenameStep) have the same pattern, but that is existing debt. It does not make it OK for a brand-new file to break the binding standard. No logic change is expected, so re-running UpsertSourceConfigSpec is enough.

### Non-blocking notes
- `jsonKindNameOf` is defined twice, once in `object UpsertTarget` and once in `object UpsertSourceConfig`. Consider sharing it through StepCodecUtil.
- `NewSource("")` and a blank name are accepted by validateRawConfig. This fits the incomplete-draft convention, but HEL-1100 must reject a blank name at run time.
- evaluation-1.md is untracked. Commit it with the fix if archive artifacts are meant to travel with the PR.
