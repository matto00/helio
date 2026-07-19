# HEL-313 — Chart-type Select popover mispositioned ~283px in creation modal on mobile

URL: https://linear.app/helioapp/issue/HEL-313
Type: bug
Priority: Medium
Project: Helio Mobile — PWA

## Context

Found during HEL-308 review (pre-existing, independent of that diff). At 390×844, the chart-type `Select` popover inside the panel-creation modal renders ~283px below its JS-computed position — a `position: fixed` containing-block issue caused by the popover living inside a `<dialog>`. The visible effect: some chart-type options land off-target and are practically untappable when creating a chart panel on a phone.

This compounds with HEL-305 (which fixed the chart-type selector being a no-op): the selection now matters, but on mobile the popover is mispositioned enough that picking a type is unreliable.

## Root-cause lead

A `position: fixed` element's containing block is the `<dialog>` (which is in the top layer / establishes a containing block via transform or similar), not the viewport — so the JS-computed viewport coordinates are offset by the dialog's position. Verify with a probe before fixing. Check whether other `Select`/popover usages inside `<dialog>` modals share the offset.

## Acceptance criteria

- [ ] Chart-type Select popover aligns to its trigger at 390×844 (options tappable) when creating a chart panel
- [ ] Probe/audit note: every Select-inside-dialog call site checked for the same offset, each fixed or confirmed correct
- [ ] Regression coverage for popover position relative to trigger inside a dialog
