import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Skeleton } from "../../../shared/ui/Skeleton";
import { runToUpdate } from "../../pipelines/services/runToUpdate";
import type { HomeAttentionItem } from "../types/homeSummary";
import { firstLine } from "../utils/timelineMarks";
import { formatClock } from "../utils/timelineScale";
import type { SummaryLoadState } from "./summaryLoadState";

interface NeedsAttentionProps {
  items: HomeAttentionItem[];
  now: number;
  /** `loading` shows skeleton rows and `failed` a retry; only `ready` may say "nothing needs attention". */
  load: SummaryLoadState;
  /** Refetches the summary once (after a Retry or Run now). */
  onRefetch: () => void;
  /** Retries a failed first load. */
  onRetryLoad: () => void;
}

function itemKey(item: HomeAttentionItem): string {
  return `${item.kind}:${item.pipelineId}:${item.runId ?? item.at}`;
}

/** Unresolved failures first (newest first), then resolved ones; the server already orders by time. */
export function sortAttention(items: readonly HomeAttentionItem[]): HomeAttentionItem[] {
  const unresolved = (item: HomeAttentionItem) =>
    item.kind === "failed" && item.resolvedAt !== null ? 1 : 0;
  return [...items].sort((a, b) => unresolved(a) - unresolved(b));
}

function reasonText(item: HomeAttentionItem, now: number): string {
  if (item.kind === "failed") {
    return firstLine(item.reason) ?? "The run failed without an error message.";
  }
  if (item.kind === "stuck") {
    const minutes = Math.max(1, Math.round((now - Date.parse(item.at)) / 60_000));
    return `Has been running for ${minutes} minutes and may be stuck.`;
  }
  return `The scheduled run at ${formatClock(Date.parse(item.at))} did not start.`;
}

/** Failed, stuck or missed runs with the reason, Open, and (unresolved failed / missed only) Retry or Run now through
 *  the existing guarded `POST /api/pipelines/:id/run`. A pipeline with a run in flight shows "Running now" instead,
 *  so Home never starts a second concurrent run; a stuck item offers Open only. */
export function NeedsAttention({ items, load, now, onRefetch, onRetryLoad }: NeedsAttentionProps) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [messages, setMessages] = useState<Readonly<Record<string, string>>>({});
  const ordered = sortAttention(items);
  const hot = ordered.some((item) => !(item.kind === "failed" && item.resolvedAt !== null));

  async function submit(item: HomeAttentionItem) {
    const key = itemKey(item);
    setPending((current) => new Set(current).add(key));
    setMessages(({ [key]: _dropped, ...rest }) => rest);
    const result = await runToUpdate(item.pipelineId);
    setPending((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    if (result.rejected === true) {
      const wait =
        result.retryAfterSeconds !== undefined
          ? ` Try again in ${result.retryAfterSeconds} seconds.`
          : " Try again shortly.";
      setMessages((current) => ({
        ...current,
        [key]: `The run was not started: too many runs right now.${wait}`,
      }));
      return;
    }
    if (!result.ok) setMessages((current) => ({ ...current, [key]: result.message }));
    onRefetch();
  }

  return (
    <section
      className={`home-card-panel home-attention${hot ? " home-attention--hot" : ""}`}
      aria-labelledby="home-attention-heading"
    >
      <h2 id="home-attention-heading" className="eyebrow home-section__title">
        Needs attention
      </h2>
      {load === "loading" ? (
        <div role="status" aria-label="Loading needs attention" className="home-skeleton-rows">
          <Skeleton variant="line" width="70%" />
          <Skeleton variant="line" />
          <Skeleton variant="line" width="40%" />
        </div>
      ) : load === "failed" ? (
        <div className="home-note" role="alert">
          <p>Not available right now.</p>
          <button type="button" className="home-btn home-btn--secondary" onClick={onRetryLoad}>
            Try again
          </button>
        </div>
      ) : ordered.length === 0 ? (
        <p className="home-attention__clear">
          <CircleCheck size={16} aria-hidden="true" /> Nothing needs attention.
        </p>
      ) : (
        <ul className="home-attention__list">
          {ordered.map((item) => {
            const key = itemKey(item);
            const resolved = item.kind === "failed" && item.resolvedAt !== null;
            const canRun = !resolved && (item.kind === "failed" || item.kind === "missed");
            const busy = pending.has(key);
            return (
              <li key={key} className="home-attention__item">
                <p className="home-attention__name mono">{item.pipelineName}</p>
                <p className="home-attention__reason">
                  {reasonText(item, now)}{" "}
                  <span className="mono">· {formatClock(Date.parse(item.at))}</span>
                  {resolved ? (
                    <span className="home-attention__resolved"> · Resolved by a later run</span>
                  ) : null}
                </p>
                <div className="home-attention__actions">
                  <Link
                    to={`/pipelines/${item.pipelineId}`}
                    className="home-btn home-btn--secondary"
                  >
                    Open
                  </Link>
                  {canRun && item.inFlight ? (
                    <span className="home-attention__running" role="status">
                      Running now
                    </span>
                  ) : canRun ? (
                    <button
                      type="button"
                      className="home-btn home-btn--ghost"
                      disabled={busy}
                      onClick={() => void submit(item)}
                    >
                      {busy ? "Running…" : item.kind === "missed" ? "Run now" : "Retry"}
                    </button>
                  ) : null}
                </div>
                {busy ? (
                  <p className="home-attention__note" role="status">
                    A run is in progress. This can take a while, and the list updates when it
                    finishes.
                  </p>
                ) : null}
                {messages[key] !== undefined ? (
                  <p className="home-attention__note home-attention__note--error" role="alert">
                    {messages[key]}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
