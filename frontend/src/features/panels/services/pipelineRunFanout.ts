// HEL-1094 (design.md D1-D3, D6) — a module-scoped, ref-counted fan-out manager for the
// pipeline run-status SSE channel (`GET /api/pipelines/:id/run-events`).
//
// The backend `PipelineRunRegistry` holds exactly ONE subscriber per `pipelineId` (a second
// concurrent `subscribe` silently overwrites the first) — so this manager consolidates every
// panel on a dashboard bound to the same pipeline down to a single connection and fans a
// `succeeded` event out to all of them, rather than letting each panel open its own connection
// and starve the others.

type SucceededListener = () => void;

interface FanoutEntry {
  listeners: Set<SucceededListener>;
  controller: AbortController | null;
  retryTimeoutId: ReturnType<typeof setTimeout> | null;
  attempt: number;
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "dry_run"]);

const entries = new Map<string, FanoutEntry>();

/** Bounded exponential backoff for a non-terminal connection failure (design.md D6):
 *  1s, 2s, 4s, ... capped at 30s. `attempt` resets to 0 on the next successful connection. */
export function computeRetryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}

/**
 * Registers `onSucceeded` to be called every time the given `pipelineId`'s run-status stream
 * reports `succeeded`. The first subscriber for a `pipelineId` opens the single shared SSE
 * connection; the connection is closed when the last subscriber for that `pipelineId`
 * unsubscribes. Returns the unsubscribe function.
 */
export function subscribeToPipelineSucceeded(
  pipelineId: string,
  onSucceeded: SucceededListener,
): () => void {
  let entry = entries.get(pipelineId);
  if (!entry) {
    entry = { listeners: new Set(), controller: null, retryTimeoutId: null, attempt: 0 };
    entries.set(pipelineId, entry);
    void connect(pipelineId, entry);
  }
  entry.listeners.add(onSucceeded);

  const subscribedEntry = entry;
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    subscribedEntry.listeners.delete(onSucceeded);
    if (subscribedEntry.listeners.size === 0 && entries.get(pipelineId) === subscribedEntry) {
      closeEntry(pipelineId, subscribedEntry);
    }
  };
}

function closeEntry(pipelineId: string, entry: FanoutEntry): void {
  entries.delete(pipelineId);
  if (entry.retryTimeoutId !== null) {
    clearTimeout(entry.retryTimeoutId);
    entry.retryTimeoutId = null;
  }
  entry.controller?.abort();
}

function scheduleRetry(pipelineId: string, entry: FanoutEntry): void {
  // Only retry while at least one panel is still watching (design.md D6) — an entry with no
  // listeners has already been (or is being) closed via closeEntry, which aborts in flight.
  if (entry.listeners.size === 0 || entries.get(pipelineId) !== entry) return;
  const delay = computeRetryDelayMs(entry.attempt);
  entry.attempt += 1;
  entry.retryTimeoutId = setTimeout(() => {
    entry.retryTimeoutId = null;
    void connect(pipelineId, entry);
  }, delay);
}

async function connect(pipelineId: string, entry: FanoutEntry): Promise<void> {
  const controller = new AbortController();
  entry.controller = controller;

  let response: Response;
  try {
    response = await fetch(`/api/pipelines/${pipelineId}/run-events`, {
      credentials: "include",
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    scheduleRetry(pipelineId, entry);
    return;
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  if (!response.ok || !contentType.includes("text/event-stream")) {
    scheduleRetry(pipelineId, entry);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    scheduleRetry(pipelineId, entry);
    return;
  }

  // A validated SSE response is a successful connection — reset the backoff counter
  // (design.md D6) even though the run itself hasn't reached a terminal status yet.
  entry.attempt = 0;

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let terminalReceived = false;

  try {
    readLoop: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          const data = line.slice("data:".length).trim();
          if (currentEvent === "run-status") {
            try {
              const parsed = JSON.parse(data) as { status?: string };
              if (parsed.status && TERMINAL_STATUSES.has(parsed.status)) {
                terminalReceived = true;
                if (parsed.status === "succeeded") {
                  for (const listener of entry.listeners) listener();
                }
                reader.cancel();
                break readLoop;
              }
            } catch {
              // Ignore malformed JSON in the data field.
            }
          }
          currentEvent = "";
        } else if (line === "") {
          currentEvent = "";
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    scheduleRetry(pipelineId, entry);
    return;
  }

  if (controller.signal.aborted) return;

  if (terminalReceived) {
    // design.md D3 — reconnect immediately after every terminal status (succeeded, failed, or
    // dry_run) so a later write is still caught, as long as a listener remains subscribed.
    if (entry.listeners.size > 0) {
      void connect(pipelineId, entry);
    }
  } else {
    // The stream ended without ever reporting a terminal status — a connection failure per
    // design.md D6, not a normal reconnect.
    scheduleRetry(pipelineId, entry);
  }
}
