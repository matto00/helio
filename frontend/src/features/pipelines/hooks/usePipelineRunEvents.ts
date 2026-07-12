import { useEffect, useRef, useState } from "react";

// -- Types ---------------------------------------------------------------

export type SseRunStatus = "queued" | "running" | "succeeded" | "failed" | "dry_run";

export interface RunStatusEventData {
  status: SseRunStatus;
  rowCount?: number;
  errorLog?: string;
}

export interface RunEventsState {
  status: SseRunStatus | null;
  rowCount: number | null;
  errorLog: string | null;
  /** Set when the SSE connection cannot be established or drops mid-run. */
  connectionError: string | null;
}

export interface UsePipelineRunEventsOptions {
  pipelineId: string | undefined;
  active: boolean;
  onTerminal?: (event: RunStatusEventData) => void;
}

const TERMINAL_STATUSES = new Set<SseRunStatus>(["succeeded", "failed", "dry_run"]);

// -- Hook -----------------------------------------------------------------

/**
 * Opens an authenticated SSE connection to GET /api/pipelines/:id/run-events
 * while active is true. Uses fetch + ReadableStream (rather than EventSource,
 * which can't send `credentials: "include"`) so the `helio_session` cookie
 * (HEL-287 CodeQL #8) attaches automatically.
 *
 * - Connection is opened when active is true and pipelineId is defined.
 * - Auto-closes when a terminal status (succeeded, failed, dry_run) is received.
 * - Closes (via AbortController) when active flips to false.
 * - onTerminal is called with the terminal event data before closing.
 * - connectionError is set if the fetch fails, returns a non-SSE response, or
 *   the stream drops unexpectedly.
 */
export function usePipelineRunEvents({
  pipelineId,
  active,
  onTerminal,
}: UsePipelineRunEventsOptions): RunEventsState {
  const [state, setState] = useState<RunEventsState>({
    status: null,
    rowCount: null,
    errorLog: null,
    connectionError: null,
  });

  // Stable ref so the event handler always sees the latest onTerminal callback
  // without needing to recreate the fetch connection.
  const onTerminalRef = useRef(onTerminal);
  useEffect(() => {
    onTerminalRef.current = onTerminal;
  });

  useEffect(() => {
    if (!active || !pipelineId) {
      return;
    }

    const controller = new AbortController();
    let unmounted = false;

    async function connect() {
      const url = `/api/pipelines/${pipelineId}/run-events`;

      let response: Response;
      try {
        response = await fetch(url, {
          credentials: "include",
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
              if (currentEvent === "run-status") {
                try {
                  const parsed = JSON.parse(data) as RunStatusEventData;
                  if (!unmounted) {
                    setState({
                      status: parsed.status,
                      rowCount: parsed.rowCount ?? null,
                      errorLog: parsed.errorLog ?? null,
                      connectionError: null,
                    });
                  }

                  if (TERMINAL_STATUSES.has(parsed.status)) {
                    onTerminalRef.current?.(parsed);
                    reader.cancel();
                    return;
                  }
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
  }, [active, pipelineId]);

  return state;
}
