# HEL-1704: After HEL-1685: split usePipelineDetailPage.ts (~515 lines) and usePipelineDraftSave.ts (~380); narrow-desktop step preview min-height and guard

## Description

Items deferred from HEL-1685 (PR matto00/helio#1091, merged as 8fff8eed1). The owner chose `defer-followup` for item 13.

1. **Hook splits (item 13):** split `usePipelineDetailPage.ts` (about 515 lines) and `usePipelineDraftSave.ts` (about 380) to the CONTRIBUTING soft size budget. Keep behaviour the same (refactor discipline).
2. **Narrow-desktop disclosure** (from HEL-1685's final skeptic): the Output section is capped at `min(30vh, 200px)`, so on short windows the step preview gives way.
   * At 900x700 with Output open, the preview shows only its header and scrolls.
   * At 900x600 `.step-preview` cuts off its own title.
   * Give `.step-preview` a min-height so it never clips its title, and add a layout guard so it can't shrink further. If neither fits, ask the owner what gives way on windows <=700px tall.
   * Fix the now-wrong comment at `PipelineSpineLayout.css:64` ("never pushes the table below ~8 rows").

## Acceptance Criteria

- AC1. `usePipelineDetailPage.ts` and `usePipelineDraftSave.ts` are split so that every resulting source file is at or near the CONTRIBUTING soft budget (~250 lines), with any file left above it justified in design.md. Re-measured on main a6499da12: 562 and 433 lines (HEL-1684 grew both).
- AC2. The split is behaviour-preserving: the public shape returned by both hooks is unchanged, consumers are unchanged (or touched only for import paths), and the existing jest suite plus the hel1631, hel1684, hel1685 and hel1705 e2e specs pass before and after.
- AC3. Module boundaries leave draft-op application, draft save and page wiring in separate modules, so HEL-1733 (Outputs inside a draft) and HEL-1734 (roots inside a draft) can extend them.
- AC4. On the narrow-desktop disclosure layout at 900x600 and 900x700 (light and dark) with the Output section open, `.step-preview`'s title is never clipped: `.step-preview` has a min-height that keeps its title row visible (header content wrapping below it may clip), and a layout guard (a test that fails first on main) holds it.
- AC5. The comment at `PipelineSpineLayout.css:64` states the real behaviour.
- AC6. Any bug found during the refactor becomes a filed follow-up ticket, not a fix in this PR.
