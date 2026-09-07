## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit af6b407f, branch bug/spurious-unknown-op-groupby/hel-872. Backend-only; no UI surface, so no browser work performed (correctly scoped — `git diff main...HEAD --name-only` touches only `backend/` and `openspec/`).

### What I verified (with evidence)

**Premise (the drift finding everything rests on) — TRUE.**
- `git show main:.../PipelineAnalyzeService.scala | grep -c 'case "groupby"'` → `0`.
- Same for `case "join"` → `2` (dispatch arm + HEL-911 comment reference). So `join` was live and `groupby` was not, exactly as the restated ticket claims.
- `PipelineStep.Registry` (PipelineStep.scala:205-229) has **23** entries; `probesByKind` has 23 keys, one per entry.

**AC1 — no validationError for valid groupby.** `case "groupby" => inferGroupBy(...)` added at PipelineAnalyzeService.scala:483. Asserted at service level (`analyze` → `validationError shouldBe None`) and at route level.

**AC2 — schema types are RIGHT against the runtime, not merely self-consistent.**
- `GroupByStep.apply` (GroupByStep.scala:80-88): `sum` → `nums.sum` over `PipelineRowJson.toDouble` ⇒ `java.lang.Double`; `count` → `.toLong` ⇒ `java.lang.Long`.
- `aggResultType` maps `count`→`integer`, `sum`→`float`. That matches the emitted runtime classes.
- The tests do **not** re-derive the expectation from the config: they call `GroupByStep.apply` on real fixture rows and assert `emittedVal.getClass shouldBe canonicalTypeToRuntimeClass(...)` alongside the projected type. That is a genuine runtime-anchored expectation.
- Function-over-column-type: `count` over a `float` column asserted `integer` (PipelineAnalyzeServiceSpec, "type follows the FUNCTION"). Confirmed correct — `aggResultType` never consults `inputSchema` for `count`/`sum`.
- Upper-case `"SUM"`: `inferGroupBy` lowercases once and feeds that same `fn` to both `outputColumnName` and `aggResultType`; test asserts `sum_amount: float` (not `string`). I confirmed the hazard is real — `aggResultType`'s `case _ => "string"` would have caught a raw `"SUM"`, and `validateGroupBy` lowercases before its own check, so the bug would have been silent. Correctly closed.
- Missing group-key column → best-effort `string`, documented in-source at the fallback site, mirroring HEL-911's `join` documentation convention. Acceptable per AC2's "any genuinely best-effort case documented in-source".

**AC3 (PRIMARY) — the coverage guard. Attacked directly.**
- It calls `inferOutputSchema(kind, config, inputSchema)` **directly**, never via `analyze`. Expected set is `PipelineStep.Registry.keySet -- exemptions.keySet` — derived from the registry, not a second constant. Assertion is `validationError shouldBe None`, not "does not contain Unknown op". Failure message names the kind.
- `exemptions` is `Map.empty` and there are two separate tripwires: `exemptions.keySet.subsetOf(Registry.keySet)` and `exemptions shouldBe empty`. So a future kind cannot be quietly exempted — adding it to `exemptions` turns the second test red. Exemption is by explicit name, never by pattern.
- **Can it pass while a registered kind lacks a dispatch branch?** I could not construct such a case. The three escape routes all close: (a) kind in registry, no probe → `getOrElse(kind, fail(...))` red; (b) kind in registry, probe present, arm missing → falls to `case unknown` → `Some("Unknown op: ...")` red; (c) kind exempted → `exemptions shouldBe empty` red. `parseConfig` also converts any decode throw into `Some("<op> config error")`, so a broken probe reports red rather than green.
- **Own mutation (independent instrument check), on kinds the executor and evaluator did NOT use.** Deleted `case "unpivot" => inferUnpivot(...)` (line 479) and removed `"dedupe"` from the combined passthrough arm (line 454), then ran `sbt 'testOnly ...PipelineAnalyzeServiceSpec'`:
  ```
  - should every kind in PipelineStep.Registry has an inferOutputSchema branch reachable by direct invocation *** FAILED ***
    'dedupe' has no inferOutputSchema branch (validationError=Some(Unknown op: 'dedupe')): Some("Unknown op: 'dedupe'") was not equal to None
  ```
  Restored via `git checkout --` and re-ran: `Tests: succeeded 138, failed 0`. Instrument verified red-then-green on a kind nobody else probed.
