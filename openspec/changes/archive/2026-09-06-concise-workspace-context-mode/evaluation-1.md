## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `3b236fd5` (base `8231b191`). MCP-only change; Phase 3 N/A (no dev server started).

### Phase 1: Spec Review — PASS

All six acceptance criteria addressed, all 25 task items implemented as written.

- AC1 (analyze passthrough): `helioApi.ts` overload + query param, `read.ts:164-176` tool schema `concise: z.boolean().optional()` forwarded. Done.
- AC2 (concise workspace mode under budget on realistic 25/43): measured, see Phase 2 evidence.
- AC3 (full remains default): default arg `concise = false`; verified — see the one honest caveat under Non-blocking #1.
- AC4 (omission detectable): `truncation.applied` now genuinely derived (`omittedDetailKinds.length > 0`), replacing the hardcoded `false` at both former sites; `omittedDetailKinds` always present, `[]` in full mode (HEL-890 convention honoured).
- AC5 (descriptions state size behaviour): both tool descriptions updated, including the documented `analyze_pipeline` fallback for the omitted per-step columns (task 4.1).
- AC6 (red arm proven): verified independently by mutation, below.
- Task 5.1/5.3 honoured: `schemas/` is untouched, and the pre-existing staleness of `workspace-context.schema.json` was correctly left alone.
- No scope creep. Diff touches exactly 6 files under `helio-mcp/src/` plus the change dir. No backend, no migration, no UI, no drive-by refactor. The throwaway probe (`hel865Fidelity.probe.test.ts`) was never committed to main and is absent here — correct.

### Phase 2: Code Review — PASS

**Gates re-run by me, from the worktree root, with the PLURAL flag. Real counts observed:**

| Gate | Result |
|---|---|
| `npx jest --testPathPatterns=context` | **25 suites passed, 248 tests passed, 0 failed** |
| `npx jest --testPathPatterns=hel865` | **1 suite passed, 2 tests passed** |
| `npm run check:helio-mcp-types` | pass (`tsc --noEmit`, clean) |
| `npm run lint` | pass (`--max-warnings=0`) |
| `npm run format:check` | pass |

(Note for the record: running jest from `helio-mcp/` instead of the worktree root picks up the root babel config and yields `25 failed / Tests: 0 total`. The tasks' instruction to run from the worktree root is load-bearing; the counts above are from the root.)

**1. Evidence quality — the tests prove both directions on ONE fixture, and prove content.**
`context.test.ts:713` asserts full mode `structuralFloorExceedsBudget === true` and
`estimatedSizeBytes > DEFAULT_BUDGET_BYTES`; `:722` asserts concise `< DEFAULT_BUDGET_BYTES`
on the *same* `buildRealisticFixture()`. This is a genuine conversion of the old
under-budget assertion, not a deletion — both siblings flipped together as task 6.2
required. Content is asserted, not just size: breadth (25 sources / 43 pipelines both
retained), a step with N columns carrying `outputColumnCount === N` **and**
`not.toHaveProperty("outputColumns")`, per-source `inferredSchemaFieldCount === 60` with
`inferredSchema` absent, and every Output's `schema` compared array-wise against full mode
across all 43 pipelines (`toEqual`, not a length check).

**2. Red arm confirmed to fire — I mutated the implementation myself.**
Replacing `...(concise ? { outputColumnCount: outputColumns.length } : { outputColumns })`
with an unconditional `...{ outputColumns }` at `context.ts:522` (concise omits nothing)
produced:

```
✕ concise mode fits under budget on the SAME fixture ... (task 6.3)
✕ a step whose full entry lists N columns carries a count of N ... (task 6.5)
Tests: 2 failed, 27 passed, 29 total
```

The failure **isolates correctly**: only the size arm and the intended step-content arm go
red; breadth, Output-schema, truncation-flag and default-identity assertions stay green.
The implementation was restored and re-verified green (`git status` clean, 248/248).

**3. The fixture is honest, not inflated — and `laneTree` is genuinely populated.**
The promoted fixture keeps every conservative choice the prior gates credited: `config: {}`,
`inputSchema: []`, `sourceSchema: []`, zero dashboards, 14-field Output schemas, 1-3 outputs
per pipeline, and step widths that *narrow* down the pipeline (60→12) rather than holding 60
throughout. Nothing is padded to manufacture a number. I instrumented the built context
directly: `laneTree` length is **7 for every pipeline** and `stepsError` count is **0** — the
old fixture's `[]`-for-all-43 defect (fake API lacking `getPipeline`, swallowed by
`context.ts`'s try/catch) is not repeated; `realisticFakeApi` supplies a real `getPipeline`.

I also measured the payload myself rather than trusting the design table:
**full = 465,036 bytes** (exactly design.md's figure) and **concise = 180,951 bytes** against
the 200,000 budget — 9.5% headroom, matching design D8's 180,726 to within 225 bytes (the
delta is the new, empty `omittedDetailKinds` key). **Nothing was added to the concise
projection that busts the headroom.**

**4. Byte-identical default — proven for the payload, with one designed caveat.**
`context.test.ts:795` deep-compares the default-args response against an explicit
`(DEFAULT_BUDGET_BYTES, false)` response over independently-built fixtures, stripping only
the live `generatedAt`, and additionally asserts the concise-only keys are absent from the
default response. Every entity payload is unchanged from main. See Non-blocking #1 for the
one key that is additively new.

**5. `schemas/` byte-unchanged — independently re-confirmed.**
`git diff main --name-only | grep -c schemas/` → **0**; the full `--name-only` list contains
no `schemas/` path at all.

**Code quality:** no inline fully-qualified names; no `any`, no `@ts-ignore` (the sole
`as unknown as HelioApi` is the file's pre-existing fixture idiom). The overload on
`analyzePipeline` is the right call given the two modes return wholly different top-level
shapes — a widened parameter would have lied to callers. `CONCISE_OMITTED_DETAIL_KINDS` is
named once so the report and the projection cannot drift. Comments explain *why* (design
refs), not *what*. No dead code, no TODOs, no premature abstraction.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. Per the
orchestrator's instruction and the trigger list, no dev server was started.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions

1. **The default response is byte-identical in payload but gains one key.** `truncation`
   now always carries `omittedDetailKinds: []`, which main did not emit. This is the
   deliberate, argued resolution of the tension between AC3 ("byte-identical") and AC4
   ("always present, never `undefined`"), documented at design.md D4 — I am recording it,
   not objecting to it. The test's "byte-identical" label proves default === explicit-false,
   which is the meaningful claim; a reader should not take it as default === pre-change.
2. **Consider asserting `laneTree.length > 0` in the fixture suite.** The fixture populates
   it correctly today, but nothing *guards* it. If `getPipeline` ever broke, `context.ts`'s
   try/catch would silently degrade `laneTree` to `[]`, shrinking both arms — full would
   likely still exceed budget and concise would still fit, so the suite would stay green
   while quietly reverting to the exact thin-fixture measurement design D1 blames for the
   prior false certification. One line closes the loop.
3. **The headroom is recorded as a lower bound (`> 150_000`), not the number.** D8 asked for
   the measured size to be visible to future work; a `> 150_000` floor conveys "not
   collapsed" but not the 9.5% margin. A comment carrying the measured 180,951 would make
   the "treat concise as full" warning legible at the assertion site.
