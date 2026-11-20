import type { Middleware } from "@reduxjs/toolkit";

import { clearAuth } from "../../features/auth/state/authSlice";
import { bumpSessionEpoch, getSessionEpoch } from "./sessionEpoch";

/**
 * Lifecycle thunks that must always land, whatever the epoch: they ARE the session lifecycle.
 * Matched by exact type prefix. Every other `auth/*` thunk (preferences, shell, appearance) is gated.
 */
export const EPOCH_EXEMPT_THUNKS: readonly string[] = [
  "auth/rehydrateAuth",
  "auth/login",
  "auth/register",
  "auth/handleOAuthCallback",
  "auth/verifyMfa",
  "auth/logout",
];

function isExempt(type: string): boolean {
  return EPOCH_EXEMPT_THUNKS.some((prefix) => type.startsWith(`${prefix}/`));
}

interface ThunkLifecycleAction {
  type: string;
  meta?: { requestId?: string; requestStatus?: string };
}

/**
 * HEL-1634 D2a. Bumps the session epoch on `clearAuth`, records the epoch at which each async thunk
 * started, and drops the `fulfilled` / `rejected` action of a thunk whose session has ended (it never
 * reaches the reducers or listeners). `unwrap()` callers are unaffected: RTK returns the settled
 * action to the caller whether or not the reducer saw it.
 */
export function createSessionEpochMiddleware(): Middleware {
  const startEpochs = new Map<string, number>();
  return () => (next) => (action) => {
    if (clearAuth.match(action)) bumpSessionEpoch();
    const { type, meta } = action as ThunkLifecycleAction;
    const requestId = meta?.requestId;
    if (typeof requestId !== "string" || typeof meta?.requestStatus !== "string") {
      return next(action);
    }
    if (meta.requestStatus === "pending") {
      startEpochs.set(requestId, getSessionEpoch());
      return next(action);
    }
    const started = startEpochs.get(requestId);
    startEpochs.delete(requestId);
    if (started !== undefined && started !== getSessionEpoch() && !isExempt(type)) return action;
    return next(action);
  };
}
