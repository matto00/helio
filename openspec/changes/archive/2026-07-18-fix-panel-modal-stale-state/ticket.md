# HEL-307 — PanelDetailModal shows stale form state when switching directly between panels

- **Type:** Bug
- **Priority:** Medium
- **URL:** https://linear.app/helioapp/issue/HEL-307/paneldetailmodal-shows-stale-form-state-when-switching-directly
- **Project:** Helio v1.5 — Panel System v2

## Context

Found during HEL-303 review (pre-existing, not introduced there). Jumping directly from one panel's open edit form to another panel shows the previous panel's stale title value in the form. Normal open → close → reopen is unaffected.

## Steps to reproduce

Open panel A's edit form in PanelDetailModal, then switch directly to panel B (rapid switching without closing) — B's form shows A's title value.

## Repro-widening note

Title was the observed field; audit every form field in the modal (binding, subtype config sections, appearance) for the same stale-initialization pattern, and check whether a save in that state writes A's values onto B.

## Acceptance criteria

- [ ] Switching directly between panels always shows the target panel's current values in every form field
- [ ] No save path can write one panel's staged values onto another panel
- [ ] Regression test covering the direct-switch path

## Additional briefing (from the user)

- Iron Laws apply: probe-confirm the root cause (likely a form-state initializer keyed on mount/open rather than on the panel id — verify) before fixing.
- Audit EVERY form field in the modal (binding/dataTypeId, subtype config sections for each panel kind, appearance) for the same stale-initialization pattern.
- Check whether a SAVE in the stale state writes panel A's values onto panel B — that would be data corruption, not just a display glitch; report if so (escalates severity).
- PanelDetailModal is the shared edit surface reworked across HEL-243/244/245/248/255/303; BoundOrLiteralField/useBoundOrLiteralState hooks manage bound-or-literal fields — check how they initialize.
- HEL-309 (PanelDetailModal.css token migration + split) is queued later in this fleet — keep changes minimal and focused on the stale-state bug; avoid churn in PanelDetailModal.css.
- Primarily a state-management fix; if rendering is touched, the 390×844 both-theme + ≥44px mobile standard applies.
- Playwright screenshots go to the session scratchpad or gitignored tmp — never the repo root. Never bulk-delete by glob.
