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
    pushToast(state, action: PayloadAction<ToastInput>) {
      const id = String(nextId++);
      state.items.push({ id, ...action.payload });
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.items = state.items.filter((t) => t.id !== action.payload);
    },
  },
});

export const { pushToast, dismissToast } = toastsSlice.actions;
export const toastsReducer = toastsSlice.reducer;
