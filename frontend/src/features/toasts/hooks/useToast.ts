import { useCallback } from "react";

import { pushToast, type ToastInput } from "../state/toastsSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";

/** Returns a `push` helper that dispatches a toast without requiring the
 * call site to import or touch Redux dispatch directly. Returns the pushed
 * toast's id (skeptic-final-1.md CR2) — `pushToast`'s `prepare` callback
 * generates it before dispatch, so it's available synchronously here,
 * letting a caller correlate a later action (e.g. dismissing this exact
 * toast) back to it without a second store read. */
export function useToast() {
  const dispatch = useAppDispatch();

  const push = useCallback(
    (input: ToastInput) => {
      const action = pushToast(input);
      dispatch(action);
      return action.payload.id;
    },
    [dispatch],
  );

  return { push };
}
