## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 3b9f4c83d84962fa9b8d0b34646fa9c8899519ad (planning artifacts only, no implementation yet).

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/compact-counter-phone-collapse/HEL-1791`.
- **Root-cause hypothesis matches the live tree** (design.md Context):
  - `frontend/src/features/panels/types/panel.ts:66`: `PanelKind = "output" | "text" | "markdown" | "image" | "divider" | "form"`. `form` exists.
  - `frontend/src/features/panels/ui/grid/PanelGrid.css:53-57`: `.panel-grid-card { container-type: size; ... height: 100%; }`.
  - `MobilePanelStack.css`: the intrinsic-height rule lists `--table/--markdown/--text/--image/--collection/--timeline`. There is a separate `--output` rule. **No `--form` selector anywhere.** The `.panel-content` cap is output-only. So a form card falls through to size containment, which is the same failure mode HEL-1022 documented for `output`.
  - `mobilePanelHeights.ts:~87-92`: `form` already returns `{height: null, scrollsInternally: false}`, so the policy module and the CSS disagree. That is the defect the design names.
  - `MobilePanelStack.tsx:272`: the card class is `mobile-panel-stack__item--${panel.type}`, so `--form` is emitted.
  - `PanelContent.css:77-80`: `.panel-content--form` shares `overflow-y: auto` with text/table, which explains the 24 px inner scroller. `Crossfade.css`: `.crossfade { flex: 1; min-height: 0 }` matches the ticket's ancestor probe.
  - Total card height under size containment works out to roughly 2 x 14 px padding + 2 x 1 px border = 30 px. That matches the measured 30-42 px.
- **Probe-first is mandated** (Decision 1) with a concrete confirm/refute criterion: (a) a computed `container-type: size`, and (b) an override with no file edit restores the counter. Escalation is scoped if the probe refutes it. This satisfies systematic-debugging.
- **Fix scoping**: the added selectors all require `--form` (two-class specificity, same pattern as the existing rules). Non-form kinds cannot match. Decision 5 and task 2.4 measure this per kind anyway.
- **Overflow override side effect checked**: `PanelContent.css:83-94` scroll-shadow background uses `background-attachment: local, local, scroll, scroll`. With `overflow-y: visible`, the top cover layers (surface, `--space-6`) sit above and exceed the shadow layers (`--space-2`), so no stray shading appears. The text override already relies on the same behaviour.
- **Spec delta**: I compared it against `openspec/specs/mobile-panel-sizing/spec.md`. The MODIFIED requirement keeps every existing bullet and all four existing scenarios verbatim, and adds the `form` bullet and one scenario. Nothing is dropped.
- **AC coverage**:
  - AC1 (390 px, light and dark, value, buttons, caption for a non-owner) is covered by tasks 2.1 and 1.2-1.3.
  - AC2 (768 px and 1100 px with the sidebar open) is covered by task 2.1.
  - AC3 (other kinds keep their height) is covered by tasks 2.2 and 2.4, plus spec scenario AND.
  - AC4 (a test that fails first) is covered by tasks 2.3 and 2.5 (mutation), plus C12.
- **Feasibility**: HEL-1788 is merged (`894a72c56`, an ancestor of the ticket's base `a867001d7`, which is itself an ancestor of HEAD). `COUNTER_TALLY_CAPTION` exists. `MobilePanelStack.css.test.ts` and `e2e/hel1088-compact-counter-chrome.spec.ts` exist. Editor-grant e2e precedents exist (for example `e2e/hel1661-viewer-run-controls.spec.ts`).
- **Placeholders or contradictions**: none found. Decision 3 and task 1.4 are conditional on the probe's evidence, which is properly gated and not hand-waving.

### Verdict: CONFIRM

### Non-blocking notes

1. **Container-query side effects are not anticipated in design.md.** The collapsed form card currently matches `@container panel-card (max-height: 179px)`, because its size-contained content box is about 0 px. That applies:
   - `PanelGrid.css:382-391`: title at `--text-sm` and card gap `--space-2`.
   - `PanelContent.css:399-416`: form gap `--space-2` and `--text-micro` labels and hints.

   Switching to `inline-size` stops every height query from matching. The form card's title and multi-field labels will therefore grow to the normal sizes used by text and output cards in the stack. This is parity, not a regression, but the executor should expect it. They should record it alongside the per-kind height table so the final gate does not mistake it for drift. Height-only queries such as `min-height: 280px` will also stop matching, consistent with every other intrinsic kind.
2. Decision 5 and task 2.2 seed an `image` panel and an `output` panel. Those need an upload and a pipeline run. If either is impractical, the executor should say so explicitly rather than silently dropping the kind. The AC3 measurement must cover at least `output` and `text`/`markdown`.
3. At 1100 px the phone `@media (max-width: 768px)` padding rule does not apply. The card padding comes from `.panel-grid-card`'s `clamp(...)`. The e2e should not hardcode the 14 px phone padding in any geometry assertion.
