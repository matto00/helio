/** One run of text in the opening sentence; `tone: "danger"` marks the failure clause (intent colour, never accent). */
export interface SentenceSegment {
  text: string;
  tone?: "danger";
}

export interface SummarySentenceInput {
  /** Shelf dashboards showing the changed dot. */
  changedDashboards: number;
  /** Unresolved failed attention items. */
  failedRuns: number;
  stuckRuns: number;
  missedRuns: number;
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** Number words for one to nine, digits beyond (the copy standard, DESIGN.md §0.5). */
export function numberWord(n: number): string {
  return n >= 0 && n <= 9 ? WORDS[n] : String(n);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The opening line's plain-language sentence, from templates (never a language model): it names what changed,
 *  failed, stalled or was missed, and ends "everything else is quiet" when anything was named. */
export function buildSummarySentence(input: SummarySentenceInput): SentenceSegment[] {
  const { changedDashboards, failedRuns, stuckRuns, missedRuns } = input;
  const segments: SentenceSegment[] = [];

  if (changedDashboards > 0) {
    segments.push({
      text: `${capitalize(numberWord(changedDashboards))} ${plural(changedDashboards, "dashboard changed", "dashboards changed")} since your last visit.`,
    });
  }

  const runClauses: SentenceSegment[] = [];
  if (failedRuns > 0) {
    runClauses.push({
      text: `${numberWord(failedRuns)} ${plural(failedRuns, "run failed", "runs failed")}`,
      tone: "danger",
    });
  }
  if (stuckRuns > 0) {
    runClauses.push({
      text: `${numberWord(stuckRuns)} ${plural(stuckRuns, "run looks stuck", "runs look stuck")}`,
      tone: "danger",
    });
  }
  if (missedRuns > 0) {
    runClauses.push({
      text: `${numberWord(missedRuns)} scheduled ${plural(missedRuns, "run was missed", "runs were missed")}`,
      tone: "danger",
    });
  }

  if (runClauses.length > 0) {
    if (segments.length > 0) segments.push({ text: " " });
    runClauses.forEach((clause, index) => {
      const first = index === 0;
      const text = first ? capitalize(clause.text) : clause.text;
      if (index > 0) segments.push({ text: index === runClauses.length - 1 ? " and " : ", " });
      segments.push({ ...clause, text });
    });
    segments.push({ text: ", everything else is quiet." });
  } else if (segments.length > 0) {
    segments.push({ text: " Everything else is quiet." });
  } else {
    segments.push({ text: "All quiet: nothing has changed, failed or been missed." });
  }
  return segments;
}

export function sentenceText(segments: SentenceSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}
