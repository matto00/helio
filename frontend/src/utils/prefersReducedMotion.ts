import { effectiveMotion } from "../theme/appearancePrefs";

/** Live, one-shot read of whether reduced motion is in effect — the one shared implementation (HEL-1179, HEL-1572).
 *  Use it wherever JS (not CSS) has to honour reduced motion, e.g. ECharts option config or a JS-timed exit
 *  animation; CSS keeps its own scoped `@media` block.
 *
 *  Precedence (DESIGN.md §10): a saved motion choice (`data-motion` on the root) wins — Off is reduced, Full and
 *  Subtle are not — and with no saved choice the OS `prefers-reduced-motion: reduce` setting decides.
 *
 *  ECharts hover-emphasis motion must be gated in JS because it is option config, not CSS:
 *  `theme/motionTokenGuard.css.test.ts` only scans `.css` files, so neither that guard nor a CSS `@media` block
 *  reaches it. */
export function prefersReducedMotion(): boolean {
  return effectiveMotion() === "off";
}
