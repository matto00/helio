## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio/backend branch=feature/cheapness-verdict-analyze-pipeline/HEL-1092`.
- HEAD: `git rev-parse HEAD` → `15ab89d5d1694737ad925b794fbea3f9b3ba1f16`, matches the expected commit stated by the orchestrator. Working tree clean except the evaluator's untracked `evaluation-1.md`.
- Read `ticket.md`: AC requires "**Deny is the default for anything the estimator cannot classify**" and demands "a **failable** probe ... A test that can only pass is not evidence."
- Read `backend/src/main/scala/com/helio/domain/engine/PipelineCostEstimator.scala` in full (125 lines).
- Read `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` lines 195-245 (the `Registry` map, 23 entries, and `companionFor`, which rejects any `kind` not in `Registry` with a hard error at step-creation time — i.e. no step can ever reach the estimator carrying an op string outside `Registry.keySet`).
- Read `backend/src/test/scala/com/helio/domain/engine/PipelineCostEstimatorSpec.scala` lines 123-126 (the D2 "CheapOps" test).
- Read `openspec/changes/cheapness-verdict-analyze-pipeline/design.md` D2 (lines 22-27) and tasks.md C1/C3/4.2.
- Ran `sbt "testOnly com.helio.domain.engine.PipelineCostEstimatorSpec"` myself (not trusting the evaluator's paste): 16/16 pass, matching the evaluator's claim.

### The orchestrator's flagged claim — verified TRUE, and it is a real defect

`PipelineCostEstimator.CheapOps` (line 36) is literally:

```scala
val CheapOps: Set[String] = PipelineStep.Registry.keySet -- WriteBackOps
```

This is a **derived, not hand-maintained**, allowlist. The code comment (lines 33-35) and `design.md` D2 (line 27) both assert: "so a newly registered op is denied (`unclassified-op`) until someone deliberately adds it here" / "denied until someone classifies it." **That claim is false as written.** Because `CheapOps` is computed from `Registry.keySet`, any op added to `PipelineStep.Registry` in a future ticket (e.g. HEL-1107 registering `convertformat`) becomes part of `CheapOps` automatically, the moment it's registered — with zero code change in this file and zero review attention on the cheapness question. Nobody "adds it here"; it's already there by construction.

Worse, this makes the `unclassified-op` branch (`classifyStep`, lines 99-102) **structurally unreachable in production**: `PipelineStep.companionFor` (validated at step-creation time, `PipelineStep.scala:238-245`) already rejects any `kind` not in `Registry.keySet` before a step can ever be persisted. So every enabled step that can possibly reach `PipelineCostEstimator.estimate` already has an op in `Registry.keySet`, and since `CheapOps = Registry.keySet -- WriteBackOps`, every such op is either in `WriteBackOps` (deny) or in `CheapOps` (allow) — `unclassified-op` can only be hit by directly unit-testing `classifyStep` with a fabricated op string that could never occur through the real pipeline-creation path. The estimator therefore does **not** implement "deny is the default for anything the estimator cannot classify" for ops — it implements "allow is the default for anything registered, deny only for named categories." That is the inverse of the AC and of Standing Constraint C1 ("no code path may construct an allow ... for an unclassified op").

The D2 test (`PipelineCostEstimatorSpec.scala:124-125`):

```scala
CheapOps shouldBe (PipelineStep.Registry.keySet - "upsertsource")
```

is tautological, not a tripwire — it asserts the RHS of the production definition equals itself (`Registry.keySet -- Set("upsertsource")` vs `Registry.keySet - "upsertsource"`, the same set two ways). It cannot fail for any future registration of a new op; it would pass identically the day `convertformat` is registered and silently becomes auto-runnable. This directly contradicts the ticket's explicit demand for "a **failable** probe... A test that can only pass is not evidence" — applied here to the exact mechanism (D2) that is supposed to gate future op additions.

**Current behavior happens to be safe today** (all 23 currently-registered ops other than `upsertsource` are legitimate transform ops with no AI/remote-write semantics), so this does not cause a wrong verdict on any pipeline that exists right now. But the ticket's AC is about the *mechanism*, not today's op roster, and the mechanism is a live foot-gun explicitly set up to fire on HEL-1107 (`convertformat`, already named in the ticket's own Context section as pending). This is a real defect against the AC and against C1, not a hypothetical.

### Change Requests

1. Replace the derived `CheapOps` (line 36) with a **hand-maintained literal Set[String]** of the specific ops considered cheap (e.g. `Set("rename", "filter", "join", "compute", "groupby", "cast", "select", "limit", "sort", "aggregate", "splittext", "extractheadings", "chunkbytokencount", "datebucket", "pivot", "window", "unpivot", "dedupe", "fillnull", "stringops", "union", "lookup", "assert")`), not derived from `PipelineStep.Registry.keySet`.
2. Replace the D2 test (`PipelineCostEstimatorSpec.scala:124-125`) with a test that fails when a real defect is introduced: assert every op in `PipelineStep.Registry.keySet` is present in exactly one of `{CheapOps, AiOps, WriteBackOps}` (a completeness/partition check), AND add a regression test that registers (or otherwise simulates) a new op not present in any of the three sets and asserts `classifyStep`/`estimate` denies it with `unclassified-op` — i.e. a test that can actually go red if a future op is silently absorbed into `CheapOps` by construction. The current test must be demonstrably capable of failing on a mutation that adds a new key to `Registry` without updating `CheapOps`; today's derived formula makes that impossible.
3. Fix the now-inaccurate comment (lines 33-35) and `design.md` D2 (line 27), both of which currently claim a newly registered op is denied "until someone deliberately adds it here" — false under the derived formula.

### Non-blocking notes
- All 16 `PipelineCostEstimatorSpec` tests pass as claimed; AI-step and writeback classification, remote-source classification, row/step-count thresholds, and reason-collection (not first-match) all read correctly against design.md D3-D5.
- `CostVerdict`'s private constructor deriving `autoRunnable` solely from `reasons.isEmpty` (D5) is a good structural guarantee and is correctly implemented.
- No UI changes in this ticket (backend-only, pure classifier + wire field); design/visual review (Step 4) does not apply.
