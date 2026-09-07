## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Fresh cold spawn. Every finding below is derived from the live tree, not from round 1's report.

### What I verified (with evidence)

**Ground truth on the defect and the premise**
- `PipelineStep.Registry` (`backend/src/main/scala/com/helio/domain/model/PipelineStep.scala:205-229`) has exactly 23 entries.
- `inferOutputSchema` (`PipelineAnalyzeService.scala:441-479`) dispatches 22: filter/limit/sort/dedupe/fillnull (:448), union, join, select, rename, cast, compute, aggregate, splittext, extractheadings, chunkbytokencount, datebucket, pivot, window, unpivot, stringops, lookup, assert. `groupby` is genuinely absent and falls to `case unknown => ... s"Unknown op: '$unknown'"` (:477-478). Premise holds; `join` is indeed already fixed (:461, regression test at `PipelineAnalyzeServiceSpec.scala:1044`).

**CR1 (access) — CLOSED.** `PipelineAnalyzeService.scala:441` is `private def` inside `object PipelineAnalyzeService` (:40), i.e. object-private — the spec truly cannot call it today. The file's package is `com.helio.domain.engine` (:1) and `PipelineAnalyzeServiceSpec.scala:1` is `package com.helio.domain.engine` with `import ...PipelineAnalyzeService._`, so `private[engine]` (design Decision 4, task 3.0) is the correct and sufficient qualifier. Verified, not assumed.

**CR2 (vacuous guard) — SUBSTANTIALLY CLOSED, with one live contradiction (see CR below).** Decision 4, task 3.2/3.3, and both spec-delta scenarios now mandate direct invocation plus `validationError shouldBe None` with a fully valid config per kind, and task 5.1a demands a red-arm proof on a validator-bearing kind. I also checked the achievability question the coordinator raised: `validationError shouldBe None` IS attainable for all 23 kinds when called directly, because `analyze`'s `validateStepConfig`/`requiredConfigProblems` interception is bypassed and the three secondary-input kinds degrade cleanly — `inferUnion` (:902-907), `inferJoin` (:922-927) and `inferLookup` (:874-888) all return `None` when `secondarySchema` is `None`. The remaining kinds only emit `Some(...)` on a genuinely malformed config or a field absent from `inputSchema`, both of which the guard author controls. So the strict form is practical, not aspirational.
- Residual vacuity check: with the strict form, an uncovered kind hits the `unknown` arm and yields `Some("Unknown op: ...")`, failing the assertion. The only remaining escape is the exemption map, which is name-only, reason-bearing, and asserted to be a registry subset (task 3.5) — reviewable, not silent. No path found by which the guard certifies coverage it did not establish, **provided the strict form survives contact with the executor** — which is exactly what CR1 below endangers.

**CR3 (upper-case aggFunction) — CLOSED and the underlying hazard is real.** `aggResultType` (:1006-1012) matches raw `fn` and ends `case _ => "string"`; `validateGroupBy` (:414-419) lowercases before the `SupportedFunctions` check, so `"SUM"` is accepted upstream. Design Decision 2 + task 2.3a/4.6 (compute `toLowerCase` once, feed both name and type; upper-case coverage case) close it correctly.

**Round-1 non-blocking notes — handled honestly.**
- Decision 5's citation checks out: `InProcessPipelineEngineSpec.scala` asserts `engRow("sum_age") shouldBe 30.0` (:359) and `engRow("count_name") shouldBe 2L` (:367) against really-executed rows, so the emitted column name is independently pinned.
- Task 2.2's "RESOLVED — no action" is accurate: `validateGroupBy` does lowercase (:416).
- Task 4.7 (named canonical-type <-> runtime-value mapping) is present and reasonable; there is indeed no `inferFieldType` helper in this file to borrow.

**Parts round 1 approved are intact.** Decision 2 (type follows function) unchanged and consistent with `aggResultType`; Decision 3's best-effort `string` fallback for an absent group key unchanged and matches the file's existing conservative fallback (e.g. `inferLookup`'s `"string"` placeholder, :885); Decision 4's by-name-only exemption rule unchanged. No regression introduced by the revision.

### Verdict: REFUTE

One blocking defect, and it is squarely on the primary deliverable: the design document **still contains, in writing, the license to weaken the guard back to the vacuous form** that CR2 was raised to eliminate.

### Change Requests

1. **`design.md` → "Risks / Trade-offs", first bullet, contradicts Decision 4 and task 3.3.** It reads: *"The guard's minimal-config probes could be brittle as kinds gain required fields. Mitigated by Decision 4's rule of keying on `Unknown op` specifically, so an unrelated config error does not turn the guard red."* That is not Decision 4's rule any more — Decision 4's "Belt and braces" paragraph and task 3.3 now require asserting `validationError` is `None` and explicitly forbid keying on "not an `Unknown op`". This is the precise sentence an executor will reach for when a kind's probe config proves fiddly, and it tells them the vacuous form is the *sanctioned mitigation*. Rewrite the bullet so the stated mitigation is the strict one: probe brittleness is handled by fixing the probe config (and the `inputSchema` it is evaluated against) until `validationError` is `None`, or by an explicit named exemption per task 3.5 — never by relaxing the assertion. State plainly that a probe reaching a config-error arm must fail the guard.

2. **`proposal.md` → "What Changes", second bullet, restates the superseded weaker form**: *"actual coverage probed by calling `inferOutputSchema` per kind and asserting no `Unknown op`."* Align it with the shipped decision — direct invocation with a fully valid config per kind, asserting `validationError` is `None`, never merely "no `Unknown op`". (The ticket's AC3 carries the same weaker wording; it is the upstream artifact and need not be edited, but the proposal is this change's own binding summary and must not restate the refuted form.)

### Non-blocking notes

- Tasks 3.2/3.3 specify a "fully valid config per kind" but never mention that several kinds' inference validates config fields **against `inputSchema`** (e.g. `pivot`, `window`, `assert`, `compute` via `ExpressionEvaluator.validate`). The guard therefore needs a per-kind *input schema* compatible with each probe config, not just a valid config. The strict assertion will force the executor to discover this, but naming it in task 3.3 would save a cycle.
- Decision 5 cites `InProcessPipelineEngineSpec.scala:359,367`; the surrounding test blocks start at :353/:363. The line numbers are correct as of this tree but are the usual line-pinned-citation drift risk — quoting the test names alongside would be more durable.
