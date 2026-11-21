## Context

`MobilePanelStack.tsx` renders each card as `panel-grid-card mobile-panel-stack__item mobile-panel-stack__item--${panel.type}`.
`.panel-grid-card` (PanelGrid.css) sets `container-type: size` and `height: 100%`, which only works with a definite
height. `MobilePanelStack.css` restores `container-type: inline-size; height: auto; flex-shrink: 0` for the kinds that
size to content (`text`, `markdown`, `image`, `output`, plus stale pre-HEL-909 names), and `metric`/`chart` get a fixed
`--mobile-panel-height`. `PanelKind` gained `form` (HEL-1085) and `mobilePanelHeights.ts` already returns
`{height: null, scrollsInternally: false}` for it, but no CSS rule lists `--form`. So a form card falls through to
size containment against an auto-height column parent, exactly the collapse HEL-1022 documented for `output`.
Inside it, `.crossfade` (`flex: 1`, `min-height: 0`) and `.panel-content--form` (`overflow-y: auto`) let the body
shrink to ~24 px and scroll.

## Goals / Non-Goals

**Goals:** a compact counter card in the stack shows value, both buttons and (non-owner) the caption with no inner
scroll at 390, 768 and 1100 px (sidebar open), light and dark; every other kind's stack height unchanged.

**Non-Goals:** desktop grid; shared Crossfade/PanelContent behaviour for other kinds; the HEL-1649/HEL-1697 files.

## Decisions

1. **Probe first (systematic-debugging law).** Before any CSS change, the executor reproduces in a live browser at
   390/768/1100 (sidebar open) and records, per ancestor from `.mobile-panel-stack__item--form` down to
   `.form-panel-view__compact-counter`: computed `height`, `container-type`, `flex`, `min-height`, `overflow-y`,
   `scrollHeight`. The root cause is confirmed only if (a) the card computes `container-type: size` and (b) forcing
   `container-type: inline-size; height: auto` on that card alone (devtools/`page.evaluate` style override, no file
   edit) restores the full counter with no inner scroll. If the probe refutes this, stop and report the real cause
   before choosing a fix; do not widen the change to shared rules without that evidence.
2. **Fix in the stack stylesheet, scoped to `--form`.** Add `.mobile-panel-stack__item.mobile-panel-stack__item--form`
   to the intrinsic-height rule (two-class specificity, same pattern), and a
   `.mobile-panel-stack__item--form .panel-content--form { height: auto; overflow-y: visible; }` override mirroring the
   text/markdown overrides, so the form body never becomes an inner scroller in the stack. Only selectors that require
   `--form` are added, so no other kind can change. `Crossfade.css`/`PanelContent.css` shared rules stay untouched
   unless Decision 1's probe proves a stack-scoped rule cannot work (then the override is still scoped under
   `.mobile-panel-stack__item--form`).
3. **Compact counter `height: 100%`.** `.form-panel-view__compact-counter` keeps `height: 100%` (desktop fills the
   cell). Against an auto-height parent it resolves to `auto`, which is the intended intrinsic size; change it only
   if the probe shows it is still clipped after Decision 2.
4. **Multi-field forms.** They are the same `form` kind and the same rule fixes them. The executor measures a
   multi-field form's stack height before/after and records it; growing from a clipped scroller to its content height
   is the same defect, not a regression. Desktop grid form cards must be byte-identical in computed height.
5. **Other kinds unchanged, measured.** The e2e seeds one card of each stack kind (output, text, markdown, image,
   divider, plus the compact counter and a multi-field form) on one dashboard and records each card's
   `getBoundingClientRect().height` at 390/768/1100. Run on base (red run) and on the fix; every non-form height must
   be equal (within 1 px). Numbers go in the evidence.
6. **Red-first test.** New spec `e2e/hel1791-compact-counter-stack-height.spec.ts`: owner and editor (a second user
   with an editor grant, the HEL-1788 caption path) at the three widths, light and dark; asserts value, `+`, `-`
   (and caption for the editor) are fully inside the card's visible rect, and that `.panel-content--form` has
   `scrollHeight <= clientHeight + 1`. It must fail on base and the failing run is committed before the fix.
   Mutation: removing the `--form` selector from the rule turns it red again.

## Risks / Trade-offs

- The stack's `output` rule caps `.panel-content` at 60dvh; forms get no cap, like text/markdown. A very long form
  scrolls with the page. Acceptable: matches the spec's "only tables scroll internally".
- Shared dev servers: the e2e must run against the lane's own servers and `helio_hel1791` DB.

## Planner Notes

- Self-approved: treating multi-field forms' growth as in scope (same kind, same defect); recorded in the spec delta.
- Self-approved: spec delta adds `form` to the per-kind list; no product question is open.
