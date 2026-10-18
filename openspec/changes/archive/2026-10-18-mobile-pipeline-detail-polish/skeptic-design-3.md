## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 6477341111d4b4ec6d0368e5a1f46e473325f226. The planning artifacts are untracked under the change dir.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/mobile-pipeline-detail-polish/HEL-1668`.
I started the servers (7100/10007, `assert-phase.sh servers` PASS) for one live probe, then stopped them with
`stop-servers.sh` (`STOPPED ports=7100,10007`).

### What I verified (with evidence)

**Round-2 change requests, checked against the revised artifacts and the live code**

| R2 CR | Status | Ground truth |
|---|---|---|
| 1 D2 ordering | Mostly resolved. The design now names a double rAF, states the spec scenario as a DOM-and-frame property, and keeps the escalation risk line. Two loose ends remain (CR2 below): task 7.5 still names an "AX snapshot" for the ordering, and the frame-counter threshold is not pinned. | `Toast.tsx:127-169`: one `createPortal(..., document.body)` |
| 2 D2 remount | Resolved. The timer resumes from a per-id deadline, the entrance is suppressed by an entered flag, and a mid-exit toast is completed. Toast ids are fresh on every push, including a coalesced repeat (`Toast.tsx:122-125`, toastsSlice D1), so a module map keyed by id is sound. The pending `dismissToast` `setTimeout` in `dismiss` (`Toast.tsx:43-45`) is not cleared on unmount, so "completed" is achievable. | `Toast.tsx:30-55` |
| 3 D5 | Partly resolved. Splitting mixed rules, the narrowed spec scope and the 1024 touch e2e are all in place. The reveal allowlist boundary is wrong and causes a HEL-1608 regression on touch tablets (CR1). | See the probe below |
| 4 D1 | Resolved. The ref captures the initial value at mount, the page owns consumption at its first steps load in any layout, and the sync is gated until consumption. The page has the steps: `usePipelineDetailPage` is page-level (`PipelineDetailPage.tsx:37-38`), and the content component is mounted during the loading skeleton, so "capture at mount" happens before any layout's effects. | `PipelineDetailPage.tsx:29-93` |

**Live probe: what the D5 partition does to the selected compact row on a touch tablet** (dev account, pipeline
`hel1608-eval-pipe`, 1024×800, dark)

- 1024×800 really is the compact spine. Spine column content width is 244px. `.spine-row__menu` is
  `position: absolute; pointer-events: none` at rest. So the planned 1024 touch e2e exercises the right mode.
- D5 keeps "`PipelineSpine.css:459-473`" ungated as the reveal and its "menu backing". It gates every other `:hover`
  fill. That includes the compact block's own selected-row counterparts at `:479-485`
  (`.spine-row--selected:hover .spine-row__select` / `__menu`).
- I emulated that partition on a sticky-hovered selected row. I hovered the row (a touch tap leaves the same sticky
  `:hover`), then deleted only the two `:479/:483` rules from the CSSOM.
  - Before: select `color(srgb 0.976 0.451 0.086 / 0.3)` (accent-mid); menu backing is the accent gradient.
  - After: select `rgb(35, 32, 25)` (`--app-surface-raised`); menu backing `none | rgb(35, 32, 25)`.
- So the tapped (selected) compact row turns neutral grey instead of the accent tone it shows today. That breaks the
  run rule "keep HEL-1608's desktop compact-spine behaviour" and D5's own "HEL-1608 behaviour is kept exactly".
- The planned 1024 e2e only checks that the menu is reachable, so it would stay green over this regression.
- Screenshots:
  - today: `/home/matt/Development/helio/.concertino/runs/HEL-1668/evidence/.concertino/scratch/HEL-1668/skeptic-design-3/compact-selected-hover-today.png`
  - partition: `/home/matt/Development/helio/.concertino/runs/HEL-1668/evidence/.concertino/scratch/HEL-1668/skeptic-design-3/compact-selected-hover-partial-gating.png`
  - The claim rests on the computed-colour values above (self-authenticating), not on file ordering.

**Other D5 text checked against the CSS**
- `PipelineSpine.css:326-330` and `:459-463` are both opacity reveals of the row menu, not fills.
  - The "Hover fills" bullet lists them as rules to SPLIT (their `:hover` moves into the gate).
  - The "Reveals" bullet says `:459-473` stays ungated.
  - The two bullets contradict each other for `:459-463`, and they leave `:326-330` ambiguous.
- `:467-469` (`.spine-row:hover .spine-row__select`) is the row's fill, not the menu backing the design calls it.
- `:207-209` (`.spine-row:hover .spine-row__grip { opacity: 1 }`) is a third reveal the design does not classify.

**D2 race premise.** This is unchanged from round 2 (one commit for the step restore plus the toast), and I did not re-measure it.

### Verdict: REFUTE

D1, D3, D4, D6, D7 and the D2 remount decisions are sound. D5's allowlist boundary would ship a visible HEL-1608
regression on touch tablets that the planned tests cannot see. It is cheap to fix in the artifacts now.

### Change Requests

1. **D5 / task 5.1 / task 7.3 / task 7.5: the compact-spine hover block must be classified as one unit.**
   - Today the plan keeps `:459-473` ungated and gates `:479-485`. As measured above, that turns the selected compact
     row grey on a touch tablet.
   - Required:
     - (a) Treat the whole `@container spine-column` hover set, `PipelineSpine.css:459-486`, as one allowlist entry
       that stays ungated. That covers the reveal, the select fill, the menu backing and both `--selected:hover`
       counterparts. Alternatively, gate the set as a whole and add an ungated replacement that keeps the selected row's
       accent under `(hover: none)`. Name the exact lines and the reason in the allowlist.
     - (b) Remove `:459-463` from the "Hover fills … SPLIT" list.
     - (c) State the class of `:326-330` and `:207-209` explicitly. Both are reveals. If gated, say why gating is
       harmless; for `:326`, a tapped row becomes selected, which shows its menu.
     - (d) Extend the 1024×800 `hasTouch`+`isMobile` e2e. After the tap, the selected row's
       `.spine-row__select` background and `.spine-row__menu` background-image must equal today's values (accent-mid,
       and the accent gradient), in light and dark. That makes the regression red.
   - Evidence: the `ref=` screenshots and the computed values above.

2. **D2 / task 7.5: align the task text with the design, and pin the frame threshold.**
   - (a) Task 7.5 still says "region-before-message ordering recorded via MutationObserver + AX snapshot". That is the
     after-the-fact AX proof round 2 rejected. Reword it to the design's DOM-and-frame property. An AX check may remain
     only for the separate "message is in the assertive region exposed to assistive technology" scenario.
   - (b) "At least one completed frame" via a rAF-loop counter is not pinned. With a single rAF the message can land in
     the next frame's rAF phase after the loop's own increment, which gives a counter difference of 1 and passes. State
     the assertion so a single rAF fails. For example: the message mutation is observed in a frame whose counter is at
     least region-insert counter + 2. Or use round 2's formulation: a rAF scheduled at region insertion has run, and a
     second rAF has started, before the message mutation. Show it red with a single-rAF mutation.

### Non-blocking notes
- D2: delete each module-map entry (deadline and entered flag) when its toast is dismissed, or the map grows for the
  session.
- D2: say what happens to a toast pushed during the double-rAF window right after a re-target. It is not in the
  100 ms race set, so as written it is inserted at once into regions connected less than a frame ago. Either include
  it in the delayed insert, or accept it and say so.
