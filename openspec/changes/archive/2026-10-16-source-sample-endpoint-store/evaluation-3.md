## Evaluation Report — Cycle 3, delivery-time re-check (evaluation-3.md)

Reviewed head: `3998f5e83981144caa30d70646e8667756626f04`. Base was resolved live: `c8e204e06` (main, including HEL-1573).
Commit chain since the cycle-2 PASS on `a9ff8cbf8`:
- `53652befc` squash
- `77a81d170` archive
- `8e4bbf354` merge of origin/main
- `3998f5e83` spine-card hover contrast fix

### Gate defect I own
I passed cycles 1 and 2 without running the full Playwright suite. In particular I did not run `e2e/state-surface-contrast-guard.spec.ts`, which CI later failed on. My Phase 3 contrast check was by eye ("label muted, icon neutral"). It never measured hover states, even though DESIGN.md makes the HEL-866 rendered contrast guard [mechanical]. In this cycle I measured hover contrast directly, and that measurement found the issue below.

### Phase 1: Spec Review — PASS
Issues: none.
- **Squash fidelity.** `git diff a9ff8cbf8 53652befc` changes only three openspec documents: `evaluation-2.md`, `files-modified.md` and `skeptic-final-1.md`. No code, test, schema or fixture content was lost. `git diff --quiet a9ff8cbf8 HEAD -- backend` reports the backend tree byte-identical to what I evaluated in cycle 2.
- **Archive.** Every change-dir file is a 100% rename into `openspec/changes/archive/2026-10-16-source-sample-endpoint-store/`. `files-modified.md` is dropped. The two spec deltas are synced to `openspec/specs/{source-sample-api,pipeline-source-sample-store}/spec.md`.
- **Merge resolution.** I checked both sides of the merge.
  - The branch's own file set and per-file `+/-` lines (`d777803c1..77a81d170` vs `c8e204e06..8e4bbf354`) are identical, apart from the two token-guard tests.
  - Main's file set and per-file changes (`d777803c1..c8e204e06` vs `77a81d170..8e4bbf354`) are also identical, apart from the same two guards.
  - The only hand-resolved lines are the elevation and motion guard counts, now 150 ("149 + 1 HEL-1628 SourceSampleLabel.css"). An independent `find frontend/src -name '*.css' | wc -l` gives 150.
  - Main brought no backend or schema changes.

### Phase 2: Code Review — PASS
Gates, run fresh by me on `3998f5e83`:
- `npm run lint`, `npm run format:check`, `npm run typecheck`: all exit 0.
- `npm test` with 2 workers: exit 0. Root 524 tests, frontend 8,880 tests.
- `npm --prefix frontend run build`: exit 0.
- `sbt testFull`: not re-run. The backend tree is byte-identical to `a9ff8cbf8`, where my cycle-2 run passed 8,939 / 0 failed, and main contributed no backend changes.

Fix `3998f5e83`, `PipelineSpine.css:373-381`:
- It is tokens only and mirrors the card-menu rung already in that file: `--app-surface-soft` in light, `--app-surface-strong` in dark.
- It is scoped `.spine-card .source-sample-label .ui-icon-btn:hover:not(:disabled)`.
- Measured live, it clears the threshold (below).

### Phase 3: UI Review — FAIL
Servers were restarted on the current head with `stop-servers.sh` then `start-servers.sh` (7060/9967); `assert-phase.sh servers` printed PASS.
- `e2e/state-surface-contrast-guard.spec.ts` plus `e2e/hel1628-source-sample-label.spec.ts` (1 worker): 23 passed in 3.9 min.

**Measured hover contrast** of the refresh button against its rendered backdrop. Method: the ancestor background chain composited with `e2e/support/stateContrast.mjs` (`compositeStack`, `contrastRatio`); threshold 1.10. Probe: `/home/matt/Development/helio/.concertino/runs/HEL-1628/evidence/.concertino/scratch/HEL-1628/eval3/hover.spec.ts`.

| Location | Light | Dark |
|---|---|---|
| Spine card refresh, 1440 (the `3998f5e83` fix) | 1.150 PASS | 1.133 PASS |
| Header chip refresh, 768 | **1.000 FAIL** | **1.000 FAIL** |
| Header chip refresh, 390 | **1.000 FAIL** | **1.000 FAIL** |
| Header actions trigger (existing precedent), 768 / 390 | 1.179 | 1.122 |

- In the header layout, used at 1100 and below including tablet with a pointer, the phone-chip refresh button's ghost hover is invisible in both themes. The hover is `--app-surface-soft`, and `.pipeline-detail-header` paints `--app-surface-soft` (`PipelineDetailHeader.css:12`), so the button hovers to its own backdrop colour.
- This is the exact collision `PipelineDetailHeader.css:394-404` already documents and fixes for the header's actions trigger (HEL-866 cycle 4), using `--app-surface-raised`.
- The desktop-width guard does not reach this layout, which is why CI is green.
- Evidence: `.../eval3/hover-light-chip-390.png`, `.../eval3/hover-dark-chip-390.png`, `.../eval3/hover-dark-chip-768.png`; spine comparator `.../eval3/hover-dark-spine.png`.

Everything else from cycles 1 and 2 re-ran green on this head: the four label cases, the phone chip, capture-once/refresh/reload counts, and the failure states.

### Overall: FAIL

### Change Requests
1. Add a header-scoped hover rule in `frontend/src/features/pipelines/ui/PipelineDetailHeader.css`, next to the existing `.pipeline-detail-header__actions .actions-menu__trigger:hover:not(:disabled)` rule (line ~402):
   ```css
   .pipeline-detail-header .source-sample-label .ui-icon-btn:hover:not(:disabled) {
     background: var(--app-surface-raised);
   }
   ```
   - The documented measurement for that rung on this backdrop is 1.179 light and 1.122 dark, with no theme split needed. My live comparator matches exactly.
   - Re-measure the phone-chip refresh hover at 390 or 768 in both themes and record it in the PR body. My probe above can be reused.
   - Preferred: add a regression check that reaches the header layout, since the HEL-866 guard runs only at 1440. Either a small Playwright assertion in `e2e/hel1628-source-sample-label.spec.ts`'s phone test, or a CSS-level jest test that pins the rule.

### Non-blocking Suggestions
- `IconButton size="xs"` on a card label is unchanged from earlier cycles and remains a judgment call for the skeptic.

### Critical Path
This is the final configured cycle (`EXECUTION_CYCLES` = 3).
- **The one remaining issue** is Change Request 1: a single CSS rule using an existing token, plus a re-measurement.
  - Nothing else blocks. The spec, gates, merge, squash and spine fix all verify clean.
- **Recommendation for the human:** let the executor apply CR1 (about 4 lines of CSS) and re-check only the phone/tablet chip hover in both themes, then merge.
  - The defect is low-severity: a hover affordance on a button that is mostly reached by touch at 390.
  - It is still a real [mechanical] DESIGN.md contrast violation at 768 to 1100 with a pointer. Merging without it would ship the exact collision this header already fixed once.
