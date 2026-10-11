## Standing Constraints

- [C1] No new `eslint-disable`; zero-warnings lint holds. The only suppression allowed is the existing L423 one, moved unchanged (design D2). Reaffirmed by the owner (2026-10-10, D1d ruling).
- [C2] Split commits (D2, D3) are byte-proven moves: hook order, effect order, and deps (post-D1 + stable-only) unchanged; test files import-only.
- [C3] D1 sites must be proven equivalent (reader inventory + T1-T4 green unchanged); a STOP condition is escalated, never adapted.
- [C4] Evidence, scratch, gate transcripts, screenshots: `/home/matt/Development/helio/.concertino/runs/HEL-1478/evidence/` only; throwaway dev users, ids recorded, deleted by exact id.
- [C5] Never print/cat/source `backend/.env`; `git -C` not `cd`; `-J-Xmx3g` on sbt; free memory checked before commits (wait if < 15 GB).

## 1. Baseline and characterization (commit 1, green on base)

- [x] 1.1 Record base line counts + re-run the L423-suppression lint probe on base (7 refs errors) to evidence; verify: transcript saved.
- [x] 1.2 Record the router's `startTransition` use (node_modules file:line) + every `setSteps`/`setSseActive` call site, and write the D1 transition argument per mirrored value; verify: `D1-transition-argument.md` saved.
- [x] 1.3 Write the per-ref reader inventory (D1) for all 7 sites; verify: `D1-reader-inventory.md` with file:line + classification.
- [x] 1.4 Add T1 (identity, C5-C9 handlers), T2 (analyze dispatch cases incl. F-105 seed-at-mount + L370 create-failure), T3 (render count), T4 (HTTP + SSE onTerminal preview refresh), reusing existing tests where they already pin a case; verify: green on base.
- [x] 1.5 Record one named red mutation per T1/T3/T4 and per EACH T2 case (design D4 list, reused tests included), reverted; verify: red transcripts saved; commit the tests alone.
- [x] 1.6 Capture the running app on base (light + dark) per design D4, plus `/analyze` network counts; verify: screenshots + DOM snapshot saved.

## 2. D1 render-time ref fixes (behaviour-adjacent commits)

- [x] 2.1 D1a: move the five mirror-ref writes into in-place `useLayoutEffect`s; verify: T1-T4 green, tests untouched.
- [x] 2.2 D1b: replace the `skipNextAnalyzeRef` render write with seeding state consumed in the debounced effect; verify: T2 F-105 case + T3 green.
- [x] 2.3 D1c: remove the `pendingDraftMetaRef` render read (state mirror co-batched per mutation site, or step marker); verify: T2 draft + L370 cases + T3 green, per-site batching proof recorded, L370 case red with the mirror update omitted (reverted).
- [x] 2.4 D1 lint proof: suppression deleted temporarily, complete ESLint JSON = exactly the one base-equal `'steps.length'` warning, reverted; verify: full JSON saved + diff vs base.
- [x] 2.5 Fix every comment D1 falsifies (design D5 list) in the same commit; verify: grep for "in render"/"during render" about these refs is clean. (host/step-creation/step-mutations comments already fixed in D1a-c; the watchdog docblock is fixed with D2, task 3.2)
- [x] 2.7 D1d (owner ruling rewrite-deep-link): commit deep-link characterization cases (i)-(vi) green on base 744c37720 (scratch worktree per D1d) AND current head; outputSwap test reused unchanged, each with a named red mutation; verify: transcripts.
- [x] 2.8 D1d code: null-initialised stored pair, set only when the id resolves and the pair changed; param clear stays in the effect; cases (i)-(vi) + outputSwap + T1-T4 (T3 counts) green, tests untouched; then redo the D1 lint proof (complete JSON = one base-equal warning); verify: full JSON saved.
- [ ] 2.6 Any STOP condition: halt and return ESCALATION with the site and evidence (the orchestrator files the follow-up); verify: n/a unless triggered.

## 3. D2 move the debounced effect (split commit)

- [x] 3.1 Create `usePipelineDebouncedAnalyze.ts` with the byte-identical effect + `MAX_ANALYZE_DEFER_MS`, called right after the watchdog; verify: lint/typecheck/tests green.
- [x] 3.2 Masking probe on the new file (suppression deleted: complete ESLint JSON = exactly the one base-equal warning), reverted; fix the watchdog L18-21 docblock; verify: transcript saved.

## 4. D3 host remainder (split commits)

- [x] 4.1 Extract C5 `usePipelineRunStream`; verify: gates green.
- [x] 4.2 Extract C6 `usePipelinePageLoad`; verify: gates green.
- [x] 4.3 Extract C7 `usePipelineOutputSheets` (+ C8 `usePipelineSourceScheduleActions`, or merged if <= ~250); verify: gates green.
- [x] 4.4 Extract C9 `usePipelineRunAndSaveActions`; verify: gates green; record final line counts of every touched/new file.

## 5. Fold-ins (own commits)

- [x] 5.1 Fix the stale "the debounce effect below" comment in `usePipelineAnalyzeDeferWatchdog.ts`; verify: comment-only diff.
- [x] 5.2 Retitle the spec.md:66 scenario directly (title line only, design D5); verify: one-line diff + `npm run check:spec-structure` green.

## 6. Split proof (D4)

- [x] 6.1 Byte-move script over every D2/D3 moved region vs the post-D1 commit + red run; verify: IDENTICAL / DIFFERENT transcripts.
- [x] 6.2 `git diff --color-moved=zebra` saved; every non-moved added line listed and justified; verify: file saved.
- [x] 6.3 Hook-sequence script (sub-hooks inlined) equals post-D1 + red run (swap two hooks); verify: transcripts.
- [x] 6.4 Deps check (post-D1 + whitelisted stable names, each traced) + red run (add `steps`); verify: transcripts.
- [x] 6.5 Split commits' `*.test.*` diffs import-only; T1-T4 green at head; verify: transcripts.

## 7. Bookkeeping (orchestrator)

- [x] 7.0 Orchestrator files the items 4-5 follow-up ticket (HEL-1481) (useStepCardState.ts split + usePipelineStepStructure.ts trim) and cites it in the PR body; verify: ticket id recorded.

## 8. Verification

- [x] 8.1 Full frontend gates (lint, typecheck, format:check, jest) + pipelines e2e specs touching the detail page; verify: transcripts saved.
- [x] 8.2 Running app at head (light + dark), same scenario as 1.6, compared to base incl. `/analyze` counts; verify: diff note saved, no differences.
- [x] 8.3 Write `files-modified.md`; delete every throwaway dev-DB id by exact id; verify: ids file + deletion transcript.
