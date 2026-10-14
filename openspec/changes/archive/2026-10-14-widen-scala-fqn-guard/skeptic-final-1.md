## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `d349190f3a5e843badd261da4fae87f9441bd9ca`; base resolved live by `resolve-review-base.sh` = `71e05843680c886751ca59379ed6fb4c1758be59`. Non-UI change, so step 4 (UI judgment) was skipped.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/scala-fqn-guard-widen/HEL-1446`.
- **AC1, the guard is widened and nothing else is weakened.** `git diff BASE...HEAD -- scripts/` touches only the `FQN_PREFIXES` array (`scala.concurrent.` and `scala.annotation.` are replaced by `scala.`) and the header comment. `fqnLineRegex`, `assertPrefixesEndInDot`, the exemptions and the string/comment blanking are byte-identical to base, at the same line numbers (68 and 59).
  - **Red-first:** I ran the new selftest against the base guard (`git show 71e058436:scripts/check-scala-quality.mjs` copied into a scratch dir). Result: `FAIL` for scala.util.Try, scala.util.Success, scala.collection.mutable., scala.collection.immutable. and scala.io.Source, then `5 failed, 30 passed`, exit 1. Against HEAD: `35 passed`.
  - The subsumed `scala.annotation.` and `scala.concurrent.duration.` cases remain red cases. A green case covers the `"scala.util.Random"` string literal.
- **AC2:** `npm run check:scala-quality` on HEAD ends with `Scala code-quality check: clean (249 soft warning(s))`, exit 0. No exemptions were added.
- **C1 / no string literal edited:**
  - The multiset of double-quoted literals on removed `.scala` diff lines is identical to the one on added lines (10 literals, `diff` is empty).
  - `ShareTokenGenerationSpec.scala` has no diff. Its lines 45 and 56 still contain `scala.util.Random` inside strings.
- **The code diff is only a prefix removal.** I normalised the removed lines by stripping `scala.(util|io|collection|concurrent|annotation).` and dropping import and comment lines. The only remaining difference from the added lines is the AC5 wrap of `stepConfigProblem` onto two lines.
- **No silent rebinding:**
  - Every pre-existing bare `Try`/`Success`/`Failure` in a touched file was already bound by an existing `import scala.util.{...}`, which the change merged into. This holds for PipelineStepRepository, EncryptedSecretBackend, PipelineRunServiceTerminalOrderingSpec and RestConnectorEgressGuardSpec.
  - The only same-named definitions in backend/src are the nested `Source` case classes in `SecondaryInput` and `LayoutReflow`. Neither is wildcard-imported anywhere.
  - The three files given `import scala.io.Source` (V98PipelineRootsMigrationSpec, CredentialSurfaceEnumerationSpec, RestSourceConstructionSiteSpec) have no pekko `Source` in scope.
  - New names that sit beside wildcard imports previously had no bare uses, so they bind exactly what the old fully-qualified name meant.
- **D4 raw sweep:** after blanking strings, there are zero code hits for `scala.[a-z]+.` outside import, package and comment lines. There are no `${...scala.` splice hits. The only remaining textual hits are ShareTokenGenerationSpec:45 and :56, both strings, as required.
- **AC4, stale references:**
  - The D5 zero-hit grep over backend, frontend/src, helio-mcp/src, docs and root `*.md` prints nothing.
  - The `PipelineAnalyzeService\.scala:[0-9]+` probe prints nothing.
  - Every remaining `PipelineAnalyzeService.<member>` names a member that exists. I checked 14 members by definition grep. `SchemaField` appears only in the V94 migration.
  - Every re-pointed target exists: `StepConfigValidation.validateStepConfig`, `ColumnSchemaInference.inferCompute/Aggregate/GroupBy`, `MultiInputSchemaInference.inferJoin/Lookup`, `TextSchemaInference.infer{ConvertFormat,AnalyzeWithAi,SplitText,ExtractHeadings,ChunkByTokenCount}` and `ReshapeSchemaInference.inferAssert`.
  - The four `openspec/specs` hits are covered by MODIFIED deltas. Each delta's requirement block equals the canonical block with only the member re-pointed (python comparison after the rename: `True` for all four).
  - `openspec validate widen-scala-fqn-guard --strict` reports the change as valid.
- **V94 is untouched:** `git diff --quiet BASE...HEAD -- backend/src/main/resources/db/migration` succeeds.
- **AC5:**
  - `PipelineAnalyzeService.scala` has its stray blank lines removed, and `stepConfigProblem` is wrapped.
  - The rewrapped `PipelineAnalyzeProtocol` scaladoc blocks have the same wording at ≤100 characters.
  - The other over-long lines in that file are pre-existing code tables, outside the ticket's scope.
- **AC3, fresh `sbt testFull`** (foreground command, run in this worktree's `backend/`):
  - Both project lines name HEL-1446: `loading project definition from .../HEL-1446/backend/project` and `set current project ... build file:.../HEL-1446/backend/`.
  - Summary: `Suites: completed 615, aborted 0 / Tests: succeeded 8079, failed 0, canceled 4 / All tests passed.`, exit 0.
- **Formatting:** `prettier --check` passes on the touched TSX, docs, CONTRIBUTING.md and both scripts.

### Verdict: CONFIRM

### Non-blocking notes

- **AC6 is a delivery-step obligation, not yet verifiable.** The PR body must state that this change does not touch HEL-1386's `${...}` splice case. The raw sweep found no splice-hidden hits, and the guard's splice handling is unchanged.
- **Environment anomaly, worth a MISTAKES.md entry.** My first `testFull` run from this worktree (same command; process cwd confirmed via `/proc` to be HEL-1446/backend) printed `loading project definition` and `set current project` lines naming the **HEL-1451** worktree, along with HEL-1451 source paths in its warnings. Both runs reported `cache 100%, 644 disk cache hits`. That run passed (8079/0), but I discarded it as evidence. The re-run printed correct HEL-1446 paths throughout, and I used it instead.
  - It looks like sbt 2's shared disk cache can replay another worktree's build-load output. A project-path-line check can therefore be wrong in either direction.
  - The evaluator's and executor's runs (04:16) predate this and named HEL-1446.
- **ADDED vs MODIFIED.** The spec delta ADDS a "whole scala namespace" requirement next to the existing "covers java.sql, java.time, java.util and scala.annotation" requirement instead of MODIFYING it. The two are consistent, since the old one is a subset, but the canonical spec will carry both.
