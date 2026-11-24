// HEL-1829: the one serialiser for every writer of `PATCH /api/users/me/preferences`. The server merges per top-level
// key, but nothing ordered the client's requests, so whichever arrived last won (Mono then Serif could store Mono).
// At most one request is in flight; everything queued meanwhile is merged (latest value per key, an explicit `null`
// kept) into ONE trailing request, sent as soon as the in-flight one settles. A failed request is never retried.

import { API_BASE_URL } from "../../../config/env";
import { CSRF_HEADER, CSRF_HEADER_VALUE } from "../../../services/csrfHeader";
import { registerSessionReset } from "../../../shared/session/sessionReset";
import type { PreferencesPatch } from "../types/user";
import { patchShellPreferencesRequest } from "./authService";

/** Every key a writer may send: the typed keys plus the whole `dashboardTabs` value (replaced, never merged). */
export type QueuedPreferencesPatch = PreferencesPatch & { dashboardTabs?: unknown };

export interface PreferencesSaveOutcome {
  status: "saved" | "failed" | "dropped";
  /** The exact body of the request that carried the caller's patch; `null` when dropped (sign-out). */
  sent: QueuedPreferencesPatch | null;
}

type Resolver = (outcome: PreferencesSaveOutcome) => void;

/** Bumped by the session reset; a request carries the generation it was sent in. */
let generation = 0;
let inFlight = false;
let pendingPatch: QueuedPreferencesPatch | null = null;
let pendingResolvers: Resolver[] = [];
let pendingKeepalive = false;

/** The page-hide flush uses `fetch` so the request outlives the page; `fetch` resolves on 4xx/5xx, so a non-ok
 *  response is a failure, exactly like an axios rejection. */
async function transmit(patch: QueuedPreferencesPatch, keepalive: boolean): Promise<boolean> {
  try {
    if (keepalive) {
      const response = await fetch(`${API_BASE_URL}/api/users/me/preferences`, {
        method: "PATCH",
        keepalive: true,
        credentials: "include",
        headers: { "Content-Type": "application/json", [CSRF_HEADER]: CSRF_HEADER_VALUE },
        body: JSON.stringify(patch),
      });
      return response.ok;
    }
    await patchShellPreferencesRequest(patch);
    return true;
  } catch {
    return false;
  }
}

function send(patch: QueuedPreferencesPatch, resolvers: Resolver[], keepalive: boolean): void {
  const sentIn = generation;
  inFlight = true;
  void transmit(patch, keepalive).then((ok) => {
    const outcome: PreferencesSaveOutcome = { status: ok ? "saved" : "failed", sent: patch };
    for (const resolve of resolvers) resolve(outcome);
    // A request from before a sign-out resolves its own callers and nothing else: it neither drains nor touches the
    // current session's in-flight marker.
    if (sentIn !== generation) return;
    inFlight = false;
    drain();
  });
}

function drain(): void {
  if (pendingPatch === null) return;
  const patch = pendingPatch;
  const resolvers = pendingResolvers;
  const keepalive = pendingKeepalive;
  pendingPatch = null;
  pendingResolvers = [];
  pendingKeepalive = false;
  send(patch, resolvers, keepalive);
}

/** Saves `patch`. Resolves, in queue order, with the outcome of the request that carried it (a superseded key rides
 *  the trailing request and resolves with that one's outcome). Never rejects. `keepalive` marks the request that
 *  carries this patch as one that may outlive the page. */
export function queuePreferencesPatch(
  patch: QueuedPreferencesPatch,
  options: { keepalive?: boolean } = {},
): Promise<PreferencesSaveOutcome> {
  const keepalive = options.keepalive === true;
  return new Promise((resolve) => {
    if (!inFlight) {
      send({ ...patch }, [resolve], keepalive);
      return;
    }
    pendingPatch = { ...pendingPatch, ...patch };
    pendingResolvers.push(resolve);
    if (keepalive) pendingKeepalive = true;
  });
}

// HEL-1634: a patch still queued when the session ends must never be sent for the next user.
registerSessionReset("preferencesSaveQueue", {
  covers: [
    "features/auth/services/preferencesSaveQueue.ts#generation",
    "features/auth/services/preferencesSaveQueue.ts#inFlight",
    "features/auth/services/preferencesSaveQueue.ts#pendingPatch",
    "features/auth/services/preferencesSaveQueue.ts#pendingResolvers",
    "features/auth/services/preferencesSaveQueue.ts#pendingKeepalive",
  ],
  reset: () => {
    const dropped = pendingResolvers;
    pendingPatch = null;
    pendingResolvers = [];
    pendingKeepalive = false;
    inFlight = false;
    generation += 1;
    for (const resolve of dropped) resolve({ status: "dropped", sent: null });
  },
});
