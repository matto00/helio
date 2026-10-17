import { useState } from "react";
import { Link } from "react-router-dom";

import type { HomeSummary } from "../types/homeSummary";
import { buildMarks, disclosureLabel, firstLine, STATUS_WORD } from "../utils/timelineMarks";
import { formatClock, timeToPercent, timelineRange } from "../utils/timelineScale";
import { MarkShape } from "./TimelineMark";

/** The coarse-pointer and phone form of the timeline (DESIGN.md §3's 44px floor): each pipeline is ONE control,
 *  labelled with its name, run and failure counts and next fire, over a non-interactive strip of its marks.
 *  Activating it expands a list of that pipeline's runs and fires, newest first, each row at least 44px high with
 *  status (shape and text), time, error and a link to the pipeline. */
export function RunDisclosureList({ summary }: { summary: HomeSummary }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const range = timelineRange(summary);

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <ul className="tl-disc" aria-label="Pipeline runs, last 24 hours">
      {summary.pipelines.map((pipeline) => {
        const expanded = open.has(pipeline.pipelineId);
        const panelId = `tl-disc-${pipeline.pipelineId}`;
        const marks = buildMarks(pipeline);
        return (
          <li key={pipeline.pipelineId} className="tl-disc__item">
            <button
              type="button"
              className="tl-disc__head"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => toggle(pipeline.pipelineId)}
            >
              <span className="tl-disc__label">{disclosureLabel(pipeline)}</span>
              <span className="tl-disc__strip" aria-hidden="true">
                {marks.map((mark) => (
                  <span
                    key={mark.key}
                    className="tl-disc__mark"
                    style={{ left: `${timeToPercent(mark.time, range)}%` }}
                  >
                    <MarkShape status={mark.status} />
                  </span>
                ))}
              </span>
            </button>
            {expanded ? (
              <ul id={panelId} className="tl-disc__list">
                {[...marks].reverse().map((mark) => {
                  const error =
                    mark.status === "failed" ? firstLine(mark.run?.errorLog ?? null) : null;
                  return (
                    <li key={mark.key} className="tl-disc__row">
                      <MarkShape status={mark.status} />
                      <span className="tl-disc__status">{STATUS_WORD[mark.status]}</span>
                      <span className="tl-disc__time mono">{formatClock(mark.time)}</span>
                      {error !== null ? <span className="tl-disc__error">{error}</span> : null}
                      <Link to={`/pipelines/${pipeline.pipelineId}`} className="tl-disc__open">
                        Open pipeline
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
