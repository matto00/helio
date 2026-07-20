import "./TimelineRenderer.css";
import type { TimelinePanel } from "../../types/panel";

interface TimelineRendererProps {
  panel: TimelinePanel;
  /** Fetched snapshot rows (string cells, aligned to `headers`) — one row per
   *  rendered entry, the table fetch path (mirrors `CollectionRenderer`). */
  rawRows?: string[][] | null;
  /** Column names aligned to each `rawRows` row. */
  headers?: string[] | null;
}

interface TimelineEntry {
  time: string;
  event: string;
}

/** Compares two `time` cell values for the chronological sort. Numeric
 *  strings compare numerically; everything else (including ISO-8601
 *  timestamps, which sort correctly lexically) compares as plain strings —
 *  no parsing/normalization is attempted (design.md risk note: "the pipeline
 *  produces the shape"). */
function compareTimeValues(a: string, b: string): number {
  const numA = Number(a);
  const numB = Number(b);
  if (a.trim() !== "" && b.trim() !== "" && Number.isFinite(numA) && Number.isFinite(numB)) {
    return numA - numB;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Map fetched rows to `{ time, event }` entries using the bound
 *  `fieldMapping.time` / `fieldMapping.event` columns, then sort
 *  chronologically per `timelineOptions.sort`. */
function buildEntries(
  rows: string[][],
  headers: string[],
  fieldMapping: Record<string, string>,
  sort: "asc" | "desc",
): TimelineEntry[] {
  const timeCol = fieldMapping.time ? headers.indexOf(fieldMapping.time) : -1;
  const eventCol = fieldMapping.event ? headers.indexOf(fieldMapping.event) : -1;

  const entries = rows.map((row) => ({
    time: timeCol >= 0 ? (row[timeCol] ?? "") : "",
    event: eventCol >= 0 ? (row[eventCol] ?? "") : "",
  }));

  const sorted = [...entries].sort((a, b) => compareTimeValues(a.time, b.time));
  return sort === "desc" ? sorted.reverse() : sorted;
}

/** Timeline body — renders bound rows as a vertical, chronologically ordered
 *  event list (HEL-317): one marker + connector + time + description per
 *  entry, ordered per `timelineOptions.sort`. The trailing connector is
 *  suppressed on the last entry so a single row degrades cleanly. */
export function TimelineRenderer({ panel, rawRows, headers }: TimelineRendererProps) {
  const { dataTypeId, fieldMapping, timelineOptions } = panel.config;

  // Unbound → invite configuration, never an error.
  if (!dataTypeId) {
    return (
      <div className="panel-content panel-content--state">
        <span className="panel-content__state-label">
          Bind a data type to populate this timeline
        </span>
      </div>
    );
  }

  // Bound but no rows → "No data" state rather than an empty body.
  if (!rawRows || rawRows.length === 0 || !headers) {
    return (
      <div className="panel-content panel-content--state">
        <span className="panel-content__state-label">No data</span>
      </div>
    );
  }

  const entries = buildEntries(rawRows, headers, fieldMapping, timelineOptions.sort);

  return (
    <div className="panel-content panel-content--timeline">
      <ol className="panel-content__timeline-list">
        {entries.map((entry, index) => (
          <li
            key={index}
            className={`panel-content__timeline-entry${
              index === entries.length - 1 ? " panel-content__timeline-entry--last" : ""
            }`}
          >
            <span className="panel-content__timeline-marker" aria-hidden="true" />
            <div className="panel-content__timeline-body">
              <span className="panel-content__timeline-time">{entry.time}</span>
              <span className="panel-content__timeline-event">{entry.event}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
