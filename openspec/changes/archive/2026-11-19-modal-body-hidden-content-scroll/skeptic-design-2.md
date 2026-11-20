## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 94a8ef292ba5475e3906c2aa5760110a9d23abe9. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/modal-hidden-content-scroll/HEL-1774`.
- **Code citations, re-read against the live tree.**
  - `Modal.css:187-191`: `.ui-modal__body` is `flex: 1; overflow-y: auto; padding`, with no `position`.
  - `Modal.css:13-19`: the transform/fixed-popover comment that design.md cites when it rejects `contain` is there.
  - The only other `position` rules in `Modal.css` are at `:276`/`:281`. They are the footer `.ui-modal-btn` hit expander, which is outside the body, so the shared rule does not touch it.
  - The consumer grep (`<Modal\b|<BottomSheet\b`, `.tsx`, tests excluded) returns 30 files, which matches the "about 30" in design.md.
  - Every regression spec named in Decision 5 exists: hel1763, hel1752, hel1668-phone-sheet, hel909, hel773. So do `Modal.css.test.ts` and `BottomSheet.tsx`.
- **Round-1 CR1 is resolved.** The prior REFUTE found that the injected `.sr-only` case on a short body is green on unfixed CSS. Each place that case appears now handles it:
  - **design.md Decision 4:** the body is made to overflow first (an in-flow spacer of about 2x `clientHeight`, or a modal that already scrolls). The `.sr-only` span is the body's last child, and the body stays scrolled to the top. The text states the case "MUST be red in the committed red run" and calls it the discriminator.
  - **tasks.md:** Standing Constraint C15 says the same, and any case that is green in the red run is labelled a guard.
  - **spec.md:** the scenario "Hidden element added outside any positioned wrapper" now names an overflowing body, a last-child placement and scrollTop 0. That matches the 2038/731 defect configuration I measured in round 1, so the case can fail.
  - **Mutation (a):** "remove the shared rule → the injected case goes red" is consistent with that measurement.
- **The round-1 non-blocking notes were taken up.** The Risks section and Decision 1 now record clipping of in-place absolute content near the body's bottom edge. Decision 2 now says the popover check runs at rest, so the pre-existing transform re-anchoring in `BottomSheet` is not blamed on the new rule.
- **The post-fix bound holds for the injected case.** With the body positioned, `.sr-only` (1x1, `margin: -1px`) sits at the end of the in-flow content. That adds at most about 1 px to the body's scrollHeight, inside the +2 tolerance. The fixed run therefore passes on content bottoms computed from the elements, with no hard-coded pixels.
- **Internal consistency:**
  - The proposal, design and spec agree on the same preferred fix and the same evidence-gated fallback.
  - Tasks 1.x/2.1/3.x/4.x follow Decision 1 to Decision 5 in order: inventory, then a red run, then the fix, then mutations and the sweep.
  - Each task has a verify clause.
  - No TODO/TBD placeholders.
- **AC coverage:**
  - AC1 (list and measure every modal): Decision 1 and tasks 1.1-1.3, including static coverage for modals that cannot be reached.
  - AC2 (fix shared or per modal, justified per child): Decision 2 and tasks 3.1-3.2, with a "Moved children" table and a Resolution section.
  - AC3 (an e2e/unit guard that goes red, phone and desktop, light and dark): Decision 4 and tasks 2.1/4.1-4.3. The viewports are 375, 390x844 and 1280, each in both themes.
  - No scope drift. The change is CSS only, so no API or schema contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

- `position: relative` without `z-index` creates no stacking context. It does, however, move the body into the positioned paint layer, above non-positioned siblings. If any consumer's header or footer overlaps the body (negative margin, shadow bleed), the body would now paint over it. The executor should check this in the inventory screenshots for consumers that override header or footer spacing, especially `CommandPalette` and `BottomSheet`.
- Task 1.2 probes at 375 and 1280, while the e2e also runs at 390x844. That is fine. If a modal's overflow differs only at 390x844, the e2e should still catch it.
