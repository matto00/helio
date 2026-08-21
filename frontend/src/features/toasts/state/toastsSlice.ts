import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
  /** Effective auto-dismiss delay in ms; 0 means never auto-dismiss. Always
   *  present on a stored toast (HEL-535 D3) — `pushToast`'s `prepare` fills
   *  in `DEFAULT_DURATION` when the caller didn't specify one. */
  duration: number;
  action?: ToastAction;
}

/** The payload accepted by pushToast — id is generated automatically, and
 *  duration defaults to `DEFAULT_DURATION` if omitted (see `Toast.duration`). */
export type ToastInput = Omit<Toast, "id" | "duration"> & { duration?: number };

interface ToastsState {
  items: Toast[];
}

const initialState: ToastsState = {
  items: [],
};

let nextId = 1;

// HEL-535 D3 — the one auto-dismiss default, owned by the slice (moved from
// `Toast.tsx`) and applied in `pushToast`'s `prepare` so every stored toast
// carries its effective duration; the cap, coalescing, and tests all read
// this one value.
export const DEFAULT_DURATION = 4000;

// HEL-535 D1 — the concurrent-toast cap. Enforced in the reducer (not just
// the rendered view) so toast state itself never exceeds it.
export const MAX_VISIBLE_TOASTS = 3;

/** A toast that never auto-dismisses (`duration === 0`) or that carries an
 *  action the user must be able to reach is exempt from eviction — evicting
 *  it without user action would destroy the affordance (e.g.
 *  `PatchSetReviewPage.tsx`'s sticky Undo toast) and would falsify "a zero
 *  duration toast never auto-dismisses". */
function isEvictionExempt(toast: Toast): boolean {
  return toast.duration === 0 || toast.action !== undefined;
}

const toastsSlice = createSlice({
  name: "toasts",
  initialState,
  reducers: {
    // `prepare` (not a bare reducer) generates the id BEFORE dispatch, in the action creator
    // itself — so a caller can read `pushToast(input).payload.id` synchronously, without a
    // second read of store state, to correlate a LATER action (e.g. dismissing THIS toast) back
    // to the exact toast it just pushed (skeptic-final-1.md CR2: the "Applied." toast's own
    // Undo action needs to dismiss itself, per design.md D6). The reducer itself stays a
    // trivial push.
    pushToast: {
      reducer(state, action: PayloadAction<Toast>) {
        const incoming = action.payload;

        // HEL-535 D1 — coalesce an exact variant+message duplicate: drop the
        // existing entry and re-push fresh, which both restarts its
        // auto-dismiss timer and moves it to the newest position. This also
        // implements the sticky Undo toast's documented "next successful
        // apply's toast replaces it" behaviour.
        state.items = state.items.filter(
          (t) => !(t.variant === incoming.variant && t.message === incoming.message),
        );

        // HEL-535 D1 — cap enforcement: evict the OLDEST auto-dismissing
        // (non-exempt) toast, one at a time, until there's room. If every
        // toast currently in state is exempt, admit the push anyway —
        // correctness over the cap (only one site in the app produces an
        // exempt toast today).
        while (state.items.length >= MAX_VISIBLE_TOASTS) {
          const evictIndex = state.items.findIndex((t) => !isEvictionExempt(t));
          if (evictIndex === -1) break;
          state.items.splice(evictIndex, 1);
        }

        state.items.push(incoming);
      },
      prepare(input: ToastInput) {
        const id = String(nextId++);
        const duration = input.duration ?? DEFAULT_DURATION;
        return { payload: { ...input, id, duration } };
      },
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.items = state.items.filter((t) => t.id !== action.payload);
    },
  },
});

export const { pushToast, dismissToast } = toastsSlice.actions;
export const toastsReducer = toastsSlice.reducer;
