# Evaluation Report — Cycle 1 (evaluation-1.md)

## Phase 1: Spec Review — PASS

Issues: none.

- AC1: `PipelineAnalyzeServiceSpec` "a valid step reports no validationError" + route-level
  counterpart in `PipelineAnalyzeRoutesSpec`. Both assert `validationError shouldBe None`.
- AC2: covered by five cases; expectation derived from `GroupByStep.apply` on real rows
  (`emittedVal.getClass shouldBe canonicalTypeToRuntimeClass(...)`), not from the config.
  `sum` over a float column -> `float` (runtime `java.lang.Double`); `count` over a *float*
  column -> `integer` (runtime `java.lang.Long`) — proves type follows the function;
  `"SUM"` -> `sum_amount: float` (lowercased once, feeding both name and `aggResultType`,
  which matches raw strings and would otherwise fall to `"string"`); multi-key order;
  absent-key best-effort `string`, documented in-source.
- AC3 (primary): see Phase 2.
- AC4: red arm independently re-verified (below).
- AC5: stale HEL-860 "unassertable" comment deleted; positive path asserted through the
  real route. `grep -rn unassertable backend/src/` — zero hits.
- Scope: 4 backend files only. No migration. No frontend / MCP / connector files touched.
  `files-modified.md` matches `git diff --name-only main...HEAD` exactly.
- Tasks all marked done and each matches what was implemented.

## Phase 2: Code Review — PASS

Gates re-run by me in `WORKTREE_PATH` (fresh, not the executor's report):

- `cd backend && sbt test` -> `Tests: succeeded 3960, failed 0`, `All tests passed`, exit 0.
- `openspec validate fix-groupby-inference-coverage-guard --type change` -> valid, exit 0.
- Frontend gates N/A (no `frontend/**` changes).

Coverage-guard audit against the five vacuity risks:

1. **Direct invocation** — yes. `inferOutputSchema(kind, config, inputSchema)` is called
   directly (`PipelineAnalyzeServiceSpec.scala:1268`); nothing routes through
   `analyze`/`analyzeNodes`. `inferOutputSchema` was widened only to `private[engine]` with
   an in-source comment stating that is its sole reason.
2. **Strong assertion** — `validationError shouldBe None`, not "not an Unknown op".
3. **Expected set from the registry** — `PipelineStep.Registry.keySet -- exemptions.keySet`.
   `probesByKind` is probe *input*, not the expected set; a registry kind with no probe hits
   `fail(s"'$kind' has no inferOutputSchema branch ...")`.
4. **No quiet exemptions** — `exemptions: Map[String, String] = Map.empty`, with two
   assertions: subset-of-registry, and `exemptions shouldBe empty`. All 23 registered kinds
   probed with per-kind valid configs and compatible input schemas (`string-body` `content`
   schema for `splittext`/`extractheadings`/`chunkbytokencount`; schema-consistent fields for
   `pivot`/`unpivot`/`compute`/`assert`). No assertion softened.
5. **Failure message names the kind** — confirmed live (below).

**Red arm independently re-verified.** I deleted `case "pivot" => inferPivot(...)` (a
validator-bearing kind — the CR2 direction) and re-ran the spec:

```
- should every kind in PipelineStep.Registry has an inferOutputSchema branch reachable by direct invocation *** FAILED ***
  'pivot' has no inferOutputSchema branch (validationError=Some(Unknown op: 'pivot')): Some("Unknown op: 'pivot'") was not equal to None
```

The guard fires and names the specific kind. Tree restored (`git checkout` of the single
file; `git status --porcelain` clean) and re-run green: `Tests: succeeded 113, failed 0`.

Other checks: no inline fully-qualified names in the new Scala (the only `com.helio.*`
additions are import lines); `inferGroupBy` reuses the file's `parseConfig` error convention
and the existing `aggResultType` helper; one definition of the aggregate column name shared
between runtime and analyze (`GroupByStep.outputColumnName`); no dead code, no TODOs, no
type-safety escape hatches, no security surface, no behavior change beyond the intended
dispatch arm.

## Phase 3: UI Review — N/A

Backend-only change (`backend/**` + `openspec/changes/**`). No `frontend/**`, no
`ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**` edits. No dev servers started.

## Overall: PASS

## Non-blocking Suggestions

- `probesByKind` is asserted to *cover* the registry but not to be free of *stale extra*
  keys. A `probesByKind.keySet.subsetOf(PipelineStep.Registry.keySet)` assertion would make a
  retired kind's leftover probe visible.
- The `lookup` (`{"columns":[]}`) and `assert` (`{"rules":[]}`) probes are valid but
  degenerate — they reach the branch while exercising little of its body. Non-empty configs
  would make the guard incidentally stronger; both kinds already have dedicated inference
  tests elsewhere in the spec, so this is polish, not a gap.
- `inferGroupBy` binds `json` from `parseConfig` but decodes via `GroupByConfig.decode(config)`
  and ignores it. Correct (the parse still gates malformed JSON), but `_ =>` would signal the
  intent.
