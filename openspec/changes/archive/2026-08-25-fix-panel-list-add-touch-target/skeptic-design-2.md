## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Ground truth read directly: `frontend/src/features/panels/ui/PanelList.css`,
`frontend/src/shared/ui/EmptyState.css:217-230`, `DESIGN.md` §5 (Control metrics,
lines 190-228), and all four planning artifacts. I did not rely on round 1's report
or the orchestrator's summary for any conclusion below.

**CR1 (width floor) — RESOLVED.** `PanelList.css:116-138` confirms
`.panel-list__zoom-button, .panel-list__zoom-reset { height: 22px }` plus a later
`.panel-list__zoom-button { width: 22px; padding: 0 }`. design.md Decision 2 now
states the min-height AND min-width requirement explicitly and names the `width: 22px`
rule; tasks.md 3.2 adds both axes; tasks.md 1.2 / 4.2 measure both `.height` AND
`.width`. Cascade check: `min-width` clamps regardless of a later equal-specificity
`width`, and the media block lands after line 138 either way, so the fix is effective.

**CR2 (`::after` fallback mention) — RESOLVED.** The Risks section now correctly says
the `::after` route is *not* available here and points at Decision 2's reasoning.
Verified against DESIGN.md:207-222: the expander needs a gap of at least
`2 * (44 - controlSize) / 2` = 22px for a 22px control; `.panel-list__zoom-widget`
has `gap: 2px` (PanelList.css:96). The arithmetic in the artifacts is correct, and
Decision 2 correctly notes real box growth is not subject to hit-region tiling.

**CR3 (430px false-failure measurement) — RESOLVED.** `@media (max-width: 430px) {
.panel-list__zoom-widget { display: none } }` at PanelList.css:175-179 confirmed.
tasks.md 1.2 measures at 500px and 4.2 at 500px/768px, with an explicit inline note
that 430px would give a 0x0 false failure. Both chosen widths are inside the visible
band (the widget is visible at exactly 768px; only <=430px hides it).

**CR4 (specs/ contradiction) — RESOLVED.** `specs/panel-list-mobile-touch-targets/spec.md`
exists with three scenarios; proposal.md declares the new capability; Planner Notes now
state archive runs WITHOUT `--skip-specs`. Self-consistent.

**Whole-plan re-check.** `.panel-list__add { height: var(--control-sm) }` at line 48-49
confirmed; `min-height: 44px` in a later media block clamps it, exactly as
`EmptyState.css:219-229` does for `.ui-empty-state__cta`. `.panel-list__count`
(line 34) has no click handler in CSS terms and is a plain badge — a valid
discriminating control, and it is rendered at both 430px and 768px so 1.1/4.3 will
produce real readings. HEL-535's source-order lesson is carried in design.md
Decision 1 and tasks.md 2.1.

### Verdict: REFUTE

One newly-surfaced inconsistency: the CR1 fix was carried into design.md and tasks.md
but NOT into the spec delta, which is the artifact that gets merged into
`openspec/specs/` at Delivery and becomes the durable statement of this capability.

### Change Requests

1. `specs/panel-list-mobile-touch-targets/spec.md` — the requirement statement
   ("SHALL render at least 44px **tall**") and the "Zoom-widget controls meet the
   floor within their visible range" scenario ("**rendered heights** are >= 44px")
   assert only the height axis. This directly contradicts design.md Decision 2 and
   tasks.md 3.2/4.2, which (per round 1's CR1 and DESIGN.md §5's "44px
   min-height/min-width tap-target floor") require BOTH axes for
   `.panel-list__zoom-button`. Update the requirement text and that scenario's THEN
   to assert rendered height AND width >= 44px, so the archived spec cannot certify a
   22x44 target as compliant — which is precisely the half-fix round 1 caught.

### Non-blocking notes

- design.md Decision 1 describes the target as "the file's existing
  `@media (max-width: 768px)` block at the bottom of the file (which already carries
  `.panel-list`/`.panel-list__header` layout rules)". Those are two different blocks:
  the `.panel-list`/`.panel-list__header` block is at PanelList.css:162-171 (mid-file),
  while the block at the bottom (189-193) carries the HEL-774 zoom-widget `bottom`
  override. The block is unambiguous from its described contents and both come after
  the base rule, so the fix is not at risk — but the "at the bottom of the file"
  clause is inaccurate.
- The spec requirement is titled "Panel-list **header** controls" while its second
  scenario covers `.panel-list__zoom-widget` controls, which design.md Decision 2
  explicitly notes are not in `.panel-list__header`. Consider a title that matches the
  proposal's capability description ("panel-list header and its adjacent zoom widget").
- `scripts/concertino/` in this worktree lacks `next-report-number.sh` /
  `persist-evidence.sh` / `emit-event.sh` (the branch base predates them); I ran them
  from the main checkout at `/home/matt/Development/helio/scripts/concertino/`. Not a
  blocker for this gate, but worth knowing before the final gate's script calls.
