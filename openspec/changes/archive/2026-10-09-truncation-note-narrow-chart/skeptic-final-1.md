## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 9d7d871213e63a6659ad782386033fc43784863e. Diff base resolved live: `resolve-review-base.sh` -> 586da928abb6b7000d5e17799d3b5fb9b181ebce (exit 0). Three commits: c5589f8f, 75b7fb6e, 9d7d8712.

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/truncation-note-narrow-chart/HEL-1398`.
- Servers: `start-servers.sh` reused healthy servers, `assert-phase.sh servers` -> `PASS servers`. `readlink /proc/<pid>/cwd` for the listeners on 6830 and 9737 both resolve inside this worktree (frontend/, backend/).
- Gates, run fresh by me on HEAD: `npm run lint` exit 0, `npm run format:check` exit 0, `npm run typecheck` exit 0, `npm test` 491 suites / 5162 tests passed, exit 0.
- e2e, run fresh by me (`DEV_PORT=6830 BACKEND_PORT=9737`, `--workers=1`): `e2e/hel1398-chart-narrow-footnotes.spec.ts` 14 passed. My own geometry:
  - 1440, no control bar, light: content 141.4–277, canvas 102.03px, annotation and note one line each (16.8px), footer top 289. Same in dark and at 1900.
  - With a control bar: canvas 33.03px at 1440 and 1900, light and dark (logged `[HEL-1398 control-bar canvas ...] 33.03125px` four times).
- Item 1 (no control bar): met. Short form "200 of 500 rows." shown, long sentence kept as visually-hidden text and as `title` (ChartRenderer.tsx:86-96). The canvas stays at >= 96px. Screenshots:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/containment-1440-std-light.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/containment-1440-std-dark.png`
  - In both, the chart is readable and the light and dark themes match. Red-first is recorded in evaluation-1/2 (pre-fix 5.2px at 1440, emulated through CSSOM removal). I did not re-run the pre-fix code.
- Item 1 (with a control bar): the canvas is a 33px sliver. The y-axis labels "150"/"0" overprint each other and the bars collapse to a line. See:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/containment-1440-ctl-light.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/containment-1900-ctl-dark.png`
  - Geometry: `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/geometry-1440-ctl-light.json`
  - It is better than pre-fix (0px), and it stays contained. But this is the ticket's own symptom: "the chart the note describes is effectively gone".
- Item 2: the "one-line" wording is gone from the `truncationNote` doc. ChartRenderer.tsx:32-34 now describes the two-line clamp.
- Item 3: the guard strips comments and anchors at `^|[};{]`. The in-test fixture shows the old regex returns null (false green) on a rule placed after a comment, and the new one matches it. C1's comma-preceded negative case and the join and inner-span negatives are tested. All of it ran green in my jest run.
- Item 4: "Based on the first 200 of 250 matching rows." under a viewer filter, live, in both themes. The dark screenshot was viewed. A server cross-filter was not exercised live; the ticket asks for "once in each theme", so this is acceptable.
- Phone stack (C2): unchanged. Canvas 100px at 390 and 320, full sentence shown (phone-card-light.png viewed). The query's `max-height` clause cannot match in the inline-size-only stack container. HEL-1438 is not absorbed.
- HEL-1392: the diff touches no `usePanelData`/`useOutputMeta` code, and the full jest suite is green.
- Scope of the chrome tightening: the title clamp and nowrap footer are limited by `.panel-grid-card:has(.chart-panel__annotation, .chart-panel__truncation-note)` (PanelContent.css:447-462). The e2e scope test passes, so a table card and a footnote-less chart keep their wrapping titles.

### Judgment on the control-bar scoping

The ticket AC is "measured chart height >= a stated minimum at w=2 with both footnotes". "A stated minimum" lets the implementer pick the number. It does not let the implementer pick which w=2-with-both-footnotes configurations count. A w=2, h=4 chart with an annotation, a truncation note and a viewer-control bar is inside the AC's literal condition.

The exclusion came from the evaluator's cycle-2 CR1, which asked to scope the spec to "no viewer-control bar". The executor then wrote that into spec.md. The owner never ruled on it, and workflow-state shows `PENDING_ESCALATION: null` with no escalation in the run. Under overnight rules, that is an agent-decided coverage cut.

This is not something a REFUTE can fix. The geometry shows why. With the bar, `.panel-content` spans 210.4–277 (about 67px). The two one-line footnotes take about 34px of that. A 96px canvas would need about 63px more, and tightening alone cannot find it. Reaching the minimum here takes a product choice, such as:
- dropping or merging a footnote under a control bar,
- compacting or inlining the control bar,
- raising the minimum `h` for charts that carry controls, or
- accepting 33px and filing a follow-up.

Choosing among those is outside the skeptic's authority, so I am escalating.

### Verdict: ESCALATION

Question: Does HEL-1398's item 1 AC have to hold for a w=2, h=4 chart that also carries a viewer-control bar (it currently renders a 33px canvas with overprinting y-axis labels), or is scoping the 96px minimum to the no-control-bar case acceptable, with the control-bar case filed as a follow-up?

Options:
- Accept the scoping as shipped, and file a follow-up ticket for the control-bar case.
- Require a fix in this ticket, and name the trade-off: hide or merge the annotation under a control bar, compact or inline the control bar, raise the minimum h for charts with controls, or something else.

Context:
- Everything else in the ticket is verified and ships. Items 2-4 are met, the gates and the 14/14 e2e are green when I re-ran them, the phone stack is unchanged, and HEL-1392 is untouched.
- The no-control-bar case measures a 102px canvas at both 1440 and 1900, in both themes.
- The control-bar exclusion was introduced by an evaluator change request, not by the owner. The AC's literal condition ("w=2 with both footnotes") covers that case.
- With the bar, about 67px of content height remains, so 96px is geometrically unreachable without giving something up. That makes it a product call.

### Non-blocking notes

- ChartRenderer.tsx:38 says the short form lets "the chart canvas keep its floor". There is no canvas floor any more: PanelContent.css:413 says "deliberately NO hard `min-height` floor". Given that item 2 was about exactly this kind of stale comment, reword it to something like "frees space for the chart canvas".
- PanelContent.css:411 is an over-long comment line (140 chars) (the evaluator flagged it too).
- At 1440 a footnoted title shows only "HEL-" / "1398…". A `title` attribute on `.panel-grid-card__title` would recover the full title for sighted users; that is a follow-up candidate.
- The `letter-spacing: 0.02em` override on the footer is a raw value. That is acceptable if no tracking token exists, but check it against DESIGN.md.
