import { useCallback, useEffect } from "react";

import { applyShellPreferences, saveShellPreferences } from "../../features/auth/state/authSlice";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import {
  CONTEXT_LIST_DEFAULT_WIDTH,
  clampContextListWidth,
  requestListFocus,
} from "./contextListLayout";

/** The retired localStorage key (F-018). Migrated once into the server-side preference, then removed. */
const LEGACY_COLLAPSED_KEY = "helio.sidebarCollapsed";

/** Keyboard resizes issue one write per burst of key presses. */
const KEY_WRITE_DEBOUNCE_MS = 400;

export interface ContextListLayout {
  /** Saved width, clamped to 200..400; 248 until the user has set one. */
  width: number;
  collapsed: boolean;
  /** Pointer drag: paint the width without touching state or the network (per animation frame). */
  previewWidth: (width: number) => void;
  /** Pointer drag end: apply and persist once. */
  commitWidth: (width: number) => void;
  /** Keyboard: apply immediately, persist after a short quiet period. */
  nudgeWidth: (width: number) => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
}

/** The element that owns `--context-list-width`; previews write it directly so a drag never re-renders the list. */
function shellElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".app-shell");
}

/** The pending keyboard write. There is one shell, so one timer, shared by every hook instance. */
let keyWriteTimer: ReturnType<typeof setTimeout> | null = null;

function cancelKeyWrite() {
  if (keyWriteTimer !== null) {
    clearTimeout(keyWriteTimer);
    keyWriteTimer = null;
  }
}

/** Shell layout state for the context list (HEL-1574, DESIGN.md §9). The source of truth is the signed-in user's
 *  server-side preferences, already in the auth slice before the shell first renders (every auth response carries
 *  them), so the first paint has the saved width: no default flash and no extra request. Writes are optimistic
 *  (local first); a failed write keeps the local value silently. */
export function useContextListLayout(): ContextListLayout {
  const dispatch = useAppDispatch();
  const preferences = useAppSelector((state) => state.auth.currentUser?.preferences);
  const userId = useAppSelector((state) => state.auth.currentUser?.id ?? null);

  const width = clampContextListWidth(preferences?.contextListWidth ?? CONTEXT_LIST_DEFAULT_WIDTH);
  const collapsed = preferences?.contextListCollapsed ?? false;
  const storedCollapsed = preferences?.contextListCollapsed;

  const previewWidth = useCallback((next: number) => {
    shellElement()?.style.setProperty("--context-list-width", `${clampContextListWidth(next)}px`);
  }, []);

  const commitWidth = useCallback(
    (next: number) => {
      const clamped = clampContextListWidth(next);
      cancelKeyWrite();
      // The inline preview must not outlive the commit: state owns the variable again.
      shellElement()?.style.removeProperty("--context-list-width");
      dispatch(applyShellPreferences({ contextListWidth: clamped }));
      void dispatch(saveShellPreferences({ contextListWidth: clamped }));
    },
    [dispatch],
  );

  const nudgeWidth = useCallback(
    (next: number) => {
      const clamped = clampContextListWidth(next);
      dispatch(applyShellPreferences({ contextListWidth: clamped }));
      cancelKeyWrite();
      keyWriteTimer = setTimeout(() => {
        keyWriteTimer = null;
        void dispatch(saveShellPreferences({ contextListWidth: clamped }));
      }, KEY_WRITE_DEBOUNCE_MS);
    },
    [dispatch],
  );

  const setCollapsed = useCallback(
    (next: boolean) => {
      // Collapsing lands focus on the rail's Expand button, expanding on the list's Collapse button.
      requestListFocus(next ? "expand-button" : "collapse-button");
      dispatch(applyShellPreferences({ contextListCollapsed: next }));
      void dispatch(saveShellPreferences({ contextListCollapsed: next }));
    },
    [dispatch],
  );

  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [setCollapsed, collapsed]);

  // Legacy key: migrated once, on the first authenticated load where the server has no collapsed value, and
  // removed on every load either way.
  useEffect(() => {
    if (userId === null) return;
    try {
      const legacy = window.localStorage.getItem(LEGACY_COLLAPSED_KEY);
      if (legacy === null) return;
      window.localStorage.removeItem(LEGACY_COLLAPSED_KEY);
      if (legacy === "true" && storedCollapsed === undefined) {
        dispatch(applyShellPreferences({ contextListCollapsed: true }));
        void dispatch(saveShellPreferences({ contextListCollapsed: true }));
      }
    } catch {
      // Storage unavailable: there is nothing to migrate.
    }
  }, [userId, storedCollapsed, dispatch]);

  return {
    width,
    collapsed,
    previewWidth,
    commitWidth,
    nudgeWidth,
    setCollapsed,
    toggleCollapsed,
  };
}
