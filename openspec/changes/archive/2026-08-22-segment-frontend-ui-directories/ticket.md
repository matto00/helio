# HEL-635: Segment the three oversized frontend UI directories

## Description

`frontend/src` is feature-sliced and in good shape overall — this ticket is narrow. Three `ui/` directories have outgrown a flat listing and need segmenting into subdirectories. This is a **pure structural move**: files change directory, imports are re-pointed, and nothing else changes.

Parent epic: HEL-632 (repo structure cleanup). Independent of the backend tickets — this change touches `frontend/` only.

### Ticket enumeration is stale (measured on `ecee3af8`)

The ticket text was written 2026-07-27 and its file counts have aged badly. Re-measured against the current tree:

| Directory | Ticket claims | Actual now | Delta |
| --- | --- | --- | --- |
| `features/pipelines/ui/` | 71 | **101** | +30 |
| `features/panels/ui/` (flat) | 40 | **76** | +36 |
| `features/sources/ui/` | 24 | **30** | +6 |

Roughly 72 files the ticket never saw. The ticket's *groupings* remain sound; only its *enumeration* aged. Unlisted files are first-class work, not stragglers.

Two specific staleness artifacts:
- The ticket names `PipelineScheduleBar` for `schedule/` — **that file no longer exists**.
- The ticket lists 20 step-op configs; there are now **21** (`AssertConfig` was added later).
- The ticket says 14 `PanelDetailModal.*` files; there are now **20**.

## Acceptance Criteria

> **[PLANNER-ADDED]** marks scope this planning round chose that the Linear ticket does not itself state. The real
> HEL-635 has no numbered acceptance criteria; the list below is planner-authored from the ticket's prose plus
> decisions recorded in design.md D2 and Planner Notes. Rationale for each is in design.md — they are disclosed
> choices, not ticket requirements, and should be judged as such.

1. `features/pipelines/ui/` is segmented into `stepConfigs/`, `computedFields/`, `schedule/`, `shapes/` and
   **`proposalReview/`** [PLANNER-ADDED], with the remaining page-level components at the root. `StepCard` **stays at
   the root**.
2. `features/panels/ui/` gains `detailModal/` and `grid/`. Existing `creationSteps/`, `creators/`, `editors/`,
   `renderers/` are untouched. `grid/` holds 19 files: the 5 the ticket names plus **8 skeleton files**
   (`PanelGridSkeleton.*`, `panelGridSkeletonStubs.*`, `DesktopPanelGridSkeleton.*`, `MobilePanelStackSkeleton.*`)
   [PLANNER-ADDED] and their tests, all of which postdate the ticket.
3. `features/sources/ui/` gains `forms/` holding the per-source-type forms. Pages and shared affordances stay at the root.
4. **Every** file in all three directories is accounted for — placed deliberately, not left behind by omission.
5. Moves and import-path updates only: no component splits, no prop changes, no CSS rewrites, no renames. A co-located `.css` file moves with its component.
6. Path-sensitive references beyond imports are found and updated: `jest.config.cjs` patterns, CSS-content tests (`*.css.test.ts` reading files by path), `vite`/`tsconfig` aliases, and live in-repo docs that cite a moved path.
7. File count per feature is unchanged — only directory paths differ.
8. Content identity is proven per file across the move: every moved file's content is byte-identical apart from import/path specifier lines.
9. `npm run lint` (zero warnings), `npm test`, `npm run build`, and `npm run format:check` are all green.
