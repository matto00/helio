## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `d8387507734f8e74bbf62df8880923791ec7c08d`. The planning artifacts are untracked in the change dir. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/pipeline-spine-container-width/HEL-1608`.

### What I verified (with evidence)

- **Round-1 change requests**:
  - CR1 is resolved: lever (e) is dropped ("No padding lever"), and the arithmetic (a)–(d) ≈ 79px on a lane row is restated.
  - CR2 is resolved: the threshold is now stated in one unit in both proposal.md and design.md D2 (content box ≤ 226px, a track of about 259px). The 1280 + list-400 case gives page 824 → track 280.2 → content 247, so compaction is OFF at 1280 for both list widths, as D2 claims.
  - CR3 is resolved: D3(i) commits a 270–340px spine-width assertion at 1280×900 inside the sweep test (allowed by C3). The Risks section names it, and task 2.1 verifies by it.
  - The round-1 non-blocking notes are handled: layout containment is in Risks, the cycle-4 rationale is reworded, the :295 comment is in D4 and task 2.3, the probe now checks both ends, and the touch risk is stated.
- **Geometry from the tree**:
  - `PipelineSpineLayout.css`: the page is `container-type: inline-size` with no padding. `.spine-body` holds the track `clamp(180px, 22vw, 340px)`. `.spine-body__spine` has `padding: var(--space-4)` (16px, `theme.css:58`) and a 1px right border, so content = track − 33. 226 → 259 is correct.
  - I recomputed D1's worked values (313→180, 465→180, 560→240, 644→240, 796→270.6, 976→331.8, 1136→340), and they are correct. At 1280 with the list at its 200 minimum: 1024 → 348 → capped at 340.
- **Row anatomy** (`SpineStepRow.tsx`, `PipelineSpine.css:182-330`):
  - The markers span renders only conditional children, so `:empty` matches when there are no markers.
  - `.spine-row__text` is a column flex container, so `.spine-row__title` stretches to the full text-column width. Its box therefore reaches the select's right content edge.
  - The menu is a sibling flex item with `opacity: 0`, revealed on hover, focus-within or selected.
- **Unnamed `@container` subjects inside the spine**: I grepped the whole tree. The unnamed rules are at `PipelineSpineLayout.css:115,130`, `PipelineSpineHeader.css:255,298,332,342` and `PaletteSearchBox.css:47`. None of their subjects are inside `.spine-body__spine`. Phone rows (`PipelineMobile.css`) never render inside `.spine-body__spine`.
- **Sweep test** (`e2e/hel1579-pipeline-spine-layout.spec.ts:395-487`):
  - The `seedPipeline(page, withBranch=false, …)` signature (:20) supports D3's `seedPipeline(page, true)` with no edit to `seedPipeline`. The branch adds a "limit" lane (:99-102).
  - The test resets the viewport to 1280×900 on each load (:411), where D3(i) slots in.
  - In the max-list iterations the list width may persist across reloads. D3(i) still holds then, because 280 is in 270–340.
- **Spec delta**: I diffed it against the live `openspec/specs/pipeline-detail-spine-layout/spec.md`. The requirement headers match exactly. The only edits are the width wording, the readability paragraph and scenario, and the paused-chip sentence. The paused-chip sentence now matches `PipelineSpineHeader.css:342-345` (the paused chip's icon is `display:none`).
- **Doc nit targets exist**:
  - The archived `design.md:19` contains `clamp(270px, 22vw, 340px)`.
  - `PipelineSpineHeader.css:295` reads "Below 1100px…".
  - `PipelineSpineHeader.css:331` reads "After the 1100px block…".
- **Scope and AC coverage**: AC1 → 1.1/3.1, AC2 → 1.2, AC3 → 2.1 plus D3(i). The work is CSS, one e2e test and docs, with no TSX, API or schema change. C1–C3 are restated in tasks.md.
- **Probe vs lever (d), reproduced** (see CR1):
  - In a minimal page I placed a `display:block` title with an absolutely positioned 28px sibling over its right end at `opacity: 0`. `document.elementFromPoint(titleRight − 4, centreY)` returned the overlay (`"m"`).
  - With `pointer-events: none` on the overlay, the same call returned the title (`"t"`).
  - Opacity does not affect hit-testing.

### Verdict: REFUTE

One internal contradiction makes the plan unfinishable as written. It is cheap to fix now and expensive to discover mid-execution.

### Change Requests

1. **D2 lever (d) and D3's right-end occlusion probe conflict, so the sweep cannot pass as specified.**
   - **The arithmetic forces lever (d).** At a 180px track (769–~956px with the list at 400), a lane row has about 51px for its title after (a)–(c). That is below 60, and "Limit rows" is 68px wide. So (d) must be applied.
   - **Lever (d) puts a hit-testable element over the title.** It moves the ⋮ to an absolutely positioned element at the row's right end with `opacity: 0`, and explicitly not `visibility`/`display`. The title box stretches to the select's right content edge (`.spine-row__text` is a column flex container), so the ⋮ sits over the title box's right end.
   - **The probe then fails on every compacted row.** D3 probes `elementFromPoint(visibleRight − 4, centreY)`. An `opacity: 0` element is still hit-tested (reproduced above), so the probe returns the menu and reports every compacted row as occluded. The test stays red after the fix.
   - **The design leaves the fix to the executor's choice.** `pointer-events: none` is only an optional "the executor may add" in Risks. The executor can either make it mandatory or weaken the probe, and the second choice would gut the AC-2 proof.
   - **Required revision, D2(d):** make `pointer-events: none` on the hidden compacted ⋮ mandatory, restored together with opacity on `.spine-row:hover` / `:focus-within`. Focusability is unaffected, so keyboard reachability holds.
   - **Required revision, D3:** state that the probe passes because the hidden ⋮ is non-hit-testable. That way, a permanently visible or permanently hit-testable overlay is still caught.
   - **Required revision, Risks:** update the "would catch a permanently visible overlay" and touch-tap lines to match. With `pointer-events: none`, a tap on the hidden area selects the step.
   - **Required revision, tasks.md 2.2:** carry the same requirement in task 2.2.

### Non-blocking notes

- design.md Risks, first bullet: "lever (e)/(d) exist for exactly that margin" still names the dropped lever (e). Change it to "(c)/(d)".
- design.md D2: "below this width; No padding lever" has a stray capital/semicolon splice.
- If the spine column ever scrolls vertically, a classic scrollbar (~15px) comes off the content box. At a 180px track the lane title would still get about 64px, so the 60px bar holds. The executor should keep that margin in mind if they tune D1's constants downward.
- With `pointer-events: none` restored on `.spine-row:hover`, a mouse hovering anywhere on a compacted row reveals the ⋮ over the title's last ~28px. That is transient and accepted by design; screenshots in task 3.3 should be taken with the mouse away from rows.
