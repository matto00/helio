import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * An identity-stable function that always calls the latest closure passed in. Lets a memoised child take a callback prop
 * that closes over fresh state without that prop changing identity on every render.
 *
 * The latest closure is assigned in a layout effect, so the returned function must never be called during render: it
 * would run the previous render's closure.
 */
export function useLatestCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
