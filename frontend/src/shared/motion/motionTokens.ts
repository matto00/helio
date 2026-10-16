// Reads the DESIGN.md §10 motion tokens from the cascade for the JS primitives. The tokens are the only source
// of timing: no primitive carries a duration of its own (`motionPrimitiveLiterals.test.ts` enforces it).

/** A resolved duration at or below this many milliseconds is instant: Subtle's and Off's movement tokens resolve to
 *  a near-zero value (never 0, so `transitionend` still fires), and an unresolved token reads as 0. */
export const INSTANT_AT_OR_BELOW = 0.01;

const DURATION = /^(-?\d*\.?\d+)(ms|s)$/;

/** The token's duration in milliseconds, or 0 when the token is unresolved or not a time (jsdom has no cascade). */
export function readMotionDuration(name: string, element?: Element): number {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return 0;
  const raw = getComputedStyle(element ?? document.documentElement)
    .getPropertyValue(name)
    .trim();
  const match = DURATION.exec(raw);
  if (!match) return 0;
  const amount = Number(match[1]);
  return match[2] === "s" ? amount * 1000 : amount;
}

/** The token's easing string (e.g. `--motion-ease-out`), or `linear` when it is unresolved. */
export function readMotionEasing(name: string, element?: Element): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return "linear";
  const raw = getComputedStyle(element ?? document.documentElement)
    .getPropertyValue(name)
    .trim();
  return raw === "" ? "linear" : raw;
}

export function isInstant(durationMs: number): boolean {
  return !(durationMs > INSTANT_AT_OR_BELOW);
}
