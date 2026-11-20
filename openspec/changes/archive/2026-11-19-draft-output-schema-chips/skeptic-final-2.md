## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 151ca0ef253d3d809bbb5b501055a7b5a747be9f. Base cfb6041bf2443e6796dd28a677b89bf19a5135c1, resolved live with `resolve-review-base.sh` (exit 0).
Commits on the branch: 126e4eece (red tests), 99ff5a179 (fix), 143a2824d (red: empty frame), 151ca0ef2 (empty-frame fallback, `foldOrderRenamesOf` rename).

### What I verified (with evidence)
- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/draft-output-schema-chips/HEL-1777`.
- **Diff read in full**: `rowOps.ts` (`renameOrigins` built on `foldRenames`), `draftColumnOrder.ts` (`renamesOf` exported as `foldOrderRenamesOf`), `draftSchemaFields.ts` and its test, `StepPreviewTable.tsx` (`showsDraftGrid`, `draftFields`, `chipFields`), and `StepPreviewTable.schemaChips.test.tsx`.
- **AC1, red on main (reproduced myself)**: I created a detached throwaway worktree at the base, copied in only HEAD's `StepPreviewTable.schemaChips.test.tsx`, and ran it with jest (3 workers, nice 19). Result: `Tests: 3 failed, 3 passed`. The failures are rename, large schema and descendant, each with the right symptom: the chips expected `"zone"` and received `"region"`. The three tests that pass on base are the saved-chip cases (disabled, not previewed, empty frame), which are true on main by construction. I removed the throwaway worktree (`git worktree list | grep -c skf2` returned 0).
- **Round-1 CR1 fix, red first**: in a throwaway worktree at 143a2824d (the red commit, before the fix), the empty-frame test was the only failure (`1 failed, 5 passed`). On HEAD it passes.
- **Empty-frame claim checked in code**: `draftColumnOrder` returns `[]` when `frame.length === 0` (`draftColumnOrder.ts:21`). On the server-resolved path, `orderColumns(frameSchema([]), names)` is also `[]`, because `orderColumns` keeps only schema names that are present in the frame (`panels/state/columnOrder.ts:9-14`). So D1a's premise, "draft.columnOrder is empty for a zero-row frame", holds. `chipFields` falls back to `analyzeOutputSchema` only when `draftFields` is empty, so the chip group is hidden only when the saved schema is empty too, which is main's behavior.
- **Grid render condition**: `showsDraftGrid` is read only inside the `draftActive` body branch, after the `!step.enabled` and `isCreating || isDraft` branches. There it reduces to main's `draftFrame !== null && view?.status !== "notPreviewed"`, so the grid's visibility is unchanged.
- **Gates (fresh, at HEAD)**: `npm --prefix frontend run typecheck` exited 0. `npm run lint` passed with `--max-warnings=0`. `prettier --check` on `src/features/pipelines`: all files formatted. jest `--testPathPatterns=features/pipelines`: `Test Suites: 207 passed`, `Tests: 3201 passed`.
- **AC3 e2e guards, re-run at HEAD**: the evaluator's run was at 99ff5a179, before the fix commit, so I ran them again. I started the servers with `start-servers.sh` on `helio_hel1777` (`DB_USER=matt`, `ANTHROPIC_API_KEY` empty) and `assert-phase servers` printed PASS. Playwright, 2 workers, run on `hel1631-draft-mode` and `hel1632-live-output`: `25 passed (1.5m)`.
- **Live check** (throwaway user; a static source with id:integer, region:string, amount:integer; step 1 renames amount→total, step 2 filters total ≥ 0; one real run). I installed a PerformanceObserver on `/api/` resources before editing:
  - Step 1, typing the draft rename region→zone: chips `[id, zone, total]`, grid headers `id float | zone string | total float`, caption `live`. `zone` carries `region`'s saved type (rule 1). Screenshot (dark theme): `/home/matt/Development/helio/.concertino/runs/HEL-1777/evidence/.concertino/scratch/HEL-1777/skf2-rename-chips-light.png`. The filename says "light" by mistake; the capture is the dark theme.
  - Step 2, a descendant of the rename: chips `[id, zone, total]` match the grid headers.
  - Step 2 filter set to `total ≥ 1000` (zero rows): count `0 rows`, caption `live`, chips `[id, region, total]` (the saved schema), grid "No rows to preview." The chip group no longer disappears. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1777/evidence/.concertino/scratch/HEL-1777/skf2-empty-frame-chips.png`.
  - Filter set back to 15: chips `[id, zone, total]` and grid `idfloat | zonestring | totalfloat`, so the draft chips return.
  - The `/api/` request log was `[]` across the whole sequence: the rename typing, the step switch and both filter edits.
  - Light theme (`data-theme=light`): the chips and grid render with the same component styling. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1777/evidence/.concertino/scratch/HEL-1777/skf2-descendant-chips-light.png`.
- **UI / design**: the diff has no CSS or class changes. The chips reuse `step-preview__schema-chip` and `OutputSchemaDisclosure`, and both themes look consistent with the sibling preview header. Nothing off-pattern.
- **Cleanup**: the throwaway user `f9ff06ab-7095-46ac-9bbc-09cdecfe15a1` was deleted by exact id with SQL from `buildUserDeleteSql`, run through psql on `helio_hel1777`. Counts afterwards: user 0, source 0, pipeline 0. Servers stopped with `stop-servers.sh` (`STOPPED ports=7209,10116`). The two throwaway git worktrees were removed.
- **Evidence ordering**: no claim here depends on mtimes; every claim rests on test output, code lines or captured DOM values.

### Verdict: CONFIRM

All three ACs trace to code and fresh evidence:
- AC1: the rename test is red on base and green on HEAD.
- AC2: one `draftFields` list feeds both the grid columns and the chips, and it matched live in names, order and types.
- AC3: the jest test asserts `fetchStepPreview` was not called, the live `/api` log was empty, and the hel1631 and hel1632 guards are green at HEAD.

Round 1's change requests are resolved: the empty frame now falls back to the saved chips, and the spec has an "An empty draft frame" scenario.

### Non-blocking notes
- **Empty frame below a draft rename shows the saved name.** During a draft rename, a downstream step with zero rows shows the saved names (`region`), not `zone`. The grid shows no columns, so the chips and grid do not visibly disagree, and this matches the written D1a and spec scenario. A future refinement could take the parent's draft order for column-preserving steps (filter, sort, limit). Out of scope here.
- **D4 wording.** D4 says "the only request this component can send" is `fetchStepPreview`. That is accurate for this component; the round-1 `httpClient` wording mismatch is gone.
- **Untracked files in the change dir.** The prior round's reports and `.openspec.yaml` are still untracked. Commit them before archive and PR.
