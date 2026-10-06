import type { Page } from "@playwright/test";

/**
 * HEL-1288 — a web-first replacement for the guards' fixed `waitForTimeout(400)` after a forced
 * hover/focus state: resolve as soon as every running CSS transition has actually finished
 * (the condition the 400 ms sleep was standing in for — theme.css's `--app-transition` is
 * 0.16 s), instead of always sleeping 2.5x that. Reading a computed colour mid-transition makes
 * Chromium serialize `oklab(...)`, which `parseColor` refuses, so the read must follow the
 * settle; this guarantees it does.
 *
 * Only `CSSTransition`s are awaited (an infinite `CSSAnimation`, e.g. a spinner, never
 * finishes and would hang this), `getAnimations()` itself forces the pending style recalc so a
 * transition started by the force/hover is visible to it, and the whole wait is capped at
 * `capMs` so a pathological transition degrades to the old fixed-wait behaviour, not a hang.
 */
export async function settleTransitions(page: Page, capMs = 1000): Promise<void> {
  await page.evaluate(async (cap) => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await frame();
    const running = document
      .getAnimations()
      .filter((a): a is CSSTransition => a instanceof CSSTransition);
    await Promise.race([
      Promise.all(running.map((a) => a.finished.catch(() => undefined))),
      new Promise<void>((resolve) => setTimeout(resolve, cap)),
    ]);
    await frame();
  }, capMs);
}
