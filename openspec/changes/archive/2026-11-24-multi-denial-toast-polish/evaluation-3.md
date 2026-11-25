## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD: 046206108690932972cd87f21d6464e055203bee. Base: 8abb826b745e81afc13419ea26772c71faf0652a (origin/main), resolved live.

This cycle covers commits 52a03d141 and ffbb8378e, plus the merge of origin/main at 046206108. The merge changed none of this lane's files (`git diff ffbb8378e..HEAD` is empty on `toast.css`, `ToastRowList.tsx`, `Toast.tsx`, `deniedPipelinesToast.ts`, the spec file, `multiDenialSeed.ts` and `elevationTokenGuard.css.test.ts`). The cycle was paused once; this report builds on `/home/matt/Development/helio/.concertino/scratch/HEL-1840/evaluation-3-partial.md`, and every gate was re-run on the new HEAD.

### Phase 1: Spec Review — PASS
- **Skeptic-final-2 CR1 (the cue depended on where the clip lands): addressed.**
  - The fade now carries `box-shadow: inset 0 -12px 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent)`, which is byte-identical to the sibling cue at `PanelDetailModal.css:54` (HEL-1449). That reuse is the cohesion reference named in design D3.
  - `max-height` is back to `min(40vh, 16rem)`, so the design's non-goal of not changing desktop layout holds.
  - The exception is pinned in `elevationTokenGuard.css.test.ts`, which is the existing mechanism for this.
- **Skeptic-final-2 CR2 (the evaluator had not covered the latest commits): this report covers them.**
- The earlier acceptance criteria are unchanged and re-verified live below: name order, first-row alignment, and the cue showing on overflow and not when the list fits.
- `CONSTRAINTS` in `workflow-state.md` is empty. The standing constraints C1–C14 were honored, including the new C11 line.

### Phase 2: Code Review — FAIL

**Gates (my own fresh runs on 046206108, in WORKTREE_PATH):**
- `npm run lint`, `npm run typecheck`, `npm run format:check` and `check:e2e-types`: all exit 0.
- jest (3 workers) on the toast and denial files plus `elevationTokenGuard`: 14 suites, 176 tests passed.
- Full `e2e/hel1172-multi-denial-toast.spec.ts`: 16 of 16 passed, in two invocations. Servers were restarted fresh with `DATABASE_URL` set to the lane DB, `DB_USER`, and an empty `ANTHROPIC_API_KEY`, all exported in the same command. Flyway is at V148 on `helio_hel1840`.
  - The first invocation (`--workers=2 --global-timeout=570000`) passed 14 tests and then hit my own 570 s global cap. Two tests did not run, and the teardown timed out.
  - I deleted the 18 recorded users that teardown left in the registry, by exact id, with `deleteRegistryRun` on that run's directory only. A follow-up count returned 0.
  - I then ran the two remaining tests (`1440x900 … dark` and `1280px: a list that fits`) with `-g`. Both passed, and teardown deleted 2 users.

**Issue 1 (blocking, mechanical): the spec now runs about 10 minutes serially in one CI shard leg, and that leg has a 25-minute timeout.**
- **The spec is one serial unit.** `playwright.config.ts:191` sets `fullyParallel: false`, so the whole file runs in one worker ("Running 16 tests using 1 worker").
- **Its runtime grew about 16x.** On base b2da43a3d it had 5 tests, about 35 s. On HEAD it has 16 tests, and their recorded durations sum to 575.5 s.
- **Most of that time is rate-limit sleeping.** Seven tests seed six pipelines each, at about 150 API calls per seed against the 120-per-60 s `/api` limit. Each of those seven therefore sleeps on `Retry-After` and takes 1.1 min.
- **The shard planner does not know about this.** `e2e/shard-weights.tsv` has no row for `hel1172-multi-denial-toast.spec.ts`. `node scripts/e2e-shard.mjs plan` lists it as `61s (defaulted)` on leg 7, whose planned weight is already 1558 s.
- **That pushes leg 7 toward its timeout.** `ci.yml:619-626` records slowest legs of 1312–1519 s against `timeout-minutes: 25` (1500 s). With about 500–800 s of unplanned extra time on one worker, leg 7 is likely to time out, especially on the older CI hosts the HEL-1793 comment describes as about 1.4x slower.
- **The fix is cheap.** `POST /api/pipelines` takes the whole pipeline in one call (`schemas/pipelines/create-pipeline-request.schema.json` has `name`, `roots`, `steps`, `outputs`), so the seed can send roughly 9 requests instead of about 150. See CR1.

### Phase 3: UI Review — PASS (the overflow cue is now visible wherever the clip lands)

**Live run.** Lane servers on port 7272, my own throwaway user (deleted afterwards by exact id), six pipelines `HEL-1172 A..F`, all on real runs.

**Mutation method.** For each state I took an element screenshot of the toast, injected `box-shadow: none !important` on the fade (a runtime override only, no code change), took a second screenshot, and diffed the two pixel by pixel with `/home/matt/Development/helio/.concertino/scratch/HEL-1840/eval3_band.py`. The output is in `eval3-band-measure.txt` in the same directory. The diff isolates exactly what the shadow paints, so it measures visibility rather than only the declared style.

