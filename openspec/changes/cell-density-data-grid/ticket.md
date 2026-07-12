# HEL-252 — Cell density — condensed / normal / spacious

Epic: HEL-240 (Data Grid Standardization), part of v1.5 Panel System v2.
Project: Helio v1.5 — Panel System v2 (parentId: HEL-240)

## Sequencing context (from human operator, not in Linear ticket body)

This is the SECOND ticket of the Phase 2 grid chain, delivered serially:
HEL-254 (scroll, merged) -> HEL-252 (density, this ticket) -> HEL-253 (draggable widths, next).

Build on the canonical DataGrid primitive at `frontend/src/shared/ui/DataGrid.tsx`
(+ `DataGrid.css`), established by HEL-251 and refined by HEL-254 (scroll). Density
should be a first-class prop/variant on the shared DataGrid so every consumer
(TypeDetailPanel, SourceDetailPanel, PipelinePreviewModal, StepCard preview, SqlTab,
TableRenderer table-panel body) can adopt it consistently. HEL-251's design already
sketches a `density` concept alongside rows/columns/variant/emptyText — check whether
it's already wired (even partially) and extend it properly rather than re-designing
from scratch.

HEL-253 (draggable widths) and HEL-255 (Table config rework) build on this same
primitive next; HEL-255 will surface density in the Table panel config. Keep the
density API clean and documented so those follow-on tickets aren't blocked or forced
to rework this ticket's surface.

Bind to DESIGN.md for all frontend work (spacing/type scales, tokens, shared
components, UI state patterns).

## Description (from Linear)

Add cell density to the DataGrid primitive. Configurable per Table panel; sensible
defaults for preview variants.

## Behavior

- `density` prop on `<DataGrid>` accepts `"condensed" | "normal" | "spacious"`.
- Defaults: preview variant -> `condensed`; full variant -> `normal`.
- Density affects row padding and font size (line-height adjusts proportionally).
- Table panel config surfaces this as a dropdown.

## Definition of done

- Three density modes render correctly across all migrated surfaces
- Table panel config exposes density
- Preview variants visually distinct from full variants by default

Depends on the unified DataGrid primitive (sibling) — already landed (HEL-251) and
refined by HEL-254 (scroll), both merged to main prior to this ticket.

## Priority

Medium (3)

## Linear URL

https://linear.app/helioapp/issue/HEL-252/cell-density-condensed-normal-spacious
