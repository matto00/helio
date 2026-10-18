## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD 6477341111d4b4ec6d0368e5a1f46e473325f226; the planning artifacts are untracked under the change dir.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/mobile-pipeline-detail-polish/HEL-1668`.
There was no live probe this round. Round 3 measured the compact-row regression; this round checks the artifacts against the CSS source.

### What I verified (with evidence)

**Round-3 CR1 (D5, the compact block as one unit): resolved.**
- Checked against `frontend/src/features/pipelines/ui/spine/PipelineSpine.css`:
  - `:207` is `.spine-row:hover .spine-row__grip { opacity: 1 }`.
  - `:326-330` is the mixed hover/focus-within/selected menu opacity reveal.
  - `:459-486` is the compact `@container` hover set: the reveal at `:459`, the select fill at `:467`, the menu backing at `:471`, and the selected `:hover` tones at `:479` and `:483`.
- (a) design.md:112-116 makes the WHOLE block `:459-486` one ungated allowlist unit. It gives the measured reason (a tapped compact row would go from accent-mid to grey). Task 5.1 names the same three units.
- (b) `:459-463` is no longer in the SPLIT list. The "Hover fills" bullet (design.md:105-108) now cites only `OutputSchemaDisclosure.css:21-25` as its example.
- (c) `:207` is classified as a grip reveal, ungated, with the reason that dragging needs a pointer. `:326-330` is classified as a reveal and left exactly as it is, not split.
- (d) The 1024×800 `hasTouch`+`isMobile` e2e now asserts the select background and the menu-backing background against origin/main's values, in light and dark (design.md:119-121, task 7.5). The spec scenario "Compact spine menu on a touch tablet" says the same.
- I checked whether the remaining gated rules change the tapped compact row once the block stays whole.
  - `:194` (`.spine-row--selected, .spine-row--selected:hover`) is split. The ungated `.spine-row--selected` still gives the row accent-dim.
  - `:344` (transparent) and `:356` (accent-dim) are gated together. The net row background stays accent-dim.
  - `:352` (accent-mid) is gated, but the compact `:479` (same specificity, same value) is kept.
  - So the selected compact row's computed tones are unchanged whether the gated rules stay in place or are consolidated. The e2e would catch any slip.

**Round-3 CR2 (D2, task 7.5 wording and the pinned threshold): resolved.**
- Task 7.5 now reads "region-before-message ordering proven by DOM check + rAF frame counter, gap >= 2, single-rAF mutation fails". The AX snapshot is gone from the ordering proof.
- design.md:57-58 pins the threshold: the counter at message insertion minus the counter at region connection must be >= 2.
- I traced the threshold by hand.
  - Setup: the region connects in a task at counter c. The loop's rAF was registered first, so in each frame it runs before the viewport's rAFs.
  - Double rAF: the first callback runs in frame c+1, after the loop's increment. The second runs in frame c+2, after that frame's increment. The observer sees c+2, a difference of 2, so it passes.
  - Single rAF: it inserts in frame c+1, a difference of 1, so it fails.
  - The pin therefore separates the two implementations as required.
- The AX check is kept only for the separate "exposed to assistive technology" scenario (the toast spec's ADDED requirement), which is what round 3 allowed.

**Round-3 non-blocking notes: both addressed in text.**
- The module-map entry is deleted when its toast is dismissed or evicted (design.md:60-61).
- A toast pushed during the two-frame window is now stated to take the normal path. The deferred insert skips ids already present, so nothing is inserted twice (design.md:58-60).

**New-defect sweep**
- Spec deltas vs design: D1, D3, D4, D5, D6 and D7 are consistent with their spec scenarios. The mobile hover requirement's carve-out ("reveals ... together with the backing and row tones the compact spine shows") matches the one-unit allowlist.
- AC coverage: the 375/768 and light/dark matrix is in 7.5-7.7. Item 4's desktop check is in 7.6 (1280/1000). Item 7 is a mutation-proven guard, and is labelled as one.
- Sibling isolation: tasks.md:7 forbids `App.tsx`, `e2e/hel1579-*` and `apiRequestCounter.ts`. 5.2 forbids editing the hel1582 spec. The HEL-1669 `PipelineMobile.css` overlap is disclosed with a merge-second rule.
- The specs re-run in 7.8 exist (`e2e/hel1582-*`, `e2e/hel1608-spine-count-overlap.spec.ts`, `e2e/hel1648-*`).

### Verdict: CONFIRM

The design is sound enough to implement. All round-3 change requests are resolved in design.md, specs/ and tasks.md. The planned tests can now see the HEL-1608 tapped-row regression and a single-rAF ordering regression.

### Non-blocking notes
- D2 "pushed during the window" vs the MODIFIED toast requirement. The requirement says a new-location region is "connected and exposed, empty, before any message is inserted". A toast pushed in the roughly 2 frames after a re-target is rendered at once into a region connected less than a frame ago, which is the case the double rAF exists to avoid. design.md justifies it as "they already exist", which is not the same as "exposed". There is a simpler, fully consistent option: render no region messages at the new target until the double-rAF "ready" flag is set, then insert every toast not yet announced. Either do that, or record this as an accepted residual in the PR body. The race is rare and only one toast would be affected.
- If the executor consolidates gated rules into one `@media (hover: hover)` block rather than wrapping in place, keep the source order of `:189`/`:344`/`:356`. Same-specificity row backgrounds depend on it on hover-capable devices. The desktop-hover-unchanged scenario should cover this, but it is worth a deliberate check.
- tasks.md lists 2.5 before 2.4 (cosmetic).
