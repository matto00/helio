## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL

Issues:

1. **Planning artifact drift (design.md D3/D6 vs. shipped code) — the epic's own most-repeated
   failure mode, reintroduced.** design.md D3/D6 describes `sampleRowsCap`/`exampleValuesCap`
   (when untouched) as literally the hardcoded constants `SampleRowLimit` (5) /
   `ExampleValueLimit` (5) — e.g. D6's inline comment `sampleRowsCap: Int, // cap actually
   applied; SampleRowLimit (5) if untouched`, and D3 step 2/3's "reduced from `SampleRowLimit`
   (5) toward 0" / "reduced from `ExampleValueLimit` (5) toward 0". The shipped code does not do
   this: `WorkspaceContextBudget.scala:163-165` derives `naturalSampleRowsCap`/
   `naturalExampleValuesCap` dynamically as the max observed size across all DataTypes/columns
   (`response.dataTypes.map(_.sampleRows.size).maxOption.getOrElse(0)`, and the analogous
   `exampleValues` reduction), and `context.ts:729-738` mirrors this with `Array.reduce`/
   `Math.max`. This is a legitimate, arguably-better engineering choice (avoids re-reading a
   duplicated magic constant, per DRY) and is disclosed in code comments
   (`WorkspaceContextBudget.scala:159-162`) and `files-modified.md`'s prose — but it was never
   fed back into design.md, which is the CONFIRMed (round-2 skeptic `CONFIRM`) artifact. The
   `schemas/workspace-context.schema.json` description for `sampleRowsCap` was correctly updated
   to say "equals each DataType's own natural sampleRows length when untouched (at most 5)" —
   proving the schema/code are in sync with each other, just not with design.md. This is
   precisely the failure class ticket.md's carried finding #5 warns about ("confidently-worded
   but false documentation is this epic's most repeated failure") and the design-gate brief's
   explicit instruction to keep design.md matching shipped behavior.

   I independently verified this deviation is functionally safe (does not break D3's tier-0
   invariant or shed order): `max`/`Math.max`-based derivation is commutative/associative, so
   Scala `Map`/TS `Object` iteration order cannot affect the result (no tie-break-by-encounter-
   order logic exists — it's a pure max reduction), and `Vector.take(cap)`/`Array.slice(0, cap)`
   gracefully saturate when `cap` exceeds a given DataType's/column's actual natural size, so
   using the data-derived max instead of the fixed constant as the search's upper bound produces
   an identical trimming result in every case. This is a documentation-only gap, not a logic bug
   — but per this evaluator's mandate ("Planning artifacts reflect the final implemented
   behavior" is an explicit Phase 1 checklist item) it is a FAIL until design.md is corrected.

All other Phase 1 items PASS:
- All 7 ticket acceptance criteria are explicitly and fully addressed (trim order/determinism/
  truncation marker/structural-identity/backend-MCP parity/green tests+schema/backward-compat
  default) — verified against fresh test runs, not just tasks.md checkboxes.
- No AC silently reinterpreted.
- All 25 tasks.md items are done and match what's implemented (spot-checked 2.1-2.9, 3.1, 5.1-5.3,
  6.1-6.2 directly against source).
- No scope creep — every touched file is on the ticket's own Impact list (proposal.md); no
  unrelated refactors.
- No regressions: full existing suite green (2348 backend / 92 MCP / 1433 frontend, see Phase 2).
- API contract: `schemas/workspace-context.schema.json` updated and `check:schemas` (JsonProtocols
  ↔ schema drift check) passes.
- D4 (cost-bound fix) and D3 (shed order + tier-0 invariant) were independently re-verified against
  the actual shipped code (not just tasks.md), per this cycle's specific brief — see Phase 2 below.

### Phase 2: Code Review — PASS

**D4 verification (cost-bound fix, the round-1 design-gate finding) — confirmed genuinely fixed,
not relabeled.** Read `WorkspaceContextBudget.scala` end-to-end. `coreSize(response)` (a full
`response.toJson` serialization) is called exactly ONCE per `apply` invocation, as `naturalSize`,
used only for the fast-path comparison and as the base for the arithmetic decomposition. Every
candidate-cap search (`findLargestFittingCap` via `sampleRowsLenAt`/`exampleValuesLenAt`/
`joinHintsLenAt`) serializes only small, disjoint subtrees — one DataType's own `sampleRows` array,
one column's own `exampleValues` array, or a prefix of the top-level `joinHints` array — never the
full multi-DataType response. This exactly matches design.md D4's algorithm and the round-2
skeptic's independent verification (`skeptic-design-2.md`: "CONFIRM... I independently verified the
mathematical soundness of that decomposition against the real wire types"). The TS mirror
(`context.ts:657-717`) is structurally identical. Both sides' pure-unit tests include an
arithmetic-exactness assertion (`WorkspaceContextServiceApplyBudgetSpec.scala` "apply (arithmetic
exactness)"; `context.test.ts` "reports an estimatedSizeBytes that exactly equals...") that would
catch a regression to full-response reserialization.

**D3 verification (shed order + tier-0 invariant) — confirmed correctly implemented and tested,
including at `budgetBytes=0`.** `WorkspaceContextBudget.apply`'s tier cascade (sampleRows → tier 1,
exampleValues → tier 2, joinHints → tier 3, structural floor last) matches D3 exactly; tier 0
(`counts`, `dataSources`, DataType `id`/`name`/`sourceId`/`pipelineOutput`/`columns[]`/
`computedColumns[]`/`version`/`tag`, `columnStats[*]`'s scalar fields, `pipelines[]`/`steps[]`,
`dashboards`) is never touched by any `.copy(...)` call in the trimming path. The "budgetBytes = 0"
unit test constructs a rich fixture (columns with `semanticRole`, `columnStats` scalars, pipeline
`steps[]`, dashboards) and asserts every tier-0 field is byte-identical to its natural value while
only `exampleValues`/`sampleRows`/`joinHints` are emptied — this is a real, specific pin, not a
weak "still present" check. The data-derived natural-cap deviation (see Phase 1 finding) does not
compromise this: confirmed by direct code reading (max-reduction is order-independent; `take`/
`slice` saturate gracefully for any DataType whose natural size is below the derived max).

**Other checks:**
- DRY: no duplicated logic; reuses `computeJoinHints`'s existing sort order (HEL-374 D2) rather than
  re-sorting; the data-derived cap approach itself is a DRY improvement over re-reading a duplicated
  literal.
- Readable/modular: `WorkspaceContextBudget` is a new, focused, pure object (307 lines, over the
  ~250 soft budget but well under the ~400 "propose a split" threshold — informational only per
  `CONTRIBUTING.md`/`check:scala-quality`); correctly kept as a new file rather than growing the
  705-line `WorkspaceContextService.scala` (HEL-631, deferred as instructed).
- Type safety: no `Option`/`any` escape hatches; `WorkspaceContextTruncation` fields are all
  non-`Option` scalars/vectors as design.md D6 mandates (no spray-json omission risk).
- Security: `budgetBytes` query param is validated (`400` on negative) before use; no new
  injection/XSS surface (server-side-only trimming pass).
- Error handling: negative `budgetBytes` → explicit `400` with a message, not silently clamped or
  ignored.
- Tests meaningful: exhaustive tier-by-tier coverage on both Scala and TS sides (within-budget,
  tier-1-only, tier-1+2, tier-1+2+3, structural floor, tier-0 invariance, determinism, arithmetic
  exactness, pagination truncation, cross-language parity, route-level wiring incl. schema
  validation) — would catch a real regression to any of the ticket's core guarantees.
- No dead code / TODO/FIXME in the new files (`WorkspaceContextBudget.scala`, `context.ts`
  additions, `WorkspaceRoutes.scala` diff) — grep-verified.
- No over-engineering: single global uniform cap per tier (not per-DataType-selective), matching
  D4's own stated complexity/determinism rationale.
- Imports/qualifiers: `check:scala-quality` ran clean (no inline-FQN violations); only informational
  file-size warnings, none new-and-blocking.

**Gates re-run fresh (not trusted from the executor's report):**
- `sbt test`: 2348/2348 passed, 0 failed.
- `npx jest` (root, covers `helio-mcp/src/context.test.ts`): 92/92 passed.
- `npm test` (full, incl. frontend Jest): 1433/1433 passed (138 suites).
- `npm run lint`: clean (zero-warnings).
- `npm run format:check`: clean.
- `npm run check:schemas`: in sync (32 checked across 28 protocol files).
- `npm run check:scala-quality`: clean (only informational file-size warnings, pre-existing +
  the two new HEL-377 test/impl files listed among them).
- `cd helio-mcp && npx tsc --noEmit`: clean.
- `npm run check:openspec`: reproduces the SAME single finding the executor disclosed — "change
  'token-budget-workspace-context' is complete (25/25) but not archived" — confirmed this is the
  known false positive (archiving happens post-merge, not pre-commit), matching the HEL-374
  precedent (`fac7cbec`). This is the ONLY disclosed hook bypass, and it is legitimate. Every
  OTHER hook in the Husky chain (lint, format:check, check:schemas, check:scala-quality, test) was
  independently re-run above and passes — the `-n` bypass was not used to skip anything else.

### Phase 3: UI Review — N/A

No `frontend/**` files touched (verified via `git diff main...HEAD --stat -- frontend/`, empty).
`backend/.../ApiRoutes.scala` not touched. `schemas/**` was touched, but grep confirms no frontend
code references `workspace/context`/`workspace-context` — this is a backend/MCP-only API surface
with no UI consumer, per the ticket's own framing. Treated as N/A per task instructions.

### Overall: FAIL

### Change Requests

1. Update `openspec/changes/token-budget-workspace-context/design.md` D3 and D6 to describe the
   actually-shipped data-derived natural-cap approach (a `maxOption`/`Math.max` reduction over
   each DataType's/column's own natural `sampleRows`/`exampleValues` length —
   `WorkspaceContextBudget.scala:163-165`, `context.ts:729-738`) instead of the current text's
   "`SampleRowLimit` (5)"/"`ExampleValueLimit` (5) if untouched" hardcoded-constant framing. The
   `schemas/workspace-context.schema.json` `sampleRowsCap`/`exampleValuesCap` descriptions already
   use the correct "natural...length when untouched (at most 5)" phrasing — mirror that wording
   into design.md so the CONFIRMed planning artifact matches the shipped code, per the epic's
   carried finding #5 (no confidently-wrong/stale documentation).

### Non-blocking Suggestions

- Consider adding one Scala + one TS test constructing DataTypes/columns with heterogeneous
  natural `sampleRows`/`exampleValues` sizes (e.g. one DataType naturally has 2 sample rows, another
  has 5) and asserting the derived `sampleRowsCap`/`exampleValuesCap` equals the max across them,
  and that the smaller DataType's array is left untouched by `take`/`slice` saturation when
  untouched. All current fixtures use uniform per-DataType/per-column natural sizes, so this
  specific behavior (mathematically sound, confirmed by code reading) isn't directly pinned by a
  test today.
