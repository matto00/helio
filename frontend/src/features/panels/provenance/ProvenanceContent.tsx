import type { RefObject } from "react";
import { Link } from "react-router-dom";

import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import { lastRunState, stepKindLabel } from "./provenanceLabels";
import type { PublishedComparison } from "../history/metricComparisonStore";
import type { Provenance } from "./provenanceService";
import type { ProvenanceVariant } from "./provenanceTelemetry";

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function LastRunRow({ lastRun }: { lastRun: Provenance["lastRun"] }) {
  const state = lastRunState(lastRun);
  if (lastRun === null || state === "never") {
    return <p className="provenance-popover__value">Never run</p>;
  }
  const completedAt = lastRun.completedAt;
  const absolute = completedAt ? new Date(completedAt).toLocaleString() : null;
  const when =
    completedAt && absolute ? (
      <time
        dateTime={completedAt}
        title={absolute}
        aria-label={`${formatRelativeTime(completedAt)}, ${absolute}`}
        // Focusable so the absolute time (title) is reachable by keyboard, not only on hover.
        tabIndex={0}
        className="provenance-popover__time"
      >
        {formatRelativeTime(completedAt)}
      </time>
    ) : null;

  if (state === "running") {
    return <p className="provenance-popover__value">A run is in progress</p>;
  }
  if (state === "failed") {
    return (
      <p className="provenance-popover__value provenance-popover__value--failed">
        Last run failed {when}
      </p>
    );
  }
  return (
    <>
      <p className="provenance-popover__value">Last run {when}</p>
      <p className="provenance-popover__value provenance-popover__value--muted">
        {lastRun.rowCount === null
          ? "No rows recorded for this output"
          : plural(lastRun.rowCount, "row")}
      </p>
    </>
  );
}

function ChecksRow({ assertions }: { assertions: Provenance["assertions"] }) {
  if (!assertions.defined) {
    return (
      <p className="provenance-popover__value provenance-popover__value--muted">
        No checks defined
      </p>
    );
  }
  const { passed, failed, warned } = assertions;
  return (
    <ul className="provenance-popover__checks">
      <li>{passed} passed</li>
      <li className={failed > 0 ? "provenance-popover__check--failed" : undefined}>
        {failed} failed
      </li>
      <li className={warned > 0 ? "provenance-popover__check--warned" : undefined}>
        {warned} warned
      </li>
    </ul>
  );
}

/** HEL-1275 — "Compared with <time> · <value>": the baseline point a metric delta was computed
 *  against. The time element mirrors `LastRunRow`'s (title + focusable absolute time). */
function ComparedWithRow({ comparison }: { comparison: PublishedComparison }) {
  const absolute = new Date(comparison.baselineAt).toLocaleString();
  return (
    <section>
      <h3 className="provenance-popover__heading">Compared with</h3>
      <p className="provenance-popover__value">
        <time
          dateTime={comparison.baselineAt}
          title={absolute}
          aria-label={`${formatRelativeTime(comparison.baselineAt)}, ${absolute}`}
          tabIndex={0}
          className="provenance-popover__time"
        >
          {formatRelativeTime(comparison.baselineAt)}
        </time>
        {" \u00B7 "}
        {comparison.baselineText}
      </p>
    </section>
  );
}

interface ProvenanceContentProps {
  data: Provenance;
  variant: ProvenanceVariant;
  comparison: PublishedComparison | null;
  checksRef: RefObject<HTMLHeadingElement | null>;
  pipelineHref: string | null;
  onNavigate: () => void;
}

export function ProvenanceContent({
  data,
  variant,
  comparison,
  checksRef,
  pipelineHref,
  onNavigate,
}: ProvenanceContentProps) {
  const { sources, pipeline, nodePath, lastRun, assertions } = data;
  return (
    <div className="provenance-popover__content">
      <section>
        <h3 className="provenance-popover__heading">
          {sources.length > 1 ? `Sources (${sources.length})` : "Source"}
        </h3>
        <ul className="provenance-popover__list">
          {sources.map((s, i) => (
            <li key={s.id ?? `${s.name}-${i}`} className="provenance-popover__value">
              {s.name} <span className="provenance-popover__kind">{s.kind}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="provenance-popover__heading">Pipeline</h3>
        <p className="provenance-popover__value">{pipeline.name}</p>
        {nodePath.length === 0 ? (
          <p className="provenance-popover__value provenance-popover__value--muted">
            Direct from source
          </p>
        ) : (
          <ol className="provenance-popover__path" aria-label="Steps, in order">
            {nodePath.map((kind, i) => (
              <li key={`${kind}-${i}`}>{stepKindLabel(kind)}</li>
            ))}
          </ol>
        )}
      </section>
      <section>
        <h3 className="provenance-popover__heading">Last run</h3>
        <LastRunRow lastRun={lastRun} />
      </section>
      {comparison && <ComparedWithRow comparison={comparison} />}
      <section>
        <h3 ref={checksRef} tabIndex={-1} className="provenance-popover__heading">
          Checks
        </h3>
        <ChecksRow assertions={assertions} />
      </section>
      {variant === "authenticated" && pipelineHref ? (
        <Link className="provenance-popover__link" to={pipelineHref} onClick={onNavigate}>
          Open pipeline
        </Link>
      ) : null}
    </div>
  );
}
