// HEL-1028 commit flag for `DesktopPanelGrid` (HEL-1418 split; behaviour unchanged).
//
// RGL fires onDragStop/onResizeStop BEFORE the onLayoutChange that carries the final layout, so
// the stop handlers only arm this flag and `handleLayoutChange` performs the store commit. A
// zero-delay timer (and the next interaction start) disarms it when the interaction moved nothing.
//
// Must be called BEFORE `useLayoutSave` in `DesktopPanelGrid`: its unmount cleanup (clearing the
// timer) has to keep running before `useLayoutSave`'s unmount flush, as it did when this lived
// inline (effects clean up in declaration order).

import { useCallback, useEffect, useRef } from "react";

export function useCommitFlag() {
  const commitOnNextLayoutChangeRef = useRef(false);
  // HEL-1618: the id of the panel whose resize just stopped, held for the committing `onLayoutChange` (lift-when-free).
  // It lives and dies with the commit flag: every clear of the flag (committed branch, the next drag/resize start, the
  // zero-delay timer) clears it, so a resize that moved nothing can never leak into a later drag's commit.
  const resizedIdRef = useRef<string | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCommitFlag = useCallback(() => {
    commitOnNextLayoutChangeRef.current = false;
    resizedIdRef.current = null;
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, []);
  const armCommitFlag = useCallback(() => {
    clearCommitFlag();
    commitOnNextLayoutChangeRef.current = true;
    commitTimerRef.current = setTimeout(clearCommitFlag, 0);
  }, [clearCommitFlag]);
  useEffect(() => clearCommitFlag, [clearCommitFlag]);
  return { commitOnNextLayoutChangeRef, resizedIdRef, clearCommitFlag, armCommitFlag };
}
