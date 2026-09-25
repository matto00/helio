// HEL-1094 (design.md D1-D3, D6) — a module-scoped, ref-counted fan-out manager for the
// pipeline run-status SSE channel (`GET /api/pipelines/:id/run-events`).
//
// The backend `PipelineRunRegistry` holds exactly ONE subscriber per `pipelineId` (a second
// concurrent `subscribe` silently overwrites the first) — so this manager consolidates every
// panel on a dashboard bound to the same pipeline down to a single connection and fans a
// `succeeded` event out to all of them, rather than letting each panel open its own connection
// and starve the others.
//
// HEL-1174 (design.md Decisions 2-3): `run-events` is ephemeral with no replay — a run that
// reaches a terminal status while no subscriber is registered (structurally, the gap between the
// old stream's terminal-triggered close and the new stream's `connect()` registering, which D3
// below creates on every terminal event) is otherwise lost forever. Every `connect()` call
// (initial subscribe, D3's post-terminal reconnect, and a post-backoff retry alike) therefore
// first reconciles against `GET /api/pipelines/:id/runs/latest` — the durable `pipeline_runs`
// record — before opening the live SSE stream, so a missed terminal outcome is still observed on
// the very next (re)connect.

type SucceededListener = () => void;

interface FanoutEntry {
  listeners: Set<SucceededListener>;
  controller: AbortController | null;
  retryTimeoutId: ReturnType<typeof setTimeout> | null;
  attempt: number;
  // HEL-1174 (design.md Decision 3): the most recent run id this entry has already notified its
  // listeners about (via EITHER the live SSE path or the reconcile-on-connect path below) —
  // `undefined` until the first run is observed by either path. Guards against double-firing for
  // the same run id and lets a later `failed`/`dry_run` run correctly stop being treated as "new".
  lastObservedRunId: string | undefined;
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
    entry = {
      listeners: new Set(),
      controller: null,
      retryTimeoutId: null,
      attempt: 0,
      lastObservedRunId: undefined,
    };
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

interface LatestRunSummary {
  id?: string;
  status?: string;
}

/** HEL-1174 (design.md Decisions 2-3): reconciles `entry.lastObservedRunId` against the
 *  pipeline's durable latest-run record before the live SSE stream (re)opens. Best-effort —
 *  swallows every failure mode (network error, non-2xx, malformed body) as a silent no-op, since
 *  this is a supplementary fallback, never the authoritative channel: the live SSE fetch that
 *  follows still covers everything from this point on regardless of whether reconcile succeeded. */
async function reconcile(
  pipelineId: string,
  entry: FanoutEntry,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/pipelines/${pipelineId}/runs/latest`, {
      credentials: "include",
      signal,
    });
  } catch {
    return;
  }
  // 404 means "no runs yet" (or the pipeline is inaccessible) — nothing to reconcile against.
  if (!response.ok) return;

  let data: LatestRunSummary;
  try {
    data = (await response.json()) as LatestRunSummary;
  } catch {
    return;
  }
  if (!data.id || data.id === entry.lastObservedRunId) return;

  // HEL-1174 (skeptic-final-1.md, Change Request 1): a NON-TERMINAL ("queued"/"running") row
  // must be a complete no-op -- nothing has actually completed yet, so there is nothing to adopt
  // as an "observed" baseline. Adopting it anyway (the pre-fix behavior) opened a NEW dedup hole
  // of the exact same class this ticket exists to close: an ordinary page load/panel mount that
  // happens to race an in-flight run (a window that exists on every run's queued+running
  // duration, not just the reconnect race) would silently establish that run's id as "already
  // observed" before it ever completed. When that same run's terminal `succeeded` event then
  // arrived on the live SSE path moments later carrying the SAME `runId`, the live path's own
  // dedup check (below) would already see it as observed and never fire -- the panel would
  // silently never learn the run it should have caught succeeded. Returning here before touching
  // `lastObservedRunId` leaves the live SSE stream (already open by the time this matters) as the
  // sole, correct observer of that run's eventual outcome.
  if (!data.status || !TERMINAL_STATUSES.has(data.status)) return;

  // HEL-1174 (probe-confirmed against the real e2e, not merely design.md's literal wording — see
  // files-modified.md): a subscriber's VERY FIRST connect ever (lastObservedRunId still
  // `undefined`) must establish the baseline WITHOUT firing, even when the pipeline already has a
  // succeeded run. The panel's own initial data fetch (e.g. GET /api/outputs/:id/rows) already
  // reflects whatever the pipeline's current state is at mount time -- firing here too would be a
  // redundant, surprising "just connected" notification for data the UI already shows, and it
  // measurably broke hel1094-sse-fan-out-panel-refresh.spec.ts's "the status region is empty
  // before any fan-out-triggered refresh" assertion when probed live. This matches the
  // `pipeline-run-sse` spec delta's own scenario precondition ("a subscriber's connection has
  // closed AFTER A PRIOR run's terminal event") -- reconcile's notify path is for a RECONNECT
  // that already has a baseline, not a subscriber's first-ever mount.
  const isFirstObservation = entry.lastObservedRunId === undefined;
  if (data.status === "succeeded" && !isFirstObservation) {
    // Same "notify" path the live SSE succeeded-event handler below uses — a reconciled outcome
    // and a live one are indistinguishable to a listener.
    for (const listener of entry.listeners) listener();
  }
  // Set regardless of status (succeeded, failed, or dry_run) — a later failed/dry_run run must
  // also stop being treated as "new" on the next reconcile call (design.md Decision 3).
  entry.lastObservedRunId = data.id;
}

async function connect(pipelineId: string, entry: FanoutEntry): Promise<void> {
  const controller = new AbortController();
  entry.controller = controller;

  await reconcile(pipelineId, entry, controller.signal);
  // The entry may have been closed (last listener unsubscribed) while reconcile was in flight.
  if (controller.signal.aborted) return;

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
              const parsed = JSON.parse(data) as { status?: string; runId?: string };
              if (parsed.status && TERMINAL_STATUSES.has(parsed.status)) {
                terminalReceived = true;
                // HEL-1174 (design.md Decision 3): dedup against a run id already observed via
                // reconcile-on-connect (or a prior live event) — an absent `runId` (should not
                // happen once the backend carries it, but kept defensive) always fires, matching
                // this manager's pre-HEL-1174 behavior.
                const isNewRun =
                  parsed.runId === undefined || parsed.runId !== entry.lastObservedRunId;
                if (parsed.status === "succeeded" && isNewRun) {
                  for (const listener of entry.listeners) listener();
                }
                if (parsed.runId !== undefined) entry.lastObservedRunId = parsed.runId;
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
