# HEL-322 — PanelDetailModal appearance save clobbers "transparent" defaults into hex

URL: https://linear.app/helioapp/issue/HEL-322
Priority: Medium
Project: Helio v1.5 — Panel System v2

## Context

Pre-existing latent bug surfaced (and ruled orthogonal) during HEL-317 review. The
shared `PanelDetailModal` appearance-save flow clobbers a `"transparent"` appearance
default into a concrete hex color on save — i.e. a panel whose background/color is the
sentinel `"transparent"` gets persisted as an opaque hex value once the appearance form
is saved, even if the user never touched that field.

This is the same class as the **appearance-PATCH-is-replace** gotcha seen in the
helio-news work: the appearance PATCH sends a full replacement payload, and the form's
default-resolution turns `"transparent"` into a resolved hex before the payload is built,
so the sentinel is lost.

## Repro (to confirm)

1. Create/open a panel whose appearance uses the `"transparent"` default (e.g. background).
2. Open `PanelDetailModal`, change some unrelated field, save.
3. Inspect the persisted appearance — expected `"transparent"`, actual a hex color.

## Task

- Confirm the repro and root-cause where `"transparent"` is resolved to hex in the
  save/serialization path (form default resolution vs. PATCH payload construction).
- Preserve the `"transparent"` sentinel through save so untouched transparent defaults are
  not silently converted.
- Consider whether the appearance PATCH should be partial/merge rather than full-replace
  (relates to the known appearance-PATCH-is-replace behavior) — scope to the minimal
  correct fix, note the broader question if larger.

## Acceptance criteria

1. Saving `PanelDetailModal` on a panel with a `"transparent"` appearance default leaves it
   `"transparent"` (not hex), when that field wasn't edited.
2. Explicitly chosen colors still persist correctly.
3. Regression test guarding the sentinel round-trip.

## Notes

Investigated during HEL-317 and confirmed independent of the Timeline change. Priority
Medium — latent data-clobbering correctness bug, but not an active-crash blocker.
