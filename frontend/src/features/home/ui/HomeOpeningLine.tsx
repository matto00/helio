import { Skeleton } from "../../../shared/ui/Skeleton";
import {
  buildSummarySentence,
  sentenceText,
  type SummarySentenceInput,
} from "../utils/buildSummarySentence";
import { formatClock } from "../utils/timelineScale";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** "TUE · OCT 13 · 09:12" in the viewer's local time. */
export function formatEyebrow(time: number): string {
  const date = new Date(time);
  return `${DAYS[date.getDay()]} · ${MONTHS[date.getMonth()]} ${date.getDate()} · ${formatClock(time)}`;
}

const DEFAULT_SENTENCE = sentenceText(
  buildSummarySentence({ changedDashboards: 0, failedRuns: 0, stuckRuns: 0, missedRuns: 0 }),
);

interface HomeOpeningLineProps {
  now: number;
  /** `null` while the summary is loading; `"unavailable"` when it failed. */
  input: SummarySentenceInput | null | "unavailable";
}

/** A mono date/time eyebrow and one plain-language sentence built from templates (never a language model). */
export function HomeOpeningLine({ now, input }: HomeOpeningLineProps) {
  return (
    <header className="home-opening">
      <p className="eyebrow home-opening__eyebrow">{formatEyebrow(now)}</p>
      {input === null ? (
        <div role="status" aria-label="Loading summary" className="home-opening__loading">
          {/* The default sentence, hidden: the placeholder is exactly as tall as it at every width (HEL-1665). */}
          <p className="home-opening__ghost" aria-hidden="true">
            {DEFAULT_SENTENCE}
          </p>
          <Skeleton variant="line" className="home-opening__skeleton-line" />
        </div>
      ) : input === "unavailable" ? (
        <p className="home-opening__sentence">Run activity isn&apos;t available right now.</p>
      ) : (
        <p className="home-opening__sentence">
          {buildSummarySentence(input).map((segment, index) =>
            segment.tone === "danger" ? (
              <span key={index} className="home-opening__danger">
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
      )}
    </header>
  );
}
