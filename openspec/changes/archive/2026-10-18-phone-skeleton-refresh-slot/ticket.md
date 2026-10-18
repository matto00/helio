# HEL-1646: Phone dashboard skeleton: reserve the refreshed-line slot for pipeline-fed dashboards so placeholders don't sit 27px higher than real cards

## Description

origin_kind: followup
origin_ticket: HEL-1583 (owner ruling `followup`, 2026-10-17). Parent epic: HEL-1570.

HEL-1583 reserves the phone dashboard's "refreshed …" line slot (about 19px plus an 8px margin) from first paint
**once the panels are known** to include pipeline-fed panels (`feedingOutputIds`). Real cards never move, and
markdown-only dashboards get no slot and no jump.

**Remaining:** while a pipeline-fed phone dashboard is still loading, the **skeleton** can't know it's pipeline-fed,
so its placeholder cards paint 27px higher than the real cards that replace them. The swap already changes content,
so the owner accepted it for HEL-1583, but it's still a visible jump.

**Fix:** give the skeleton the signal before panels load. For example, a "has pipeline-fed panels" flag (or a
feeding-output count) on the dashboard list or summary payload the shell already has, so the skeleton reserves the
same slot. Keep markdown-only dashboards slot-free.

## Acceptance Criteria

- On a pipeline-fed phone dashboard, a frame-sampling e2e (like HEL-1583's no-shift spec,
  `e2e/hel1583-refresh-line-no-shift.spec.ts`) shows placeholder and real-card tops identical across the swap, with a
  slowed panels fetch, both themes (light and dark).
- Markdown-only dashboards are unchanged (no slot, no jump).
- Any new field gets its schema and contract in the same change.

## Driver constraints (overnight run, 2026-10-18)

- DESIGN.md is binding. Measure the skeleton-to-real-card offset at 375px and 430px with a layout-shift probe; compare
  against the running app in light and dark; desktop unchanged. Screenshots persisted in
  `/home/matt/Development/helio/.concertino/scratch/HEL-1646/`.
- Do not touch the HEL-1668 (phone pipeline page) or HEL-1665 (Home on phones) lanes' files.
