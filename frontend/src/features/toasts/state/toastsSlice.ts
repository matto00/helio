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
  /** Auto-dismiss delay in ms. Defaults to 4000. Set to 0 to never auto-dismiss. */
  duration?: number;
  action?: ToastAction;
}

/** The payload accepted by pushToast — id is generated automatically. */
export type ToastInput = Omit<Toast, "id">;

interface ToastsState {
  items: Toast[];
}

const initialState: ToastsState = {
  items: [],
};

let nextId = 1;

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
        state.items.push(action.payload);
      },
      prepare(input: ToastInput) {
        const id = String(nextId++);
        return { payload: { id, ...input } };
      },
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.items = state.items.filter((t) => t.id !== action.payload);
    },
  },
});

export const { pushToast, dismissToast } = toastsSlice.actions;
export const toastsReducer = toastsSlice.reducer;
