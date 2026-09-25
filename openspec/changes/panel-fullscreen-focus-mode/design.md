## Context

See proposal.md - Why. Ground truth gathered during premise validation
(`.concertino/runs/HEL-584/evidence/premise-validation.md`):

- `PanelCard.tsx` is the sole `usePanelData(panel)` call site (HEL-579 design.md Decision 1); its result
  is threaded to `PanelCardBody` as individual memo-stable props. Any fullscreen overlay must consume
  that same result as props — never call `usePanelData` a second time.
- `PanelDetailModal.tsx` already renders `<Modal size="full">` for its view mode — a shipped, light/dark
  precedent for "maximize panel content via the shared `Modal` primitive." `Modal` supplies the opaque
  `--app-surface-strong` surface, `--app-overlay`/blur backdrop, one `ui-modal-in` entrance keyframe
  (already `prefers-reduced-motion`-safe via theme.css's global `*` rule), native-`<dialog>` focus trap,
  `Esc`-close (via the `cancel` event), and focus restore (`previouslyFocusedRef`) — all for free.
- `ChartPanel.tsx`'s `<ReactECharts autoResize={true}>` already self-observes its container via
  `echarts-for-react`'s internal `ResizeObserver` and calls `chart.resize()` — reusing `ChartRenderer`/
  `ChartPanel` unmodified inside a differently-sized `Modal` body is expected to already re-fit.
- `PanelKind` is `"output" | "text" | "markdown" | "image" | "divider" | "form"` (post HEL-903 remodel);
  `output` sub-dispatches on the Output's own `kind` inside `OutputPanelContent`.
- `MobilePanelStack.tsx` is documented read-only, "no header actions" today (HEL-579's own in-file note).
- A same-named-sounding but unrelated capability, `panel-view-mode`, already covers `PanelDetailModal`'s
  own view/edit toggle — distinct from this ticket's standalone grid-triggered overlay.

## Goals / Non-Goals

**Goals:**
- Reuse `Modal` + `PanelContent` verbatim; add no forked rendering, no new resize-observer wiring beyond
  what `autoResize` already provides, no new focus-trap/backdrop/animation code.
- Zero new fetch: the overlay is fed props from the caller's existing `usePanelData` result.

**Non-Goals:**
- Editing within fullscreen (stays in `PanelDetailModal`) — proposal.md.
- Presentation/slideshow across multiple panels — proposal.md.
- Preserving tooltip/drill-down interactions beyond "don't suppress them" — those tickets (HEL-566,
  HEL-572) haven't landed; nothing in this change intercepts ECharts' own pointer/click events, so
  whatever they later wire into `ChartPanel` keeps working unmodified.

## Decisions

**Decision 1 — Overlay is a new `PanelFullscreenOverlay` component wrapping `Modal size="full"`, mounted
in `PanelCard`, not a new bespoke full-viewport `<div>`.** Alternative considered: a dedicated
full-bleed (100vw/100vh) overlay per the ticket's "or a dedicated full-viewport overlay" option. Rejected
because `PanelDetailModal`'s `size="full"` (1200px cap, 90vh cap) is the only shipped, cross-theme-verified
precedent for "maximize a panel's content" in this codebase, and a bespoke overlay would have to
re-implement — and re-verify — focus trap, `Esc`-handling, backdrop, and reduced-motion behavior that
`Modal` already provides.

**Decision 1a — `PanelFullscreenOverlay` gets its own CSS class giving `.ui-modal` a definite height,
mirroring `PanelDetailModal.css`'s `.panel-detail-modal--view { height: min(88vh, 900px); }` pattern.**
`Modal.css`'s base `.ui-modal` sets only `max-height: 90vh`, never an explicit `height` — a shrink-to-fit
box (confirmed by the skeptic's design-gate round 1 review, `skeptic-design-1.md`: `Modal.css`'s own
in-file HEL-746 comment documents this exact "blank area with a horizontal line" failure mode for "every
consumer whose `.ui-modal` has no explicit `height` override — i.e. every consumer except
`PanelDetailModal`"). `PanelDetailModal` only gets a real filled `size="full"` box because of its own
`.panel-detail-modal--view` override layered on top via `className`. Without an equivalent override here,
`ChartPanel.tsx`'s `height: "100%"` wrapper/ECharts instance has no definite ancestor height to resolve
against, so neither "maximized" nor the chart-resize AC would actually hold. New rule, in a new
`PanelFullscreenOverlay.css`, applied via `Modal`'s `className` prop:
```css
.panel-fullscreen-overlay {
  height: min(90vh, 1000px);
  overflow: hidden;
}
```
`90vh` matches `Modal.css`'s own `max-height` cap exactly (no wasted headroom); `1000px` is a deliberately
slightly larger ceiling than `PanelDetailModal--view`'s `900px` since this overlay carries no
tab-bar/footer chrome to reserve space for — an intentional, minor, self-approved deviation, not a typo.

**Decision 2 — `PanelFullscreenOverlay` receives `panel` and the full `PanelDataResult` (data, rawRows,
headers, isLoading, error, errorKind, noData, neverMaterialized, chartAggregate, rowsTruncated) as props
from `PanelCard`, not via its own `usePanelData(panel)` call.** This mirrors `PanelCardBody`'s existing
contract exactly (same props shape, `Omit<PanelDataResult, "isRefreshing">` plus `panel`) — reusing that
shape rather than inventing a new one keeps the "no second fetch" invariant mechanically obvious at the
call site and matches HEL-579's own established pattern for `PanelCard`'s children.

**Decision 3 — Fullscreen-eligible kinds: `output` (all Output sub-kinds), `text`, `markdown`, `image`.
Excluded: `divider`, `form`.** `divider` renders no content worth maximizing (`DividerRenderer` is a
visual rule). `form` is a write surface (`FormRenderer`) — a fullscreen *view-only* overlay is the wrong
place to submit data, and the ticket's own "no editing controls" requirement would otherwise force
building a read-only form renderer nobody asked for. The header control is gated on `panel.type` (`text`/
`markdown`/`image`/`divider`/`form`) or, for `type: "output"`, always eligible (kind sub-dispatch happens
inside `PanelContent` already; the overlay doesn't need to pre-resolve the Output's own `kind` to decide
eligibility).

**Decision 4 — No fullscreen affordance in `MobilePanelStack`.** That surface is documented read-only
with no header actions at all today, and its single-column, viewport-width layout already approximates
"maximized" — adding a second overlay mode there is unrequested surface area, not parity.

**Decision 5 — Chart resize: rely on `autoResize`, verify rather than add new code.** `ChartPanel`'s
existing `autoResize={true}` prop is expected to already handle the overlay's larger canvas with zero
changes, PROVIDED Decision 1a's definite-height rule is in place first — `autoResize` alone cannot
compensate for a shrink-to-fit ancestor with no real box to resize into (design-gate round 1 finding).
The executor must verify both together: the overlay's content area reaches a real, non-content-shrunk
size (Decision 1a's CSS applied), AND a resize call fires against that real size when the overlay opens.
If verification shows `autoResize` does NOT fire reliably inside a `<dialog>` even once Decision 1a's
height is in place (native dialogs can affect layout timing), escalate rather than silently patching
around it — this is exactly the kind of premise that must be probed, not assumed.

## Risks / Trade-offs

- [Risk] Forgetting the definite-height override (Decision 1a) silently produces a shrink-to-fit dialog
  with a broken/near-zero-height chart canvas — the exact previously-shipped, previously-regressed bug
  `Modal.css`'s own HEL-746 comment documents for `size="full"` consumers lacking it. → Mitigation:
  Decision 1a names the specific CSS rule/value; tasks.md 1.2 creates and verifies it explicitly before
  any resize verification is considered meaningful (tasks.md 3.1 now depends on it).
- [Risk] `Modal`'s `size="full"` (1200px/90vh caps) is less than a true edge-to-edge fullscreen a very
  large external monitor might want. → Mitigation: this matches the ticket's own explicitly offered
  choice ("Modal `lg` size **or** a dedicated full-viewport overlay") and the existing `PanelDetailModal`
  precedent; not a regression from anything shipped today. Out of scope to build a second, unprecedented
  overlay primitive for marginal extra width.
- [Risk] `autoResize` might not fire correctly inside a native `<dialog>` opened via `showModal()` (layout
  timing edge case). → Mitigation: Decision 5 — verify with a live render + resize assertion; escalate if
  not confirmed rather than adding unverified resize code.
- [Risk] Gating eligibility on `panel.type === "output"` without pre-checking the Output's resolved `kind`
  means a not-yet-loaded Output briefly shows a Fullscreen button before its kind is known. → Mitigation:
  acceptable — `PanelContent` already renders its own loading skeleton inside the overlay exactly as the
  card does; the button's presence doesn't imply premature content.

## Migration Plan

Frontend-only, additive UI; no data migration, no backend change, no feature flag needed — the control
degrades to "not present" for the two excluded kinds and is otherwise universally available once merged.

## Planner Notes

Self-approved: new-component boundary (`PanelFullscreenOverlay` vs. extending `PanelCard` inline) and the
kind-eligibility list (Decision 3) are both implementation-level judgment calls within the ticket's stated
scope, not new capability/scope decisions — no escalation raised.
