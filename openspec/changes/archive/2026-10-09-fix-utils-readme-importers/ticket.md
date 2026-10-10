# HEL-1401: frontend/src/utils/README.md: stale "chartAppearance.ts imported only by features/panels"; restore why ECharts motion is JS-gated

## Description

origin_kind: followup
origin_ticket: HEL-1179

From HEL-1179 (PR matto00/helio#853, merged 2026-10-08 as 681a16478).

1. `frontend/src/utils/README.md`'s first paragraph says `chartAppearance.ts` is imported only by `features/panels`, but `adminUsage`, `pipelines` and other utils import it too. Correct it from a grep of importers, and paste the grep output as evidence.
2. Restore one sentence explaining why ECharts hover motion must be gated in JS (`prefersReducedMotion`): the CSS motion-token guard only scans `.css` files. The removed `chartAppearance.ts` doc comment said this; put it on the shared `prefersReducedMotion.ts` or its call site in `buildChartOption.ts`.

## Acceptance Criteria

- AC1: Every importer claim in `frontend/src/utils/README.md`'s first paragraph matches a fresh import grep on the branch (chartAppearance.ts, plus the same paragraph's aggregate.ts / chartTypeOptions.ts / formatRelativeTime.ts claims, found stale during premise validation), and the grep output is pasted into the evidence and the PR body.
- AC2: One sentence on `frontend/src/utils/prefersReducedMotion.ts` states that ECharts hover-emphasis motion is JS option config and the CSS motion-token guard (`theme/motionTokenGuard.css.test.ts`) only scans `.css` files, so it must be gated in JS; the `.css`-only claim is backed by a pasted grep of the guard.
- AC3: Doc/comment-only diff: no executable code changes.

## Premise validation

See `.concertino/runs/HEL-1401/evidence/premise-validation.md` (verdict: minor-staleness).
