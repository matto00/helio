/** Live, one-shot read of the OS/browser reduced-motion preference — the one
 *  shared implementation (HEL-1179). Use it wherever JS (not CSS) has to
 *  honour `prefers-reduced-motion`, e.g. ECharts option config or a JS-timed
 *  exit animation; CSS should keep using its own `@media` block.
 *
 *  ECharts hover-emphasis motion must be gated in JS because it is
 *  option config, not CSS: `theme/motionTokenGuard.css.test.ts` only scans
 *  `.css` files, so neither that guard nor a CSS `@media` block reaches it.
 *
 *  Guards `matchMedia` itself, not just `window` — jsdom (the test
 *  environment) doesn't implement it at all, so an unmocked test would
 *  otherwise throw rather than simply behaving as "no preference". */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