- **Probe degeneracy check.** `lookup -> {"columns":[]}` and `assert -> {"rules":[]}` are thin, and the `filter/limit/sort/dedupe/fillnull` arm is an unconditional passthrough that never reads the config. But degeneracy cannot defeat this guard's stated purpose: deleting any of those arms still routes to the `unknown` arm and goes red (proved above for `dedupe`, which is exactly one of the passthrough kinds). Noted below as non-blocking, not a refutation.
- No input schema looked rigged: `baseSchema` / `contentSchema` are ordinary, and the configs reference real fields in them.

**AC5 — stale comment.** `grep -rn "unassertable" backend/src/` returns **nothing** (exit 1), full-tree. The comment at PipelineAnalyzeRoutesSpec.scala:492-497 is replaced by a real positive-path test.

**Route test is genuine and non-redundant.** `"return 200 with no validationError for a valid groupby step"` seeds a real pipeline via `pipelineStepRepo.insertRootStep`, hits `Get(s"/pipelines/$pid/analyze") ~> routes`, and asserts `validationError shouldBe None` plus `sum_amount` in `outputSchema`. That path runs `validateStepConfig` → dispatch through the HTTP route and repository, which the service-level spec (in-memory `analyze` on constructed steps) does not.

**AC4 — red arm.** Independently satisfied by my own mutation above, on a different kind than the recorded evidence, which is stronger than re-reading the report's claim.

**Iron Laws.** Debugging law: the ticket records a probe-confirmed root cause with negative controls (`select`/`join` green, `groupby` red) before any fix; the regression guard would genuinely catch recurrence, as my mutation demonstrates.

**Gates re-run by me, not trusted from the report.**
- `cd backend && sbt -batch test` → `Total number of tests run: 3960 / succeeded 3960, failed 0` / `[success] Total time: 355 s`.
- `openspec validate fix-groupby-inference-coverage-guard --type change` → `Change 'fix-groupby-inference-coverage-guard' is valid`.
- `npm run check:scala-quality` → `clean (158 soft warning(s))` — no inline-FQN violations. The `java.lang.Long`/`java.lang.Double` references in the new test are established repo precedent (AggregateStepSpec.scala:192, NestedJsonFlatteningSymmetrySpec.scala:94, InProcessPipelineEngineSpec.scala:2077) and are not what the Imports & Qualifiers rule targets.

**Scope hygiene.** No migration added (`git diff --name-only | grep -i migration` empty). No MCP-client, connector, or frontend files touched. `inferOutputSchema` widened to `private[engine]` only — the narrowest widening that lets a same-package spec call it — with a six-line in-source comment stating the single reason and forbidding further widening. Not over-widened.

**Spec delta matches what was built.** Both ADDED requirements correspond to shipped code: the groupby projection requirement (four scenarios, all mirrored by real tests) and the registry-vs-dispatch invariant, whose wording ("expected set derived from `PipelineStep.Registry`", "invoking `inferOutputSchema` DIRECTLY", "exempted by explicit name") is an accurate description of the implemented guard, not an aspiration.

### Verdict: CONFIRM

### Non-blocking notes

- The guard's `foreach` + assertion aborts on the first uncovered kind, so with two simultaneous gaps my mutation reported only `dedupe`; `unpivot` would surface on the next run. AC3 asks that the message name *the* specific kind, which it does — but collecting all failures and naming them together would make a multi-kind regression a one-pass fix.
- `lookup -> {"columns":[]}` and `assert -> {"rules":[]}` are the two thinnest probes. They satisfy the coverage contract (proved above), but if either infer function later grows a branch that only executes on a non-empty list, the probe will not exercise it. Worth a non-empty config next time either is touched.
- `inferGroupBy` uses `parseConfig(...) { json => ... }` but ignores `json`, calling `GroupByConfig.decode(config)` instead. Harmless (it inherits the error handling, which is the point), but the unused binding is mildly misleading.
- `probesByKind` keys not present in the registry would go unnoticed; only the registry→probe direction is checked. Low value to fix, but a `probesByKind.keySet.subsetOf(Registry.keySet)` assertion would be one line and symmetric with the existing exemptions check.
