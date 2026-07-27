## Evaluation Report — Cycle 2

### Phase 1: Spec Review — PASS

Cycle 1's single Change Request (design.md D3/D6 staleness re: hardcoded `SampleRowLimit`(5)/
`ExampleValueLimit`(5) vs. the shipped data-derived-cap approach) is resolved in commit `527cfecb`
(on top of `ce677c17`, not amended — correct per convention). Verified via `git diff
ce677c17..527cfecb -- openspec/changes/token-budget-workspace-context/design.md`:

- D3 tier-1/tier-2 prose now states the natural cap is "derived from the data itself — the MAX
  `sampleRows`/`exampleValues` length observed" rather than "reduced from `SampleRowLimit`(5)".
- D4's algorithm walkthrough (step 2/3) now says `0..naturalSampleRowsCap`/
  `0..naturalExampleValuesCap` instead of `0..SampleRowLimit`/`0..ExampleValueLimit` — this spot
  was not explicitly named in the cycle-1 change request text but is the same underlying issue;
  fixing it proactively is correct and consistent with the request's intent.
- D6's case-class inline comments now read "equals each DataType's own natural sampleRows length
  when untouched (at most `SampleRowLimit`, 5)" / the analogous `exampleValuesCap` wording —
  matching `schemas/workspace-context.schema.json`'s already-correct description verbatim in
  spirit.

Grepped the full document for remaining `SampleRowLimit`/`ExampleValueLimit` mentions
(`design.md:81,83,89,162,164,235,237`): every remaining occurrence now correctly frames the
constant as an upper bound the data-derived cap cannot exceed (or as the DRY rationale for not
re-reading it), never as "the cap actually applied when untouched." No stale hardcoded-constant
claim remains anywhere in the document.

### Phase 2: Code Review — PASS

**Two new heterogeneous-natural-size tests, verified to actually pin the described behavior** (the
cycle-1 non-blocking suggestion): read both `WorkspaceContextServiceApplyBudgetSpec.scala`'s and
`context.test.ts`'s new cases directly.

- Each constructs one DataType/column with a smaller natural size (`sampleRows.take(2)` /
  `exampleValues.slice(0, 2)`, vs. the other fixtures' natural 5) alongside two full-sized ones.
- Within-budget case asserts the derived cap is the MAX (5) — not a MIN, not an assumption that
  every DataType/column shares the same size — while the small one's own array still reports its
  true smaller length (2), proving the cap is a ceiling, not a forced uniform value.
- The tier-1-cut case forces the cap down to `naturalCap - 1` (4) — strictly ABOVE the small
  fixture's own natural size (2) — and asserts the small DataType/column's array is untouched at 2
  (proving `take`/`slice` saturation, not a crash or unexpected truncation) while the two
  full-sized ones are correctly cut to exactly 4. This is precisely the scenario cycle 1 flagged as
  unpinned and is a real, specific regression test, not a restatement of the existing uniform-size
  cases.

**No code or test-behavior changes beyond the doc fix and the two additive tests**, confirmed via
`git diff ce677c17..527cfecb --stat -- backend/src/main helio-mcp/src/context.ts schemas/
backend/src/main/scala/com/helio/api/routes/WorkspaceRoutes.scala` (empty — zero production-code
or schema delta), and via reading both test-file diffs directly (pure appends; no existing
assertion lines were touched in either file).

**Gates re-run fresh (cycle 2, not trusted from the executor's report):**
- `sbt test`: 2350/2350 passed (2 new tests vs. cycle 1's 2348), 0 failed.
- `npm test` (root, full — MCP + frontend): MCP suite 94/94 passed (2 new tests vs. cycle 1's 92);
  frontend 1433/1433 passed, 138 suites, unchanged.
- `npm run lint`: clean.
- `npm run format:check`: clean.
- `npm run check:schemas`: in sync (32 checked across 28 protocol files) — expected, since no
  schema file changed this cycle.
- `npm run check:scala-quality`: clean (only informational file-size warnings; the two touched
  spec files' line counts shifted with the additive tests, no new violations).
- `npm run check:openspec`: reproduces the same single known false positive ("complete (25/25) but
  not archived") as cycle 1 — expected, unchanged, still the legitimate HEL-374-precedent case.
- `npx openspec validate token-budget-workspace-context --strict`: **"Change
  'token-budget-workspace-context' is valid."**

### Phase 3: UI Review — N/A

Unchanged from cycle 1 — no `frontend/**` files touched this cycle either (confirmed via the
scoped diff stat above).

### Overall: PASS

No outstanding change requests. The cycle-1 finding is fully resolved, verified against fresh
evidence (not the executor's self-report) at every gate, and the two new tests genuinely
strengthen coverage for the deviation that prompted the original finding.
