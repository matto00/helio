## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 71e05843680c886751ca59379ed6fb4c1758be59 (= main; the change dir is untracked planning only).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/scala-fqn-guard-widen/HEL-1446`.
- **Guard premise (D1):** `scripts/check-scala-quality.mjs` `FQN_PREFIXES` lists only `scala.concurrent.` and
  `scala.annotation.` from `scala`; regex is `(<prefixes>)\w` with no leading boundary. Confirmed.
- **Widened-guard impact, simulated:** a scratch copy of the guard with `"scala."` added, run against this worktree →
  **76 violations in 39 files**. Every one is a real `scala.util.*` / `scala.collection.*` / `scala.io.*` use (tally:
  Try 22, Success 13, Failure 8, mutable.* 28, immutable.* 2, io.Source 3). **Zero false positives**, so D1's "the guard
  run itself proves it" holds. The design's "~78 sites / ~41 files" and "Random 2" are wrong; see CR1.
- **Raw grep vs the guard (D4):** a raw grep for non-import, non-comment `scala.[a-z]` lines → 78. `comm` against the
  guard's 76 leaves exactly two lines, both string literals:
  `ShareTokenGenerationSpec.scala:45` `"never reach for scala.util.Random or Math.random" in {` and
  `:56` `src should not include "scala.util.Random"`. No `${}`-splice or `"""` hidden uses exist.
- **Collision audit premise (D3):** I probed all 39 files for existing bindings of
  Try/Success/Failure/Source/mutable/immutable. Two user-defined `Source` exist: `SecondaryInput.Source` and
  `LayoutReflow.Source`, both nested. pekko `Source` is imported in `PipelineRunRegistry.scala:8` (its inline use is
  `mutable.LinkedHashMap`, not `io.Source`) and in `GenerateTextStepSpec.scala:10`. `ActorStatus.Success` appears in
  PipelineRunRegistry. D3's rename-on-any-binding rule is conservative enough. No `scala.io.Source` site is in a main file
  that binds pekko `Source`.
- **Source-scanning tests:** I checked SqlEgressSocketFactoriesSpec, ExistenceNotLeakedRoutesSpec,
  SchemaFieldStructuralGuardSpec, RestSourceConstructionSiteSpec and CredentialSurfaceEnumerationSpec. None asserts on
  `scala.*`/`Try(`/`mutable` text, so an import-only rewrite will not trip them. ShareTokenGenerationSpec is the one
  that does (see CR1).
- **D5 member owners:** `def` grep confirms validateStepConfig→StepConfigValidation;
  inferCompute/Aggregate/GroupBy→ColumnSchemaInference; inferJoin/Lookup→MultiInputSchemaInference;
  inferConvertFormat/AnalyzeWithAi/SplitText/ExtractHeadings/ChunkByTokenCount→TextSchemaInference;
  inferAssert→ReshapeSchemaInference. `inferOutputSchema` is still on PAS (L353, `private[engine]`). All correct.
- **D5 stale-ref enumeration:** a repo-wide grep (excluding archive/node_modules) finds 18 hits for the D5 pattern.
  They sit in docs/compute-expression-grammar.md (2), ExpressionEvaluator (3), SchemaField.scala, AnalyzeWithAiConfig,
  JoinColumnNaming, PipelineStep.scala:228, model.scala:444/467, ConvertFormatStep, steps/README.md:102, GroupByStep,
  V94:449, AssertConfig.tsx:29 and four canonical specs. All are in D5's scope. **One stale ref is in a form the D5 grep
  cannot see** (CR2).
- **V94 exemption:** `V94__outputs_model.sql:449` names `PipelineAnalyzeService.SchemaField`. The exemption is sound:
  editing an applied migration changes its Flyway checksum.
- **Spec deltas:** the four MODIFIED requirement blocks match the canonical blocks line for line once the owner token is
  normalised. Only the owner object changes; no scenario was dropped. The canonical `scala-inline-fqn-guard` spec exists,
  and its exemptions requirement explicitly exempts "text inside double-quoted string literals".
