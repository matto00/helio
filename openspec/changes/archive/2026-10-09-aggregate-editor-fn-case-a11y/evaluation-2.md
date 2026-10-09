## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `c6ab309c7847183f45310d6cec427a018d95b636`. Base resolved live: `e7470bc620557e3c0f27db637d7fb28811cb516c`. Cycle-2 delta reviewed: `ad112326..c6ab309c`.

### Phase 1: Spec Review — PASS
The cycle-2 delta is confined to evaluation-1.md CR1 and the two non-blocking suggestions. It adds one CSS rule plus a className on the p `FormField`, tightens the per-row test, trims `red-backend.txt`, and adds a residue note to design.md. There is no scope creep. Constraints C1 and C2 are still honored; the C1-relevant test code is unchanged except for the tightening.

`red-backend.txt` is now a 9-line excerpt with no ANSI codes or absolute paths. It still shows the three red failures, including `fn=min declared=integer: Some("integer") was not equal to Some("float")`.

### Phase 2: Code Review — PASS
Gates, fresh runs in WORKTREE_PATH:
- `npm run lint`: clean. `npm run format:check`: clean. `npm run typecheck`: clean.
- `npm test`: 482 suites, 5072/5072 tests passed (frontend), plus helio-mcp 418/418.
- `npm --prefix frontend run build`: OK.
- Backend: `git diff --quiet ad112326..HEAD -- backend` confirms the backend tree is byte-identical to the commit I ran `sbt testFull` against in cycle 1 (6425 passed, 0 failed). The executor did not re-run sbt; this identity check is why the cycle-1 result still applies.

Code notes:
- `PipelineDetailPage.css:1606-1610` (`.pipeline-detail-page__aggregate-p-field { flex: 1 1 100%; }`) uses no literals or tokens that would need checking, and its comment states the reason.
- The tightened test now asserts per-row label text (`row 1`/`row 2`) and distinct `aria-describedby` ids, each of which resolves to its own error element. This addresses the cycle-1 weakness.

### Phase 3: UI Review — PASS
Servers: reused and healthy (`assert-phase.sh servers` PASS). Vite serves the `aggregate-p-field` className from this worktree.

I measured live with `getBoundingClientRect()` at every breakpoint, in both themes, with p=90 (valid) and p=150 (error):

| viewport | p input width = alias input width | left edges equal | width stable across error toggle | overflow |
|---|---|---|---|---|
| 1440 | 766 = 766 | 457 = 457 | yes | 0 |
| 1100 | 766 = 766 | 287 = 287 | yes | 0 |
| 768 | 694 = 694 | 37 = 37 | yes | 0 |
| 375 | 309 = 309 | 33 = 33 | yes | 0 |

- Hint alignment: the hint now sits on its own line, with the p field's label 4px below it (`--space-1` row gap). It is no longer vertically centred against a label+input block, so the cycle-1 misalignment is gone at every width.
- Error state: `aria-invalid="true"` and `aria-describedby` point at the error element. Both are removed on a valid value. The error colour and invalid border use theme tokens in both themes.
- Console: only the pre-existing 404 on `/api/pipelines/:id/schedule` for a pipeline with no schedule.

Evidence (self-authenticating measurements, persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/e2e-evidence/HEL-1407/eval2-p-field-measurements.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/e2e-evidence/HEL-1407/eval2-agg-dark-1440-error.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/e2e-evidence/HEL-1407/eval2-agg-light-1440-error.png`

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Dev-DB residue still to clean up, by exact id:
  - Evaluator: user `cbb27962-bff1-4cf0-b3fb-a2f19ac54a34`, source `b23c918c-ba93-4479-bbea-405de71f6cbd`, pipeline `5819bbb3-9d14-413e-a716-586baae703c3`, dashboard `bc049a3b-bfb5-4a06-83b6-67fd5266168e`.
  - Executor: the ids recorded in design.md.
  - The earlier aborted run's user and source for pipeline `b29b8678-db6e-4cc5-b798-277f225eada3` are still unrecorded.
