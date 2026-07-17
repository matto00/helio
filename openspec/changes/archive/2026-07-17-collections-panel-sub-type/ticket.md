# HEL-247 — Collections panel sub-type (homogeneous)

**Status:** In Progress · **Priority:** Medium · **Project:** Helio v1.5 — Panel System v2 · **Parent:** HEL-239

## Description

Introduce **Collections** as a panel sub-type. A Collection contains N homogeneous panels (e.g. N metrics, N images, N markdown blocks) bound to a multi-row DataType: one panel per row.

## Scope

- **Homogeneous only** — collection of metrics, OR collection of images, OR collection of markdown. Not mixed.
- Collection panel has its own config: which base type, field mapping shared across instances, layout (grid / list).
- One row of the bound DataType produces one rendered panel.
- Ship initially with at least one base type (likely Metric — most product-aligned).

## Why

A Collections-of-Metrics is the natural shape for "show me one metric per region" or "show me one tile per active deployment." Today users would have to manually create N panels and bind each one. Collections collapse that into a single panel that scales with the data.

## Out of scope

- Heterogeneous collections (mixed types) — explicitly not in this ticket
- Drag-to-reorder within a collection
- Per-item override of the shared config
- Per-item config overrides

## Definition of done

- Collection panel type appears in panel-creation modal
- At least Metric-collection ships and renders correctly from a multi-row DataType
- Adding more base types later does not require schema changes

## Binding constraints from the user (this run)

- HOMOGENEOUS only (N panels of ONE base type); one row of the bound multi-row DataType = one rendered item.
- Collection config = base type + shared field mapping + layout (grid/list). Ship with Metric as the first base type. Adding more base types later must require NO schema changes — design the config shape for that now.
- The Collections config editor should build on the HEL-243 Metric pattern (`BoundOrLiteralField` family in `frontend/src/features/panels/ui/editors/`).

## Established precedents (verify against code before planning)

- Panel config storage extensions: HEL-253 (V53), HEL-255 (V55, PR #231), HEL-248 (V56 `chart_options` JSONB, PR #232 — merged to main, included in this worktree base). Full chain: TS type + panel.schema.json + domain Scala + RequestValidation + PanelRowMapper (BOTH directions — duplication must not drop config; two sibling bugs were caught in this file in HEL-245/248) + configColumnsOf write path + Flyway migration; absent/NULL = sensible default.
- spray-json omits Option=None on the wire — normalize at the service boundary, test with fields ABSENT.
- KNOWN BUG HEL-305: `buildCreatePanelBody` in panelPayloads.ts drops `typeConfig.chartType` — do NOT copy that pattern for collection creation config; carry creation-time fields explicitly and test the payload.

## Additional emphasis (binding for this phase, in-scope files only)

1. Elevated style/UX bar: strictly honor DESIGN.md (tokens, spacing/type scales, canonical breakpoints 1440/1100/768/430, shared components).
2. MOBILE IS A FIRST-CLASS VERIFICATION TARGET: mobile shell activates below 768px (read-only MobilePanelStack). Evaluator AND skeptic must resize to ~390×844 and verify:
   (a) a Metric collection renders legibly in the MobilePanelStack — decide deliberately how a collection sizes there (per-kind heights live in `frontend/src/features/panels/ui/mobilePanelHeights.ts`; a new panel kind MUST get an entry, don't fall through to a default silently);
   (b) new config controls meet ≥44px touch targets at mobile width — extend the HEL-245/255/248 `@media (max-width: 768px)` pattern in PanelDetailModal.css and its CSS-lock test;
   (c) no horizontal overflow at 390px, including grid-layout collections.
3. KNOWN BUG HEL-304 (spinoff filed — do NOT fix here): appearance edits at <768px are silently dropped (usePanelGridSave only mounts in DesktopPanelGrid). Do mobile verification as READ verification; make config edits at desktop width.
4. Clean up trivial style debt in files you're already editing.

## Operational hygiene (binding for all sub-agents)

- Playwright screenshots go to the session scratchpad or gitignored tmp — NEVER the repo root.
- NEVER bulk-delete by glob; delete only files you created, by exact name.
- Other ticket cleanup may briefly run in parallel — stay inside your own worktree and ports.
- If pre-commit fails ONLY on check:openspec-hygiene (change complete but not archived), a `-n` bypass with all real gates verified out-of-band is the accepted pattern — call it out; archive happens during delivery.
