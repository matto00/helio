import { API_BASE_URL } from "../../config/env";
import { markFirstDashboardDelivered } from "./firstDashboardFlag";

/** The one typed client event union; mirrors the server's allow-list (`ProductEventRegistry`).
 *  `signup_completed` is deliberately absent: only the server emits it. */
export type TelemetryEvent =
  | { event: "first_dashboard_rendered"; props: { panelCount: number } }
  | { event: "provenance_opened"; props: Record<string, never> }
  | { event: "firstrun_file_dropped"; props: { source: "drop" | "paste" } }
  | { event: "firstrun_dashboard_created"; props: { panelCount: number } }
  | { event: "firstrun_template_chosen"; props: { template: string } };

interface QueuedEvent {
  /** The signed-in user when queued; the server attributes a batch to the SESSION user, so an
   *  event is only ever sent while that same user is still signed in. */
  userId: string;
  event: TelemetryEvent["event"];
  properties: Record<string, unknown>;
  occurredAt: string;
}

const STORAGE_KEY = "helio.telemetry.queue.v1";
const MAX_QUEUE = 200;
const MAX_BATCH = 25;
const FLUSH_DELAY_MS = 2000;

let queue: QueuedEvent[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let warned = false;
let listenersInstalled = false;
let currentUserId: () => string | null = () => null;

/** Wired once at startup so the queue can tell which user an event belongs to without importing
 *  the Redux store (which would be a cycle). */
export function setTelemetryIdentity(getUserId: () => string | null): void {
  currentUserId = getUserId;
}

function warnOnce(reason: unknown): void {
  if (warned) return;
  warned = true;
  console.warn("[telemetry] event delivery failed; events are best-effort", reason);
}

function loadQueue(): QueuedEvent[] {
  if (queue) return queue;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    queue = Array.isArray(parsed) ? (parsed as QueuedEvent[]).slice(-MAX_QUEUE) : [];
  } catch {
    queue = [];
  }
  return queue;
}

function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue ?? []));
  } catch {
    // Storage full or unavailable: the in-memory queue still works for this page's lifetime.
  }
}

async function send(batch: QueuedEvent[]): Promise<"sent" | "drop" | "retry"> {
  const response = await fetch(`${API_BASE_URL}/api/events`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json", "X-Helio-Requested-With": "1" },
    body: JSON.stringify({ events: batch }),
  });
  if (response.ok) return "sent";
  // 429 and 5xx are transient; any other 4xx (400 invalid, 401 logged out) will never succeed.
  return response.status === 429 || response.status >= 500 ? "retry" : "drop";
}

async function flush(): Promise<void> {
  if (flushing) return;
  const userId = currentUserId();
  const pending = loadQueue();
  if (!userId) return;
  // Events queued by a different user (shared browser) must never be attributed to this session.
  const foreign = pending.filter((e) => e.userId !== userId).length;
  if (foreign > 0) {
    queue = pending.filter((e) => e.userId === userId);
    persist();
  }
  if (queue?.length === 0 || !queue) return;
  const mine = queue;
  flushing = true;
  try {
    while (mine.length > 0) {
      const batch = mine.slice(0, MAX_BATCH);
      const outcome = await send(batch);
      if (outcome === "retry") {
        warnOnce("server asked to retry");
        scheduleFlush(FLUSH_DELAY_MS * 5);
        return;
      }
      mine.splice(0, batch.length);
      persist();
      if (outcome === "sent") {
        batch
          .filter((e) => e.event === "first_dashboard_rendered")
          .forEach((e) => markFirstDashboardDelivered(e.userId));
      }
    }
  } catch (error) {
    // Offline / network error: keep the queue, retry on the next `online` event or timer.
    warnOnce(error);
  } finally {
    flushing = false;
  }
}

function scheduleFlush(delay = FLUSH_DELAY_MS): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delay);
}

function installListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("online", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}

/** Fire-and-forget product telemetry. Never throws, never returns a promise, never blocks
 *  rendering: the event is queued synchronously and delivered later in a batch. Failures are
 *  swallowed and logged once; an unreachable network keeps the events queued for retry. */
export function track<N extends TelemetryEvent["event"]>(
  event: N,
  props: Extract<TelemetryEvent, { event: N }>["props"],
): void {
  try {
    installListeners();
    const userId = currentUserId();
    if (!userId) return;
    const pending = loadQueue();
    pending.push({ userId, event, properties: props, occurredAt: new Date().toISOString() });
    if (pending.length > MAX_QUEUE) pending.splice(0, pending.length - MAX_QUEUE);
    persist();
    scheduleFlush();
  } catch (error) {
    warnOnce(error);
  }
}

/** Test-only: resets module state between tests. */
export function resetTelemetryForTests(): void {
  queue = null;
  flushing = false;
  warned = false;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
