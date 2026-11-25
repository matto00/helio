## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spec ordering (the race the design depends on).** `e2e/hel1510-output-editor-table-overflow.spec.ts:91-113`
  reads `await expect(name).toBeVisible()`, then `limit = contentRight(card) + 0.5` once (l.93), then each control's
  `getBoundingClientRect().right` in a loop of separate `evaluate` round trips (l.106-112). `toBeVisible` does not wait
  for opacity, transform or a stable geometry, so `limit` can be read while the entrance is still running. This matches
  the design's Context.
- **The animation.** `frontend/src/shared/ui/Modal.css:19` has `animation: ui-modal-in var(--transition-slow) backwards`.
  The keyframes (l.27-36) go from `translateY(var(--motion-rise-distance)) scale(0.985)` to `none`. `theme.css` sets
  `--transition-slow: 0.28s cubic-bezier(0.3, 0.9, 0.4, 1)` and `--motion-rise-distance: 6px`. Subtle motion and
  `--expanding` switch to `ui-modal-fade-in` (l.49-52). All confirmed.
- **Magnitude sanity check.** The card's right edge is about 322px right of the dialog centre (about 872 in a 1100px
  viewport). Under `scale(0.985)` that puts the edge about 4.8px left on frame 1, and the ease-out curve brings it back
  within about 1px in the first ~100ms. This agrees with HEL-1613's 871.53-871.87 -> rest, and a `limit` read under load
  can plausibly land below the ~871.5 the 0.1px failure needs. HEL-1613's table gives a resting limit of 872.374 against
  a widest control of 872.000, so the real headroom is about 0.37px, which is smaller than the 0.5 margin suggests.
- **D1 (the force) is honest in mechanism.** Slowing the same CSS animation keeps its path (same keyframes, same
  transform origin, same direction of travel) and only widens the window in which the spec's real ordering (`limit`
  first, controls later) can sample two different points of it. A slow CI box does the same thing relative to a fixed
  280ms animation. The design correctly rejects a whole-measurement pause: card and controls scale together, so a pause
  would stay green and wrongly look like "premise refuted". It also forbids an infinite pause, which would hang the fixed
  run. The ticket explicitly sanctions forcing a mid-animation measurement. The probe is held to "byte-identical except
  the init script", with a committed diff. That is the right guard against a manufactured red.
- **D2 (the wait) targets the right element and cannot hang in practice.**
  - `Modal.tsx:261` renders a native `<dialog class="ui-modal ...">` with no inner `role="dialog"` wrapper, so
    `page.getByRole("dialog")` resolves to the element `.ui-modal[open]` animates. The design also has the executor
    confirm this.
  - The Output editor (`PipelineDetailDialogs.tsx`) does not pass `expandFrom`. grep finds `expandFrom` only in the
    panel grid and detail modal consumers, so only the CSS animation is in play here, and the WAAPI case is covered
    anyway.
  - `Element.getAnimations()` without `subtree` excludes `::backdrop` (opacity only, irrelevant to geometry) and
    descendant spinners.
  - `OutputEditorSheet.css` and `TableDisplayFields.css` have no `animation` declarations, only colour/border
    `transition`s that do not affect geometry. No other entrance motion moves the card.
  - Nothing in `frontend/src` sets `animation-play-state`, so no paused animation can leave `finished` unresolved.
  - Infinite animations are filtered out and cancellation is caught.
  - The test's existing 90s timeout bounds the wait.
  - Even under the force, a few seconds of stretch resolves well inside 90s.
- **AC coverage.**
  - Red, green and mutation: D3, tasks 1.3 and 1.5.
  - 20/20 runs with `--workers=2` under `nice -n 19`: task 1.6.
  - No tolerance, retries or timeout change: Goals/Non-goals, with the `+ 0.5` kept.
  - E2E only: the Impact section.
  - Escalate if the force does not go red: D4.
  - Red committed before the fix: D3.
- **No placeholders or contradictions** between proposal, design and tasks. Scope is limited to the one spec, and
  `skip_specs` is justified because the change is test-only.
- Premise validation (`.concertino/runs/HEL-1621/evidence/premise-validation.md`) agrees with what I read directly.
- Reviewed HEAD: 793802e50a8de763f905a431ca120490c372404d (planning artifacts are untracked; no code diff yet).

### Verdict: CONFIRM

### Non-blocking notes

1. **Make honest claims about the forced red.** A stretched entrance will produce an overflow of several px, much
   larger than the real ~0.1px. The red shows two things: the mechanism is real, and the wait is load-bearing. It does
   **not** prove that the entrance caused the observed flake. The evidence and PR wording should say this, as HEL-1613
   did. Log the stretch factor and the red's `limit`/`right` values next to HEL-1613's numbers. Prefer a modest stretch,
   for example 5-10x, over an extreme one.
2. **Prefer a deterministic stretch mechanism.** `animationstart` is dispatched asynchronously, so a frame or more may
   pass before `playbackRate` is applied. That is harmless, but an injected stylesheet such as
   `.ui-modal[open] { animation-duration: <N>s }`, or `updateTiming` applied from a `MutationObserver` on `open`, is more
   deterministic. The executor's choice; the logs must show the mechanism used.
3. **Single dialog for `evaluate`.** `dialog.evaluate` is strict, unlike the chained `dialog.locator(...)`. The executor
   should confirm that exactly one dialog is in the accessibility tree at that point, which is expected because closed
   `<dialog>`s are not.
4. **Check the resting numbers in the red log.** The design's Context says "rest at exactly 872.000" for the card edge.
   HEL-1613's table implies a resting content-right of about 871.874 (limit 872.374 − 0.5). Record the raw resting
   content-right in the red log so the headroom is measured, not inferred.
5. `tasks.md` has an empty "Standing Constraints" heading. Either fill it (lane DB, port pins, `nice`, worker caps) or
   remove it.
