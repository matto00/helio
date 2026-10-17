import { isInstant, readMotionDuration, readMotionEasing } from "./motionTokens";

/** Names the animation so a repeat call can find and cancel the previous one. */
const EXPAND_ANIMATION_ID = "expand-from";

/** The smallest scale a card is grown from; a tiny card would otherwise make the dialog start as a speck. */
const MIN_SCALE = 0.2;

/** Expand from an origin (HEL-1584, DESIGN.md §10): grows `element` out of the rectangle `origin` (the card it opens
 *  from) to its own position, one Web Animation from `translate(dx, dy) scale(s)` to no transform, on
 *  `--motion-duration-standard` and `--motion-ease-out`. It is a function, not a layout-effect hook, because a native
 *  `<dialog>` has no box until `showModal()` runs, and a measurement taken before that reads a `display: none` element.
 *  It does nothing, and starts no animation, when there is no origin, when the element is not open, when the standard
 *  duration is instant (Off, OS reduce, or an unresolved token), or when the browser has no Web Animations. The animation
 *  has `fill: "none"`, so nothing lingers: a leftover transform would make the dialog the containing block of the
 *  `position: fixed` popovers portalled into it. Callers gate on Full themselves (Subtle takes the ordinary fade). */
export function expandFrom(
  element: HTMLElement | null,
  origin: DOMRectReadOnly | null,
): Animation | null {
  if (element === null || origin === null) return null;
  if (!(element as HTMLDialogElement).open) return null;
  if (typeof element.animate !== "function") return null;
  const duration = readMotionDuration("--motion-duration-standard");
  if (isInstant(duration)) return null;
  // A repeat call (React StrictMode runs the opening effect twice in dev) must not measure the dialog with the previous
  // expansion's transform applied: that box already sits on the origin, so the second animation would be an identity and,
  // being later, would replace the first. Cancelling it first measures the dialog at its own place.
  element.getAnimations?.().forEach((animation) => {
    if (animation.id === EXPAND_ANIMATION_ID) animation.cancel();
  });
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const dx = origin.left + origin.width / 2 - (box.left + box.width / 2);
  const dy = origin.top + origin.height / 2 - (box.top + box.height / 2);
  const scale = Math.min(1, Math.max(MIN_SCALE, origin.width / box.width));
  return element.animate(
    [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: "none" }],
    {
      id: EXPAND_ANIMATION_ID,
      duration,
      easing: readMotionEasing("--motion-ease-out"),
      fill: "none",
    },
  );
}
