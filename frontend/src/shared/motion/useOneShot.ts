import { useCallback, useState } from "react";

/** One-shot change cue (HEL-1584, DESIGN.md §10): `active` turns true on the render a watched value changes into a target
 *  state while mounted, and never on mount (a surface that mounts already in the target state stays quiet). It ends at
 *  `done()` (wire it to `onAnimationEnd`) or at the next change of the value, whichever comes first. `isTarget` gets the
 *  new and the previous value, so a counter can target "went up" and a status can target "became failed". It is React's
 *  "adjust state while rendering", so the cue is in the same commit as the change that caused it. The cue only says when;
 *  how it looks (and that Subtle and Off drop the movement) is the consumer's CSS, on the motion tokens. */
export function useOneShotOnChange<T>(
  value: T,
  isTarget: (next: T, previous: T) => boolean,
): { active: boolean; done: () => void } {
  const [previous, setPrevious] = useState(value);
  const [active, setActive] = useState(false);
  if (!Object.is(value, previous)) {
    setPrevious(value);
    setActive(isTarget(value, previous));
  }
  const done = useCallback(() => setActive(false), []);
  return { active, done };
}
