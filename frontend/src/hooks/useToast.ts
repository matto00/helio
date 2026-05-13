import { useCallback } from "react";

import { pushToast, type ToastInput } from "../features/toasts/toastsSlice";
import { useAppDispatch } from "./reduxHooks";

/** Returns a `push` helper that dispatches a toast without requiring the
 * call site to import or touch Redux dispatch directly. */
export function useToast() {
  const dispatch = useAppDispatch();

  const push = useCallback(
    (input: ToastInput) => {
      dispatch(pushToast(input));
    },
    [dispatch],
  );

  return { push };
}
