import type { CDPSession, Locator } from "@playwright/test";

// HEL-520 (task 2.6a-i) — extracted from state-surface-contrast-guard.spec.ts
// (HEL-866), which previously declared this as a module-local function and
// exported nothing. `e2e/support/` is where every other cross-spec probe in
// this repo lives (stateContrast.mjs, stateContrastProbe.ts,
// touchTargetProbe.ts); a helper this load-bearing staying module-local and
// un-importable was exactly the copy-vs-reuse hazard stateContrastProbe.ts's
// own header comment warns against, and the AC2 focus-presence sweep this
// ticket adds needs the identical mechanism. The marker attribute is
// namespaced `data-hel520-force-focus` (was `data-hel866-force-focus`) so
// the two call sites (this guard's own re-import, plus the new AC2 sweep)
// never collide if both happen to be probing overlapping DOM in the same
// run.
//
// Forces `:focus-visible` (and `:focus`) on `locator`'s element via the
// Chrome DevTools Protocol's `CSS.forcePseudoState`, rather than
// `locator.focus()`. Playwright/Chromium's `.focus()` performs a real
// programmatic focus, but Chromium's own focus-visible heuristic does NOT
// treat a programmatic focus as keyboard-originated, so it never matches
// `:focus-visible` — confirmed the hard way: every `:focus-visible`-based
// rule in this app (the dominant focus-state pattern here, e.g.
// `.command-palette__item:focus-visible`) read as "nothing changed" under
// plain `.focus()`, which would have been 100% FALSE FAILURES across the
// whole focus-state population, not real absences (design.md D2a).
// `CSS.forcePseudoState` is the same mechanism DevTools' own "Force state"
// panel uses and is the only reliable way to render the TRUE
// `:focus-visible` styling without a real keyboard Tab sequence per element.
export async function forceFocusVisible(
  client: CDPSession,
  locator: Locator,
): Promise<() => Promise<void>> {
  const marker = "data-hel520-force-focus";
  await locator.evaluate((el, m) => el.setAttribute(m, "1"), marker);
  const { root } = await client.send("DOM.getDocument");
  const { nodeId } = await client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: `[${marker}]`,
  });
  await client.send("CSS.forcePseudoState", {
    nodeId,
    forcedPseudoClasses: ["focus", "focus-visible"],
  });
  return async () => {
    try {
      await client.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
    } catch {
      // element may have detached (overlay closed) — nothing to clear.
    }
    await locator.evaluate((el, m) => el.removeAttribute(m), marker).catch(() => {});
  };
}
