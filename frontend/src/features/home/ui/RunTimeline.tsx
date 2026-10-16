import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import type { HomeSummary } from "../types/homeSummary";
import {
  buildMarks,
  markLabel,
  nextMarkPosition,
  type MarkPosition,
  type TimelineMark as Mark,
} from "../utils/timelineMarks";
import { hourTicks, timeToPercent, timelineRange } from "../utils/timelineScale";
import { MarkDetails, MarkShape } from "./TimelineMark";

interface RunTimelineProps {
  summary: HomeSummary;
  /** Server-clock "now" in epoch ms, for the now line. */
  now: number;
}

const LEGEND: { status: "succeeded" | "failed" | "running" | "scheduled"; text: string }[] = [
  { status: "succeeded", text: "ok" },
  { status: "failed", text: "failed" },
  { status: "running", text: "running" },
  { status: "scheduled", text: "scheduled" },
];

export function TimelineLegend() {
  return (
    <ul className="tl-legend" aria-label="Legend">
      {LEGEND.map((entry) => (
        <li key={entry.status} className="tl-legend__item">
          <MarkShape status={entry.status} />
          {entry.text}
        </li>
      ))}
    </ul>
  );
}

/** The pointer-and-keyboard timeline: one row per pipeline across the 24h window plus the 6h horizon. A single
 *  composite tab stop (roving tabindex); every mark is a button whose label names the pipeline, status and local
 *  time, and which shows the run's details on hover and on focus (Escape dismisses them). */
export function RunTimeline({ summary, now }: RunTimelineProps) {
  const navigate = useNavigate();
  const range = useMemo(() => timelineRange(summary), [summary]);
  const ticks = useMemo(() => hourTicks(range), [range]);
  const rows = useMemo(() => summary.pipelines.map(buildMarks), [summary.pipelines]);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [active, setActive] = useState<MarkPosition>({ row: 0, col: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // The roving stop must stay on a real mark after a refetch reshapes the rows.
  const firstWithMarks = rows.findIndex((marks) => marks.length > 0);
  const stop: MarkPosition =
    rows[active.row]?.[active.col] !== undefined
      ? active
      : { row: Math.max(0, firstWithMarks), col: 0 };

  const shownKey = hovered ?? focused;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, position: MarkPosition) {
    if (event.key === "Escape") {
      if (shownKey !== null) setDismissed(shownKey);
      return;
    }
    const next = nextMarkPosition(rows, position, event.key);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    refs.current.get(rows[next.row][next.col].key)?.focus();
  }

  const nowPercent = timeToPercent(now, range);

  return (
    <div className="tl" role="group" aria-label="Pipeline runs, last 24 hours">
      <div className="tl__rows">
        <div className="tl__overlay" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick.time} className="tl__gridline" style={{ left: `${tick.percent}%` }} />
          ))}
          <span className="tl__now" style={{ left: `${nowPercent}%` }}>
            <span className="tl__now-label">now</span>
          </span>
        </div>
        {summary.pipelines.map((pipeline, rowIndex) => (
          <div
            key={pipeline.pipelineId}
            className="tl__row"
            role="group"
            aria-label={pipeline.name}
          >
            <span className="tl__name mono" title={pipeline.name}>
              {pipeline.name}
              {pipeline.runsOmitted > 0 ? (
                <span className="tl__omitted"> +{pipeline.runsOmitted} earlier</span>
              ) : null}
            </span>
            <span className="tl__track">
              {rows[rowIndex].map((mark: Mark, colIndex) => {
                const position = { row: rowIndex, col: colIndex };
                const isStop = stop.row === rowIndex && stop.col === colIndex;
                const percent = timeToPercent(mark.time, range);
                const tipId = `tl-tip-${mark.key}`;
                const showTip = shownKey === mark.key && dismissed !== mark.key;
                return (
                  <span
                    key={mark.key}
                    className={`tl__mark-wrap${percent > 80 ? " tl__mark-wrap--end" : ""}${percent < 20 ? " tl__mark-wrap--start" : ""}`}
                    style={{ left: `${percent}%` }}
                  >
                    <button
                      type="button"
                      className="tl__mark"
                      ref={(element) => {
                        if (element === null) refs.current.delete(mark.key);
                        else refs.current.set(mark.key, element);
                      }}
                      tabIndex={isStop ? 0 : -1}
                      aria-label={markLabel(pipeline.name, mark)}
                      aria-describedby={showTip ? tipId : undefined}
                      onClick={() => navigate(`/pipelines/${pipeline.pipelineId}`)}
                      onKeyDown={(event) => onKeyDown(event, position)}
                      onFocus={() => {
                        setActive(position);
                        setFocused(mark.key);
                      }}
                      onBlur={() => {
                        setFocused((key) => (key === mark.key ? null : key));
                        setDismissed((key) => (key === mark.key ? null : key));
                      }}
                      onMouseEnter={() => setHovered(mark.key)}
                      onMouseLeave={() => {
                        setHovered((key) => (key === mark.key ? null : key));
                        setDismissed((key) => (key === mark.key ? null : key));
                      }}
                    >
                      <MarkShape status={mark.status} />
                    </button>
                    {showTip ? (
                      <MarkDetails pipelineName={pipeline.name} mark={mark} id={tipId} />
                    ) : null}
                  </span>
                );
              })}
            </span>
          </div>
        ))}
        <div className="tl__axis" aria-hidden="true">
          <span />
          <span className="tl__ticks">
            {ticks.map((tick) => (
              <span key={tick.time} className="tl__tick mono" style={{ left: `${tick.percent}%` }}>
                {tick.label}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