- **D6 cosmetics:** PAS L10-12 are blank and L26 is 127 chars. PipelineAnalyzeProtocol L237 is 102 chars, L238 is 43
  (ragged pair), L252 is 130 and L254 is 101. Over-long code lines elsewhere in Protocol (L336+) are code, not scaladoc,
  so they are correctly out of scope.
- **Gate-chain checklist:** package.json:35 wiring, `.husky/pre-commit:19` and `ci.yml:126` match the checklist's
  answers. The selftest's tmpdir fixture is cleaned up in `finally`. No new process or env dependency. Sound.

### Verdict: REFUTE

### Change Requests

1. **D4's acceptance signal cannot be met unless a security regression test is corrupted; fix the signal and the counts.**
   As written, D4's raw grep (`\bscala\.(util|collection|io)\.` on non-import, non-comment lines) "must return zero", and
   "if any exist, fix them too". On the live tree it returns exactly two lines. Both are string literals in
   `backend/src/test/scala/com/helio/services/sharing/ShareTokenGenerationSpec.scala:45` and `:56`. Line 56,
   `src should not include "scala.util.Random"`, is a guard that ShareTokenService never uses an insecure RNG. These lines
   are not FQN uses. The canonical guard spec exempts string literals. "Fixing" them would weaken that test. The design's
   own tally ("Random 2") counts these two literals as sites to fix, which shows the plan currently means to touch them.
   Revise D4 and task 2.4:
   - Either make the raw grep blank `"..."` literals before matching (as the guard does), or name
     `ShareTokenGenerationSpec.scala:45,56` as expected residual hits, with the reason (string literals, a
     security-regression assertion, never edit). State that the sweep is done when nothing else is left.
   - Widen D4's raw grep from `(util|collection|io)` to the whole `scala\.[a-z]` namespace, to match D1. Otherwise a
     splice-hidden `scala.jdk.`/`scala.math.` use would get past both checks.
   - Correct the Context/Proposal counts to the measured **76 guard violations in 39 files**, and drop "Random 2".
     There are no inline `scala.util.Random` code uses.
2. **D5's zero-hit grep misses one stale `validateStepConfig` ref that AC4 covers.**
   `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala:524-525` reads
   ``// PipelineAnalyzeService.scala:126 (`validateStepConfig`'s`` / ``// `problems.mkString("; ")`)``. The member now
   lives in `StepConfigValidation`, and the file:line is stale too: PAS is 360 lines and L126 is unrelated. The D5 regex
   only matches `PipelineAnalyzeService.<member>`, so this ref would survive a "zero-hit" proof. Add the site to task 3.1
   explicitly. Add a second probe to the D5 check: `grep -rnE 'PipelineAnalyzeService\.scala:[0-9]+'` over the same
   scope, each hit re-checked or re-pointed. That catches this form of stale ref.

### Non-blocking notes

- The guard spec delta is ADDED next to a canonical requirement titled "covers java.sql, java.time, java.util and
  scala.annotation", and the spec's Purpose line also lists `scala.annotation`. It is not contradictory, but a MODIFIED
  delta of that requirement (or a Purpose tweak) would read more cleanly after archive.
- Consider a selftest green case `src should not include "scala.util.Random"`. It would pin the string-literal exemption
  for the new `scala.` prefix specifically. Today it is proven only with `java.time.`.
- D5's "member-existence check" must tolerate the non-member tokens the grep surfaces: `PipelineAnalyzeService.getClass`
  (4), `PipelineAnalyzeService._` (3 imports), `PipelineAnalyzeService.scala` (filename), and
  `PipelineAnalyzeService.SchemaField` (V94, exempt). Say so, so the executor does not "fix" them.
- `RestConnectorEgressGuardSpec.scala:169` also has an inline `new java.net.UnknownHostException`. `java.net.` is not a
  guard prefix and is out of scope. Leave it, and do not widen scope.
