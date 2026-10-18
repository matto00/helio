import type { DraftPreviewLine, DraftPreviewRequest } from "../types/draftPreview";
import { findExceededCap } from "./draftPreviewCaps";
import { DraftPreviewError, postDraftPreview, readDraftPreviewStream } from "./draftPreviewClient";

// HEL-1630 design.md D8: paces draft-preview requests under the endpoint's own budget (120 per minute per principal) and keeps
// at most one in flight. A drag edits the draft every frame; unpaced that is hundreds of requests a minute, and a trailing
// debounce alone would starve forever during a continuous drag (the timer never fires) or fire every ~360 ms on short bursts
// (more than 120 a minute). So a send fires at the EARLIER of
//   - `debounceMs` after the last change, and
//   - `maxWaitMs` after the first change not yet sent,
// but never sooner than `floorMs` after the previous send. A continuous drag therefore sends at the floor cadence (about 98 a
// minute) and the final state is always sent.

export interface DraftPreviewSchedulerOptions {
  pipelineId: string;
  /** Every line of the CURRENT request, as it arrives. A superseded request's lines are dropped. */
  onLine: (line: DraftPreviewLine) => void;
  /** The current request's stream ended cleanly. */
  onSettled?: () => void;
  /** The current request failed (non-200 other than 429, an invalid line, a network error). */
  onError?: (error: Error) => void;
  /** The request breaks a server cap (named) and was not sent; it costs no request and no budget. */
  onTooLarge?: (cap: string) => void;
  /** The server answered 429; nothing is sent for `retryAfterMs`, then the latest state is. */
  onRateLimited?: (retryAfterMs: number) => void;
  debounceMs?: number;
  maxWaitMs?: number;
  floorMs?: number;
  /** Test seam; defaults to the real fetch. */
  send?: typeof postDraftPreview;
  /** Test seam; defaults to `Date.now`. */
  now?: () => number;
}

export interface DraftPreviewScheduler {
  /** Records the latest draft state; it is sent when the pacing rules allow. */
  update: (request: DraftPreviewRequest) => void;
  /** Cancels the timer and any in-flight request; the scheduler is inert afterwards. */
  dispose: () => void;
}

const DEFAULT_RETRY_AFTER_MS = 1000;

const isAbort = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";

export function createDraftPreviewScheduler(
  options: DraftPreviewSchedulerOptions,
): DraftPreviewScheduler {
  const debounceMs = options.debounceMs ?? 350;
  const maxWaitMs = options.maxWaitMs ?? 600;
  const floorMs = options.floorMs ?? 600;
  const send = options.send ?? postDraftPreview;
  const clock = options.now ?? Date.now;

  let pending: DraftPreviewRequest | undefined;
  let firstUnsentAt = 0;
  let lastChangeAt = 0;
  let lastSendAt: number | undefined;
  let holdUntil = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;
  let disposed = false;

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (pending === undefined || disposed) return;
    let fireAt = Math.min(lastChangeAt + debounceMs, firstUnsentAt + maxWaitMs);
    if (lastSendAt !== undefined) fireAt = Math.max(fireAt, lastSendAt + floorMs);
    fireAt = Math.max(fireAt, holdUntil);
    timer = setTimeout(fire, Math.max(0, fireAt - clock()));
  }

  function rateLimited(request: DraftPreviewRequest, retryAfterSeconds: number | undefined): void {
    const waitMs =
      retryAfterSeconds === undefined ? DEFAULT_RETRY_AFTER_MS : retryAfterSeconds * 1000;
    holdUntil = clock() + waitMs;
    if (pending === undefined) {
      // Nothing newer arrived meanwhile: the rejected state is still the latest one.
      pending = request;
      firstUnsentAt = lastChangeAt = clock();
    }
    options.onRateLimited?.(waitMs);
    schedule();
  }

  function run(request: DraftPreviewRequest): void {
    inFlight?.abort();
    const mine = new AbortController();
    inFlight = mine;
    void (async () => {
      try {
        const response = await send(options.pipelineId, request, mine.signal);
        if (mine !== inFlight) return;
        await readDraftPreviewStream(response, (line) => {
          if (mine === inFlight) options.onLine(line);
        });
        if (mine === inFlight) options.onSettled?.();
      } catch (err) {
        if (mine !== inFlight || isAbort(err)) return;
        if (err instanceof DraftPreviewError && err.status === 429) {
          rateLimited(request, err.retryAfterSeconds);
          return;
        }
        options.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  }

  function fire(): void {
    timer = undefined;
    const request = pending;
    pending = undefined;
    if (request === undefined || disposed) return;
    const cap = findExceededCap(request);
    if (cap !== undefined) {
      inFlight?.abort();
      inFlight = undefined;
      options.onTooLarge?.(cap);
      return;
    }
    lastSendAt = clock();
    run(request);
  }

  return {
    update(request) {
      if (disposed) return;
      const now = clock();
      if (pending === undefined) firstUnsentAt = now;
      pending = request;
      lastChangeAt = now;
      schedule();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      inFlight?.abort();
      inFlight = undefined;
      pending = undefined;
    },
  };
}
