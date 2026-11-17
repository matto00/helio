## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: bd77ef3a43bc3e67526378f7f23a8a47effa3495 (delta over 4005276d9, evaluated in evaluation-1.md).

### Independent evidence (fresh, this evaluator)

- Gates in the worktree: `npm run lint` 0, `npm run format:check` 0, `npm run typecheck` 0, `npm test` 0 (579/579 root,
  9416/9416 frontend), `npm --prefix frontend run build` 0.
- `scripts/fonts/fallback-metrics.py` re-run here (host Liberation, DejaVu from the noble image). All six fallback
  blocks parse to **exactly** the numbers in `frontend/src/theme/theme.css`, including the tuned Fraunces faces
  (113.9 / 85.86 / 22.39 and 89.7 / 109.03 / 28.43). The output also matches the committed `fallback-metrics-400.out`
  (fetch date aside).
- Fresh CI-like docker browser (playwright v1.55.1-noble + `fonts-dejavu`, Liberation kept). This re-measures the swap
  after the theme.css edit, which the executor did not re-run:
  - full `hel1665-home-phone-stability.spec.ts` + `hel1678-home-large-font.spec.ts`: **56/56 passed**. All 32 shift
    records (8 viewports x 2 themes x 2 orders) have `fontSwapSpread` 0 and `fontsAtFirstFrame: "loading"`.
  - the executor's style-swap driver (`evidence/tools/hel1665-style-swap.spec.ts.txt`, run from a throwaway worktree at
    bd77ef3a4): Serif 540 / 1280 and Mono 540 / 1280 all have `fontSwapSpread` **0**, 4/4 passed. The changed Fraunces
    overrides are the only faces Serif headings exercise, so this is where the edit could have mattered.
- Throwaway worktree and docker container removed; the e2e teardown deleted its own throwaway users (56 + 4).
- The cycle-1 red-first proof still applies: base emulation failed 12/12 at 8 / 22-24 / 24-26px. Cycle 2 did not touch
  the assertion.

### Phase 1: Spec Review — PASS

Cycle-1 change requests:
1. Width contract: the spec delta (requirement and scenario), design.md D6a, tasks.md 2.4b and measurements.md now all
   say "mean within 2%, no single sample beyond 8% at weight 400". They give the measured worst case (7.4%, Fraunces
   Fallback DejaVu at 16px) and call this a revision of the gate-approved per-size 2%. I checked the committed
   boxmatch data: every weight-400 sample on its intended platform font is within 0.926-1.065, so the bound holds.
   The PR body must still name the revision (orchestrator action).
2. Reproducibility: `TUNED_SIZE_ADJUST` in the script records the tune and its reason, and the script prints exactly
   theme.css's numbers (verified). The theme.css header comment is now accurate.
3. The stale traceback `evidence/fallback-metrics.out` is deleted.
4. measurements.md:44 now cites persisted screenshots under `.concertino/runs/HEL-1678/evidence/...`. Both files exist.

The design.md D1 out-of-subset-glyph disclosure (U+2192) and the spec comment on where the assertion goes red were
added too. Ticket AC: still met (0px at every AC width, light and dark, CI-like).

### Phase 2: Code Review — PASS

The code delta is small: the script's tune table plus `weight` threshold, a 0.01% change to the Fraunces ascent and
descent overrides (size-adjust unchanged, so the box-match width ratios recorded earlier are unaffected), a theme.css
comment and an e2e comment. No new issues.

### Phase 3: UI Review — PASS

The only UI-affecting change is the Fraunces ascent/descent overrides moving by 0.01%. The Serif and Mono swap is
re-measured at 0px, and the full Home stability and large-font specs are green in the CI-like browser. The cycle-1
light/dark check of the running app still stands; the visible pixels cannot differ at this magnitude.

### Overall: PASS

### Non-blocking Suggestions

- PR body: state the 605-615px band numbers (head 30px at 606/610, base 22-24px) and the width-contract revision, and
  file the band as a follow-up, as noted in evaluation-1.
- measurements.md cites the persisted screenshots by absolute host path. That is fine for this run, but they will not
  resolve for anyone else; the chunit numbers next to them are the portable evidence.
