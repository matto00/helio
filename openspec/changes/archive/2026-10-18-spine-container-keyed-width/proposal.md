## Why

Between a 769px and about a 950px viewport the desktop pipeline spine's step titles are unreadable ("F…", or nothing on
a lane row), because the spine track `clamp(180px, 22vw, 340px)` follows the viewport instead of the page's own width.
HEL-1579 shipped with this accepted defect (owner answer `proceed-with-followup`); this closes it.

## What Changes

- The spine grid track narrows with the page container (`cqi` of `.pipeline-detail-page--spine`), not the viewport,
  reaching ~240px whenever the page leaves the centre column at least ~320px, and 270–340px at 1280×800.
- Where the spine is still narrow (track below about 260px, i.e. column content box ≤ 226px), spine rows compact: the row count moves onto the summary line, unused
  gaps and padding tighten, and the row ⋮ no longer reserves width (it shows on hover/focus, still keyboard-reachable).
  Desktop-only: keyed to a container that exists only on the desktop spine, so the phone layout is untouched.
- The HEL-1579 769–1100 sweep gains a per-row title readability assertion over trunk and lane rows, shown red on the
  current CSS first.
- Doc fixes: the spine-layout spec's paused-chip wording, the archived HEL-1579 design D2 `clamp(270px…)`, and a stale
  "1100px block" CSS comment.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-detail-spine-layout`: the spine width is keyed to the page width with readable step titles at 769–1100px;
  the narrow-header paused-chip wording matches the shipped behavior.

## Impact

- CSS: `frontend/src/features/pipelines/ui/spine/PipelineSpineLayout.css`, `PipelineSpine.css`,
  `PipelineSpineHeader.css` (comment only). No TSX, API, schema or dependency change.
- Tests: `e2e/hel1579-pipeline-spine-layout.spec.ts` (sweep test only).
- Docs: `openspec/changes/archive/2026-10-15-pipeline-detail-step-spine/design.md` (D2).

## Non-goals

- Any change at or below 768px (HEL-1582 phone layout; HEL-1668 phone polish).
- Accent/hover contrast tokens (HEL-1669); the accent-audit test (HEL-1620).
- Redesigning spine row content or the header beyond what readability at 769–1100px needs.
