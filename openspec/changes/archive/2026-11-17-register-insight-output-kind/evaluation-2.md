## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 593d3681dff1155fb7b84ddc6792909524400bc4. I compared it against base 96ed5156b, resolved live with
resolve-review-base.sh, and looked at the cycle-2 delta from 30bf2390a. Before I started, the worktree was clean
(`git status` empty).

### Phase 1: Spec Review — PASS

- **CR1 (OutputPreviewPane site unguarded): resolved.**
  - The insight branch now sits above the loading and empty-rows early returns (`OutputPreviewPane.tsx:117-118`).
  - The `kind` prop is now typed `OutputKind`.
  - A `const _exhaustive: never = kind` check closes the table/collection/timeline fall-through (`:186-190`).
  - `OutputPreviewPane.insight.test.tsx` covers both the rows and no-rows cases.
  - I re-ran my cycle-1 mutation (insight branch neutralized). It is now RED twice: jest reports
    "FAIL OutputPreviewPane.insight.test.tsx", and `tsc` reports
    "OutputPreviewPane.tsx(188,11): error TS2322: Type '"insight"' is not assignable to type 'never'".
  - Task 2.1 and design D8 now describe the guard that was actually built: the never idiom where `kind` is typed, and
    jest tests plus mutations where `kind` comes from a wire string. Claim and code now match.
  - drift-mutations.md records P1, P2 and P4.
- **CR2 (migration renumber): resolved.**
  - The diff is a pure rename `V138__outputs_kind_insight.sql` -> `V141__outputs_kind_insight.sql` (similarity 100%).
  - origin/main's highest migration is still V137, so C1 holds.
  - The live references are updated: design D2/D2a, tasks C1/1.2, drift-mutations B8, sites.md, files-modified.md and
    proposal.md.
  - The remaining "V138" mentions are historical records only: ticket.md, skeptic-design-1/2.md, the D2a rationale and
    workflow-state LANE_DB.
  - The lane DB shows flyway 141 above 137.
- The earlier spec items stay PASS, as in evaluation-1:
  - every acceptance criterion
  - reads scoping (validating paths enforce, restore paths skip, dangling-reads PATCH returns 200)
  - no `model` key and no model call
  - no HEL-1755 files touched. The cycle-2 delta touches none of them either.
- CONSTRAINTS (C1): honored.

### Phase 2: Code Review — PASS

Gates, run fresh by me in WORKTREE_PATH at 593d3681d:
- `npm run lint`: clean
- `npm run format:check`: clean
- `npm --prefix frontend run typecheck`: clean
- `npm test`: root 66 suites / 579 tests, frontend 791 suites / 9659 tests, all passing
- `npm --prefix frontend run build`: OK
- `node scripts/check-schema-drift.mjs`: in sync
- `cd backend && sbt -J-Xmx3g testFull`: "Tests: succeeded 9675, failed 0, canceled 5", "All tests passed.", exit 0

Cycle-2 delta review:
- **Stale-allowance hardening** (`scripts/check-schema-drift.mjs:837-850`). An allowance that names an unknown surface,
  or a value that no longer drifts, is now an error, which closes the cycle-1 suggestion. Spot-check: I added
  `"markdown"` to the allowed set and the script exited 1 with
  `stale KNOWN_PRE_EXISTING_DRIFT allowance for "markdown" (it no longer drifts); delete the entry`. Source restored.
  The stale HEL-948 comment is corrected.
- **`OutputService.update`**. The reads gate is extracted into `checkUpdateReads` and the body is re-indented. Behaviour
  is unchanged: ValidateWrite checks, RestorePriorStored skips. testFull is green, including the OutputRoutesSpec
  HEL-1740 cases.
- **`OutputConfigValidation.articleFor`**. The message now reads "an insight Output" (seen live). `kindName` always
  comes from `OutputKind.asString` and is never empty, so `.head` is safe.
- The `OutputPreviewPane` import order is fixed.
- Every mutation I applied was restored with `git checkout --`, and `git status` was clean afterwards.

### Phase 3: UI Review — PASS

Setup: I signed up a fresh user (eval2-hel1740@example.test) on the recreated helio_hel1740, instantiated the founder
template, and created an insight Output through the API. The live API rejected `{model:"x"}` with 400: "Unknown config
key for an insight Output: `model`".

I then opened the insight in the Output editor:
- Preview card shows "Not yet rendered" plus the muted detail line. It no longer depends on rows.
- Kind is locked to Insight, and the configuration note is shown.
- Checked in light and dark at desktop (1440) and phone (390). There is no horizontal overflow at 390.

Console errors seen:
- Expected and pre-existing: the pre-login 401, my own deliberate 400 probes, and the pre-existing 404 on `/schedule`
  for an unscheduled pipeline.
- Unrelated to this lane: one 405 from another lane's port (7187), coming from the shared Playwright browser.

The dashboard-panel and live-column code is unchanged since cycle 1, which verified it in both themes at both widths
(evaluation-1).

Screenshots (persisted):
- /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/eval/c2-editor-desktop-dark.png
- /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/eval/c2-editor-desktop-light.png
- /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/eval/c2-editor-phone-dark.png
- /home/matt/Development/helio/.concertino/runs/HEL-1740/evidence/.concertino/scratch/HEL-1740/eval/c2-editor-phone-light.png

Lane-DB residue, all in helio_hel1740, which is dropped whole at Delivery:
- user eval2-hel1740@example.test
- dashboard e0d118f8-0623-47de-8b66-45903e9ae02f
- pipeline f9d53296-7d21-4368-853a-3c0f1c7f985a
- source 70912c4e-4162-4150-b097-cee0d55b04b8
- insight Output a6270786-bc09-4aac-9d93-808d011b0e07

### Overall: PASS

### Non-blocking Suggestions
- tasks.md 3.8 is still unchecked, with the text "NOT RUN, environmental ... covered by jest". The manual UI check has
  now been done by the evaluator (evaluation-1 Phase 3, evaluation-2 Phase 3). Point 3.8 at those reports so the
  archived tasks do not claim it never ran.
- Carried from cycle 1 for the skeptic (judgment only): the insight panel footer shows "UPDATED <date>" although
  nothing has rendered.
