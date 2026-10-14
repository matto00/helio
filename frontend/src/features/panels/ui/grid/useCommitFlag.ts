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
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCommitFlag = useCallback(() => {
    commitOnNextLayoutChangeRef.current = false;
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
  return { commitOnNextLayoutChangeRef, clearCommitFlag, armCommitFlag };
}
