## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `e2eac98e0b9242128793f3b8435fc6f8f57fc6b3`. This is a delta review: it covers the fix commit on top of `9698d6aae`, which was evaluated in evaluation-1.md.

### Phase 1: Spec Review — PASS

- **CR3 (C6) is resolved.** `files-modified.md` now lists every path the branch adds:
  - `.openspec.yaml`, design, proposal, both skeptic reports, both spec files, ticket and evaluation-1;
  - the new touch to `usePipelineClearRunOnLeave.ts`.
- **CR4 is resolved.** In `design.md`:
  - D5 now says `getOutputRows(outputId, 0, 500)` (`Page.MaxLimit`). It also states the cache scope: cleared when a run settles and when leaving the page, never on a layout or tab unmount.
  - D7 now describes the measured `data-live-layout` attribute and `THREE_COLUMN_MIN_WIDTH = 960`, plus the spine `clamp(220px, 28cqi, 340px)`.
- **Constraints still hold.**
  - C1: frontend only.
  - C2: hel1631 is unchanged and green.
  - C3: the e2e still asserts one history read at load and zero requests per edit.
  - C7: the gated burst with a chart Output on screen is green.

### Phase 2: Code Review — PASS

Gates, run fresh by me in WORKTREE_PATH:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| Targeted jest (`HELIO_JEST_MAX_WORKERS=2`, nice 19): liveOutput, outputRenderInputs, ClearRunOnLeave, usePipelineDetailPage, usePanelData, usePublicPanelData, PipelineDetailPage, TokenGuard, PipelineMobile | 34 suites, 484 tests, all passed |
| e2e (under the flock, `--trace retain-on-failure`): `hel1631-draft-mode` + `hel1632-live-output` | 27/27 passed; teardown deleted its 27 throwaway users |

Checks against the cycle-1 findings:
- **CR1 is resolved.**
  - `LiveOutputColumn.css` now has `font-weight: var(--weight-semibold)` at both former sites.
  - A grep for `font-weight: [0-9]` across `frontend/src/**/*.css` finds 0 hits.
- **CR2 is resolved.**
  - The "Output" eyebrow (`LiveOutputColumn.tsx:130`), the disclosure toggle (`:118`) and both tile labels (`LiveOutputBody.tsx:77,84`) now carry the shared `eyebrow` class.
  - The hand-rolled family, size, tracking and transform rules are removed. Only the colour stays local (`LiveOutputColumn.css:17-21`).
- **Landmark suggestion: done.** `PipelineSpineLayout.tsx:295` is now a plain `div`, so only one "Live Output" region is exposed.
- **Saved-rows cache scope: done.** The per-consumer unmount clear in `useSavedOutputRows.ts` is gone. `usePipelineClearRunOnLeave.ts:32` now clears the cache on pipeline id change and on page unmount, and that hook is called from `usePipelineDetailPage.ts:234`. The cache therefore survives a phone tab switch and a layout switch. `LiveOutputColumn.test.tsx` now resets the module cache in `beforeEach`, so tests no longer leak into each other.
- **LiveTable: done.** The comment now matches the behaviour: a configured column order wins and every column shows. The `!` non-null assertion is gone; the code uses a local `configured` instead.
- **Mono tile values: done.** `.live-output__tile-value` is now `--font-mono`.
- **Import order: done.** The relative import moved into the local group in `usePanelData.ts` and `usePublicPanelData.ts`.

### Phase 3: UI Review — PASS

I checked the running app through the fresh e2e screenshots, persisted:
- `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/c2-live-1280-light.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/c2-live-900-dark.png`

What they show:
- At 1280, the "OUTPUT" eyebrow now matches "SOURCE / STEPS / OUTPUTS" in size and tracking. The tile label uses the eyebrow recipe and the value is mono.
- At 900, the collapsed disclosure eyebrow matches the same recipe.
- The layout is unchanged from cycle 1: the column is about 340px and the document does not scroll.

The cycle-1 phone, motion and dark checks still apply, because the CSS changes are confined to type recipes. Servers were stopped with `stop-servers.sh`. I created no new test data this cycle.

### Overall: PASS

### Non-blocking Suggestions
- None new. The one cycle-1 item I left to the skeptic still stands: with the disclosure open at 900px, the step editor is squeezed.
