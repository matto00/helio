export interface ReelCase {
  key: string;
  label: string;
  /** Shown under the frame instead of the default example-data caption. */
  note?: string;
  /** One follow-up prompt per panel, in the order of `rects.json`. Each is something Helio can do today. */
  hints: [string, string, string, string];
}

export const DEFAULT_NOTE = "Screenshots of Helio with example data.";

export const CASES: ReelCase[] = [
  {
    key: "launch",
    label: "Launch week",
    hints: [
      "Compare this with the previous run.",
      "Add a target line at 150 signups a day.",
      "Overlay the previous run and mark a 200 ms SLO.",
      "Alert me when checkout errors pass 20.",
    ],
  },
  {
    key: "revenue",
    label: "Revenue",
    hints: [
      "Compare this with the previous run.",
      "Add a goal line at $400 a day.",
      "Show subscribers as a line instead.",
      "Show MRR by plan as a pie chart.",
    ],
  },
  {
    key: "oss",
    label: "Open source",
    hints: [
      "Compare this with the previous run.",
      "Note the Hacker News launch under this chart.",
      "Alert me when open bugs pass 30.",
      "Add a line at our 10-a-week average.",
    ],
  },
  {
    key: "fantasy",
    label: "Fantasy league",
    hints: [
      "Compare this with last week's total.",
      "Add the league average as a line.",
      "Show this as a pie chart.",
      "Alert me when anyone passes 15 waiver adds.",
    ],
  },
  {
    key: "news",
    label: "Morning news",
    note: "From our own workspace. Photos are blurred because they belong to their publishers. Sources: The Guardian, BBC World, Al Jazeera, CNBC, TechCrunch, ESPN and CBS Sports.",
    hints: [
      "Put the top story's photo here.",
      "Summarise each top story in a paragraph, with headlines.",
      "Score each story good, neutral or bad, by day.",
      "Break today's stories down by topic.",
    ],
  },
  {
    key: "helio",
    label: "Building Helio",
    note: "From our own workspace: the board we use to track Helio's development.",
    hints: [
      "Show our average cycle time.",
      "Plot throughput as a 7-day rolling line.",
      "Flag tickets older than 90 days in red.",
      "Add our 90-day average as a line.",
    ],
  },
];
