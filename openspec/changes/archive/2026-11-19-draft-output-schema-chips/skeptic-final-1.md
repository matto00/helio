## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 99ff5a179a33a076adce2b82b38ca577e3a377ae. Base cfb6041bf2443e6796dd28a677b89bf19a5135c1, resolved live with `resolve-review-base.sh` (exit 0).

### What I verified (with evidence)
- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/draft-output-schema-chips/HEL-1777`.
- **Diff read in full**: `rowOps.ts` (+`renameOrigins` on `foldRenames`), `draftColumnOrder.ts` (exports `renamesOf`), new `draftSchemaFields.ts` and its test, `StepPreviewTable.tsx` (`showsDraftGrid`, `draftFields`, `chipFields`), and the new component test.
- **AC1, red on main (confirmed independently)**: I made a detached worktree at the base, added only 126e4eece's test file and ran it with jest (3 workers, nice 19). Result: `Tests: 3 failed, 2 passed`. The rename test fails for the right reason: expected `"zone"`, received `"region"` in the chip list. I removed the throwaway worktree afterwards.
- **Green on HEAD**: jest `--testPathPatterns=features/pipelines` gave `Test Suites: 207 passed`, `Tests: 3200 passed`. `npm run typecheck` and `npm run lint` were both clean.
- **Grid render condition is unchanged**: `showsDraftGrid` is read only inside the `draftActive` branch, which comes after the `!step.enabled` and `isCreating || isDraft` branches. There it reduces to the old `draftFrame !== null && status !== "notPreviewed"` (StepPreviewTable.tsx:162-168 and 213-242).
- **AC2, live check**: I started the servers with the canonical script on `helio_hel1777`. Without `DB_USER` the backend failed: "no PostgreSQL user name specified in startup packet". That confirms the evaluator's claim that it needs `DB_USER=matt`. With `DB_USER=matt` and an empty `ANTHROPIC_API_KEY`, `assert-phase servers` printed PASS. I seeded a throwaway user with a static source (id, region, amount) and two steps: rename amount→total, then filter total ≥ 0. A draft rename of region→zone on step 1 gave chips `[id, zone, total]` and grid headers `id float | zone string | total float`. The chips match the grid in names and order.
- **AC3, no request**: a PerformanceObserver on `/api/` resources recorded `[]` across the filter edits, the step switch and the rename typing.
- **Regression found (reproduced live, and it follows from the code)**: on step 2, I set the draft filter to `total ≥ 1000`, which matches no rows. The count reads `0 rows`, the caption reads `live`, and the "Output schema" chips disappear completely (`chips: []`). Setting the value back to 15 brings them back (`[id, region, total]`). On base the chips always render `analyzeOutputSchema`, so they stayed visible. Why: `frameSchema([])` is `[]`, so `orderColumns([], columnOrder)` is `[]` (`orderColumns` drops schema names that are not present in the frame). That makes `draftFields = []`, so `chipFields = []`, and the guard `chipFields.length > 0` hides the whole chip group. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1777/evidence/.concertino/scratch/HEL-1777/skeptic-empty-filter-chips-gone.png`.
- **Cleanup**: I deleted the throwaway user (`50284acf-43fa-4177-b56e-c9207b171d71`) by exact id with `buildUserDeleteSql`; a count afterwards returned 0. I stopped the servers with `stop-servers.sh`.
- **UI design (DESIGN.md)**: no CSS or class changes. The chips and the disclosure reuse the existing `step-preview__schema-chip` and `OutputSchemaDisclosure`, so light and dark parity is unchanged by construction. The only new visual behavior is the regression above.

### Verdict: REFUTE

### Change Requests
1. **Do not erase the Output schema when a draft frame has zero rows.** Location: `StepPreviewTable.tsx`, the `draftFields` memo (~line 173), together with the `chipFields.length > 0` guard (~line 309).
   - **Problem**: a draft filter that matches nothing is routine while a user types a threshold. The step's output still has columns `id, region, total`, but the chips vanish and the header shifts on every keystroke that crosses zero rows. On main the schema stayed visible. The spec's "No draft grid shown" scenario does not cover this case, and no test covers it.
   - **Required fix**: when `draftFrame.length === 0`, the chips must still show a schema. Either use the draft's known column names (`draft.columnOrder` where it covers the step) or fall back to `analyzeOutputSchema`. Choose, and add a component test: a draft frame of `[]` on a filter step keeps a non-empty chip list.
   - **Grid header**: decide whether the empty grid should also show those headers so that chips and grid still agree. If not, record the choice in the spec delta.
2. **Add an empty-draft-frame scenario to `specs/pipeline-draft-mode-ui/spec.md`** so the chosen behavior is a written requirement.

### Non-blocking notes
- D4 says the jest tests assert that `httpClient` was not called. The test only asserts `fetchStepPreview`. Align the wording, or assert at the `httpClient` level.
- `StepPreviewTable.tsx` imports two different `renamesOf` functions (one aliased `draftRenamesOf`). Renaming the exported fold-order one at its source would make the difference explicit.
- design.md, proposal.md, ticket.md and specs/ are still untracked in the worktree.
- The static source's `id` column shows the type `float` (from the saved analyze). This is pre-existing and out of scope.
