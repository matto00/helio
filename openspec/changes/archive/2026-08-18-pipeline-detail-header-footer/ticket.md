# HEL-719: Redesign the pipeline detail page chrome into one header + one footer

## Description

From the beta UI/UX polish sweep (PR #382).

**Scope**
`PipelineDetailPage` has accumulated three separate top-of-page info bars (`BoundSourceBar`, `BoundTypeBar`, schedule bar) plus a dense footer (`PipelineDetailFooter`: output name editor, schema chips, step count, run history, preview, dry run, run, share) — the page reads as a stack of retrofitted strips rather than one designed surface. Consolidate into a single coherent header (source/type/schedule as one row or a compact summary) and a single footer, following DESIGN.md's page-header conventions once established (see the App.tsx route-registry / PageShell tickets).

## Acceptance Criteria

* One header region, one footer region; no more than one info bar above the step list.
* All existing actions (edit source/type, schedule, run history, preview, dry run, run, share) remain reachable with no loss of function.
* Works cleanly at 430px (see HEL-687, fixed this sweep, for the footer's mobile floor).
* **Header is drastically more compact**: the source/type/schedule display itself is reduced in
  size/density (not just the buttons), and the three separate always-visible "Edit source" /
  "Edit type" / "Edit schedule" buttons are replaced by a single action button that opens a menu
  exposing those three options.
* **Footer keeps only "Dry run" and "Run pipeline" always visible**, at every viewport including
  430px; the remaining actions (Run history, Preview, Share, etc.) collapse behind a popover/
  overflow action bar to conserve horizontal room, especially on mobile.

## References

* HEL-687 — pipeline editor sticky footer overlaps content at narrow (430px) — fixed this sweep, informs the footer's mobile floor.
* Originates from the beta UI/UX polish sweep, PR #382.

## Scope Amendment (post-final-gate, human-directed)

During the final verification gate, the skeptic found a real, reproducible defect: with a
schedule enabled and a computed next run, the header's next-run date ellipsis-truncates to
"next r…" at 1440px (DESIGN.md's widest canonical breakpoint), hiding the date entirely — the
third instance of the same width-crowding failure category in this ticket's own review history
(two prior siblings in the same field group were already fixed). After the final-gate REFUTE
budget was exhausted, this was escalated to the human, who directed a scope amendment overriding
design.md's original "no visual redesign beyond consolidation" non-goal, adding the two bullets
above: consolidate the header's per-field edit buttons into one action-menu button and compact
the field-group display itself, and consolidate the footer's non-primary actions behind an
overflow popover while pinning Dry run/Run pipeline. This both resolves the root cause of the
truncation defect (frees the horizontal budget the crowded 3-button header/6-button footer had
been consuming) and delivers a materially denser chrome, per the human's explicit direction.
