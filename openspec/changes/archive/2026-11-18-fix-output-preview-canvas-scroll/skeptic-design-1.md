## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/output-editor-preview-scroll/HEL-1763`. HEAD reviewed: 3b8a34d57b42cc5b64b4a51b3d9f7f43fa74492d.
- Read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-output-sheet/spec.md.
- The design's file citations match the tree:
  - `OutputPreviewPane.tsx:130` renders `<div className="output-preview-pane__chart">` around `ChartRenderer`.
  - `OutputEditorSheet.css:142` `.output-preview-pane__chart { height: 240px; }` is that wrapper's only rule.
  - `PanelContent.css:190-202` holds the `.panel-content--chart` / `.chart-panel__canvas` rules.
- `e2e/hel1752-output-editor-footer-fit.spec.ts` exists and seeds a chart Output (line chart, `fieldMapping` date/duration_s), so Decision 3 can reuse it. `e2e/hel1573-motion-grid-chart.spec.ts` exists.
- Capability `openspec/specs/pipeline-output-sheet` exists. The ADDED requirement name does not collide with any of the 14 existing requirement headings.
- `Modal.css`: `.ui-modal__body` is `overflow-y: auto` inside a flex `.ui-modal__inner`, and a comment says the dialog itself is natively `overflow: auto`. So there are two candidate scroll containers. The plan does not pick one up front; it defers that to the probe (Decision 1), which is the right call.
- AC coverage:
  - AC1 (phone widths in both themes, red before the fix and green after): task 2.1 and spec scenario 1.
  - AC2 (desktop renders and clips): the desktop case in task 2.1 and spec scenario 2.
  - AC3 (the full hel1752 spec passes): task 2.2.
  - Nothing is scoped beyond the ticket. Non-goals explicitly fence off HEL-1752, HEL-1760 and HEL-1762.
- Iron Law (systematic-debugging): the ticket's root cause is treated as a hypothesis. Task 1.1 probes it and records the responsible element and its containing block before any fix. The design also gives a credible reason to doubt the ticket: ECharts' own container is normally `position: relative`. The rejected `overflow: hidden` alternative is reasoned.
- No placeholders, TODO or TBD. No API or schema impact, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes
1. **Vacuous-measurement risk in the e2e (Decision 3).** "Max content bottom computed from the content elements" must exclude the escaping element(s) the probe identifies. If it takes the max over all descendants, the canvas is one of them, and the assertion passes on main. The red-with-fix-reverted requirement in task 2.1 would catch this. Still, the executor should derive the content bottom from the in-flow content (for example the last section or field container), not from every descendant.
2. **Measure the right scroll container.** Both the dialog and `.ui-modal__body` scroll (Modal.css). The ticket's 1490 figure is "the dialog's" scrollHeight. The e2e should assert on whichever element the probe shows actually grows, and ideally on both, so a fix that only moves the overflow from one to the other cannot pass.
3. **The desktop "clipped" check.** "Within the preview card's rect" should compare the canvas's bounding rect against `.output-preview-pane__chart` (or the card) with a small tolerance. Checking that the canvas is visible is not enough.
4. workflow-state lists `TICKET_TYPE: feature`, but this is a bug fix. This is cosmetic and has no impact on the plan.
