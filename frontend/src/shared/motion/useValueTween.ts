import { useLayoutEffect, useState } from "react";

import { useMotion } from "../../theme/ThemeProvider";
import { isInstant, readMotionDuration } from "./motionTokens";

interface Tween {
  from: number;
  to: number;
  value: number;
}

/** Fraction digits of a finite number as written (`1775.32` is 2, `1590` is 0); capped so an exponent form stays sane. */
function decimalsOf(value: number): number {
  return Math.min((String(value).split(".")[1] ?? "").length, 10);
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

/** Value tween (HEL-1573, DESIGN.md §10): returns the number to display. The first value shows at once (no count-up on
 *  mount). A change counts from the value on screen to the new one over `--motion-duration-standard` with an ease-out
 *  curve; the final frame is exactly `target`. Only Full tweens. Under Subtle and Off (decided from `useMotion()`:
 *  the standard duration stays 280ms under Subtle because fades keep it) and for a non-finite value the new value is
 *  returned immediately. `null` passes through. In-flight frames are rounded to the larger fraction-digit count of the
 *  two endpoints, so an integer counts through integers and a decimal tweens at its own precision. The token duration is
 *  read inside a layout effect (never during render): an instant or unresolved token cancels the tween before paint. */
export function useValueTween(target: number | null): number | null {
  const motion = useMotion();
  const [tween, setTween] = useState<Tween | null>(null);
  const [seen, setSeen] = useState(target);

  // React's "adjust state while rendering": start (or retarget) a tween the render a new target arrives, so there is
  // never a frame that shows the new value before the count begins. The layout effect below ends the tween before paint
  // when the token turns out to be instant, so the old value is never painted in that case either.
  if (target !== seen) {
    setSeen(target);
    const from = tween ? tween.value : seen;
    if (
      motion === "full" &&
      target !== null &&
      from !== null &&
      Number.isFinite(target) &&
      Number.isFinite(from)
    ) {
      setTween({ from, to: target, value: from });
    } else {
      setTween(null);
    }
  }

  const tweenFrom = tween?.from;
  const tweenTo = tween?.to;
  useLayoutEffect(() => {
    if (tweenFrom === undefined || tweenTo === undefined) return undefined;
    const duration = readMotionDuration("--motion-duration-standard");
    if (isInstant(duration)) {
      setTween(null);
      return undefined;
    }
    const decimals = Math.max(decimalsOf(tweenFrom), decimalsOf(tweenTo));
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const progress = Math.min((now - start) / duration, 1);
      if (progress >= 1) {
        setTween(null);
        return;
      }
      setTween({
        from: tweenFrom,
        to: tweenTo,
        value: Number(
          (tweenFrom + (tweenTo - tweenFrom) * easeOutCubic(progress)).toFixed(decimals),
        ),
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [tweenFrom, tweenTo]);

  return tween !== null && tween.to === target ? tween.value : target;
}