| State | Clip position (measured) | Pixels the shadow paints | Edge pixel: shipped vs no-shadow |
| --- | --- | --- | --- |
| 1366x640 light, 6 rows (the skeptic's failing geometry) | 2.4 px of row 4 visible | 24 px band at the list's bottom edge, x 47–294, max channel delta 38 | (219,218,218) vs (255,255,255), 1.40:1 |
| 1366x640 dark, 6 rows | 2.4 px peek | same band, delta 33 | (70,67,63) vs (38,35,32), 1.59:1 |
| 1440x900 light, after running 2 rows, scrolled so the clip falls in the gap | clip in the inter-row gap (`clipInGap: true`, 0 px of the next row) | same band, delta 38 | 1.40:1 |
| 1440x900 dark, same state | clip in gap | same band, delta 33 | 1.59:1 |
| 390x844 light, clip scrolled into the 28 px row gap | clip in gap | 24 px band, x 47–278, delta 38 | 1.40:1 |
| 390x844 dark, same | clip in gap | same, delta 33 | 1.59:1 |

**What the table shows:**
- The band is identical in every state, which is the point: it does not depend on the row geometry under the clip.
- With the shadow removed, no pixel in the band differs from the card surface. That is exactly skeptic-final-2's defect, reproduced and then cleared.
- At the end of the list the attribute drops and the `::after` computes `content: none` and `box-shadow: none` (checked at 1440 dark).
- In the 1440x900 state after two runs, at scroll 0, the list now cuts 44 px into row 4: with the 16rem height the skeptic's 0 px case no longer occurs at rest. I reproduced the in-gap clip by scrolling.

**Screenshots** (durable, outside the worktree), all under `/home/matt/Development/helio/.concertino/runs/HEL-1840/evidence/`:
- shipped: `eval3-1366x640-{light,dark}-6rows.png`, `eval3-1440x900-light-2run.png`, `eval3-1440x900-{light,dark}-2run-clipInGap.png`, `eval3-390-{light,dark}-clipInGap.png`
- the no-shadow counterparts: the same names with the suffix `-MUT-noshadow`

**Unchanged behaviour, re-checked live:**
- **Focus stays clear of the fade.** At 390 light and dark, 0 of 12 focus stops were under the fade. The scroll-padding CSS is unchanged since cycle 2's desktop check.
- **First-row alignment holds.** The icon top minus the first link top is 1 px at 390 light and dark and at 1366x640 light, the same as the single-message toast.
- **Nothing paints over the border.** At 390 light and dark, with the list scrolled to 0, 0.5 and 1, no row paints above the toast's top border inner edge.
- **No console errors or warnings** in the flow.

### Overall: FAIL

### Change Requests
1. **Remove the rate-limit sleeps from the multi-denial seed** so the spec no longer adds 500–800 s of unplanned time to one CI e2e leg.
   - **File:** `e2e/support/multiDenialSeed.ts`.
   - **Change:** create each pipeline with one `send(request, "post", "/api/pipelines", { name, roots: [{ sourceId }], steps: [21 x { type: "assert", config: { rules: [] } }], outputs: [{ kind: "table", name: `${name} Table`, config: {} }] }, headers)` instead of a pipeline POST, then 21 step POSTs, then an output POST.
     - Check the exact transactional step and output shapes against `schemas/pipelines/create-pipeline-transactional-step-request.schema.json` and `create-pipeline-transactional-output-request.schema.json`.
     - Keep the 429-retrying `send()` as a backstop.
   - **Prove the denial still fires:** each single-call pipeline must still be denied with `steps-above-bound`. The existing tests assert this through the toast and its "too many steps" description.
   - **Acceptance:**
     - A full single-worker run of the spec drops well below its current 575 s of test time. Target: none of the six-pipeline tests takes about 1.1 min any more, and the file finishes in under about 3 minutes locally.
     - Record before and after durations in `evidence/`.
     - Every existing assertion stays: the 16 tests, the edge-cue states, focus clear of the fade, border, alignment, and `idsOppositeToNames`.

### Non-blocking Suggestions
- **The e2e edge-cue assertion is weak.** `expect(cue.boxShadow).not.toContain(cue.surface)` compares serialisations: the shadow serialises as `color(srgb …)` and the surface as `rgb(…)`, so it can never match. The `inset` and `not none` checks are what carry that test. My pixel diff above is the visibility proof.
- **For the skeptic:** the shadow band spans the list frame (x 47–294 of a 340 px card), so it stops about 45 px short of the card's right edge, under the close-button column. The HEL-1449 sibling spans its own scroll container the same way. I'm not grading whether it should span the full card.
- **Weights table:** if this spec stays heavy after CR1, regenerate its row in `e2e/shard-weights.tsv` from CI artifacts per `scripts/e2e-shard.mjs` (never from a local run).

### Critical Path (final cycle; `EXECUTION_CYCLES` = 3)
- **The single remaining blocker is CR1.** Its fix is test infrastructure only, roughly a 20-line change confined to `multiDenialSeed.ts`.
- **Everything the ticket asks for is implemented and verified live:**
  - name-then-id order;
  - first-row alignment at 390 px in both themes;
  - an overflow cue that is now clip-independent and pixel-proven in both themes at 390x844, 1366x640 and 1440x900;
  - a focused control kept clear of the fade.
- **Recommendation for the human:** take one more short executor pass for CR1, then go straight to the final gate. If the owner would rather merge now, the risk is a leg-7 `e2e` timeout on CI rather than a product defect. If that happens, the spec runtime above is the diagnosis; it is not a flake to rerun.
