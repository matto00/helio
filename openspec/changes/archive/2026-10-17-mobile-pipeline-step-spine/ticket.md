# HEL-1582: Mobile pipeline detail: full-height step spine, Steps/Preview/Runs tabs, floating run pills

## Description

Part of the v0.9 redesign epic HEL-1570. Blocked by HEL-1579 (merged). Related: HEL-1631 (draft UI (e)), HEL-1608.

### Why

On a phone the pipeline page stacks a source bar, outputs/schedule rows, tabs, a large sticky footer (status, name, schema chips, Dry run, Run) and the glass nav. That leaves roughly 300px of an 812px screen for steps. Steps get lost.

### What

* A compact header: back, pipeline name (mono, truncated), one status line (dot · rows · relative time), and overflow.
* Tabs: **Steps / Preview / Runs**.
* **Steps:** Source card → numbered step rows on a vertical line (title plus a one-line mono summary, 60px+ rows) → "+ Add step" → Output card. Tapping a step opens its editor as a full-height sheet (or pushed view) with swipe-down to dismiss.
* **Floating pills** above the glass nav: Dry run (glass) and the primary **Run pipeline**. The sticky footer is removed. Schema chips move into Preview.
* 10–12px edge gutters, and all targets ≥44px (DESIGN.md tap-target rules).
* Reference: "Pipeline detail — mobile" on the epic's canvas (`/home/matt/Development/helio/.concertino/design/HEL-1570/screenshots/PipelineMobile.png`, approved; HANDOFF.md takes precedence over README.md; the ticket's acceptance criteria win over both).

## Acceptance criteria

- [ ] At 375×812 a 3-step pipeline shows source, all 3 steps and the output without scrolling
- [ ] Every step kind is editable from the step sheet on a phone, and the sheet is dismissable by swipe and by a visible close control
- [ ] The Run/Dry run pills never cover the last list item (content has bottom clearance) and clear the glass nav
- [ ] All interactive elements meet the 44px touch floor, verified with the existing tap-target guard utilities

## Driver brief (claims verified at Setup; see evidence/premise-validation.md)

- Builds on HEL-1579 (desktop spine, 31263face), HEL-1628 (source sample label + refresh, 3d9e5a6cb — keep the sample label and its refresh control; their phone hover uses the `--app-surface-raised` rung), HEL-1573 (motion foundation in `frontend/src/shared/motion/`; no literal durations), HEL-1578 (`isDestinationActive`).
- HEL-1583 (PR #1052, open) owns the glass BottomNav and phone shell: never fork the nav; measure pill clearance against it once merged.
- HEL-1584 (in progress) does not build a sheet primitive (its item 8 is pending a split). The step-editor sheet must be a shared primitive in `shared/motion` that HEL-1584/its split can reuse.
- Accent only on the primary action (Run pipeline), selection, active indicators and focus. Mono pipeline name. DESIGN.md v3 binding.
- Verify on the running app at 375, 390 and 768, both themes. The HEL-866 contrast guard only runs at 1440 (HEL-1649): measure phone hover and focus states yourself against the 1.1 state-surface floor and 3:1 / 4.5:1 and record numbers.
- Leave room for HEL-1631's Draft / Save & run on the phone next to the pills, and name the slot.
