import { useEffect, useState } from "react";

import { AUTHORING_DASHBOARD_ENDPOINT } from "../services/authoringService";
import type { AuthoringResult } from "../types/authoring";

// -- Types ---------------------------------------------------------------

export interface UseDashboardAuthoringStreamOptions {
  goal: string;
  active: boolean;
  /** HEL-397 design.md D1 — omitted for a fresh turn 1 (behaves exactly as
   *  before this field existed); set to a prior turn's returned
   *  `AuthoringResult.conversationId` to continue refining the same
   *  proposal. The server owns history/the working proposal entirely — this
   *  hook never re-sends either. */
  conversationId?: string;
}

export interface AuthoringStreamState {
  /** Accumulated `authoring-progress` text deltas for the current attempt.
   *  Not meant to be rendered verbatim mid-stream — it's raw, incomplete
   *  proposal JSON, not conversational prose (design.md Risk note); the chat
   *  surface shows an indeterminate "composing..." activity instead. Exposed
   *  here for completeness / future use. */
  progressText: string;
  /** Most recent `authoring-status` label (e.g. "repairing"), or null. */
  statusLabel: string | null;
  /** Set once a terminal `authoring-result` event lands. */
  result: AuthoringResult | null;
  /** Set once a terminal `authoring-error` event lands. */
  error: string | null;
  /** Set when the SSE connection cannot be established or drops mid-stream. */
  connectionError: string | null;
}

const INITIAL_STATE: AuthoringStreamState = {
  progressText: "",
  statusLabel: null,
  result: null,
  error: null,
  connectionError: null,
};

// -- Hook -----------------------------------------------------------------

/**
 * Opens an authenticated SSE connection to
 * `POST /api/authoring/dashboard?stream=true` while `active` is true,
 * sending `{goal, conversationId}` as the JSON request body (`conversationId`
 * HEL-397 — omitted for a fresh turn, present to continue one). Structurally
 * mirrors `usePipelineRunEvents` (design.md D2) — `fetch` +
 * `credentials: "include"` + `AbortController` + manual SSE line-buffer
 * parsing, never `EventSource` (that hook's own doc comment explains why: no
 * `credentials: "include"` support, so the `helio_session` cookie never
 * attaches) — but POSTs a goal instead of GETing a pipeline id, and
 * dispatches on the real HEL-392 event names instead of `run-status`:
 * `authoring-progress` (accumulate text), `authoring-status` (surface the
 * label), `authoring-result` (terminal success, carries `conversationId`),
 * `authoring-error` (terminal failure).
 *
 * - Connection (re)opens whenever `active`/`goal`/`conversationId` change to
 *   a new attempt; state resets to fresh at the start of every connection.
 * - Closes (via `AbortController`) when `active` flips to false or on unmount.
 * - `connectionError` is set if the fetch fails, returns a non-SSE response,
 *   or the stream drops unexpectedly.
 */
export function useDashboardAuthoringStream({
  goal,
  active,
  conversationId,
}: UseDashboardAuthoringStreamOptions): AuthoringStreamState {
  const [state, setState] = useState<AuthoringStreamState>(INITIAL_STATE);

  useEffect(() => {
    if (!active) {
      return;
    }

    const controller = new AbortController();
    let unmounted = false;

    async function connect() {
      if (!unmounted) setState(INITIAL_STATE);

      let response: Response;
      try {
        response = await fetch(`${AUTHORING_DASHBOARD_ENDPOINT}?stream=true`, {
          method: "POST",
          credentials: "include",
          // CSRF defense (design.md D4 in httpClient.ts's own doc comment):
          // AuthDirectives.requireCsrfHeader rejects every non-GET request
          // carrying the helio_session cookie unless this header is present.
          // httpClient (axios) sets it by default on every mutating call;
          // this hook bypasses httpClient for streaming, so it must be set
          // explicitly here too.
          headers: { "Content-Type": "application/json", "X-Helio-Requested-With": "1" },
          // HEL-397: `conversationId` is `undefined` for a fresh turn 1 — JSON.stringify omits
          // an `undefined` value's key entirely, so this stays byte-identical to the pre-HEL-397
          // body for every caller that never supplies one.
          body: JSON.stringify({ goal, conversationId }),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (!unmounted) {
          setState((prev) => ({ ...prev, connectionError: "Connection failed" }));
        }
        return;
      }

      // Validate Content-Type before reading body as an event stream.
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!response.ok || !contentType.includes("text/event-stream")) {
        if (!unmounted) {
          setState((prev) => ({
            ...prev,
            connectionError: `Unexpected response: ${response.status}`,
          }));
        }
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        if (!unmounted) {
          setState((prev) => ({ ...prev, connectionError: "No response body" }));
        }
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || unmounted) break;

          buffer += decoder.decode(value, { stream: true });
          // SSE lines are delimited by \n; a blank line dispatches the event.
          const lines = buffer.split("\n");
          // Keep the last (potentially incomplete) line in the buffer.
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEvent = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
              const data = line.slice("data:".length).trim();

              if (currentEvent === "authoring-progress") {
                try {
                  const parsed = JSON.parse(data) as { text: string };
                  if (!unmounted) {
                    setState((prev) => ({
                      ...prev,
                      progressText: prev.progressText + parsed.text,
                    }));
                  }
                } catch {
                  // Ignore malformed JSON in data field.
                }
              } else if (currentEvent === "authoring-status") {
                try {
                  const parsed = JSON.parse(data) as { label: string };
                  if (!unmounted) {
                    setState((prev) => ({ ...prev, statusLabel: parsed.label }));
                  }
                } catch {
                  // Ignore malformed JSON in data field.
                }
              } else if (currentEvent === "authoring-result") {
                try {
                  const parsed = JSON.parse(data) as AuthoringResult;
                  if (!unmounted) {
                    setState((prev) => ({ ...prev, result: parsed }));
                  }
                  reader.cancel();
                  return;
                } catch {
                  // Ignore malformed JSON in data field.
                }
              } else if (currentEvent === "authoring-error") {
                try {
                  const parsed = JSON.parse(data) as { message: string };
                  if (!unmounted) {
                    setState((prev) => ({ ...prev, error: parsed.message }));
                  }
                  reader.cancel();
                  return;
                } catch {
                  // Ignore malformed JSON in data field.
                }
              }
              currentEvent = "";
            } else if (line === "") {
              // Blank line -- event boundary; reset current event name.
              currentEvent = "";
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (!unmounted) {
          setState((prev) => ({ ...prev, connectionError: "Connection dropped" }));
        }
      }
    }

    void connect();

    return () => {
      unmounted = true;
      controller.abort();
    };
  }, [active, goal, conversationId]);

  return state;
}
