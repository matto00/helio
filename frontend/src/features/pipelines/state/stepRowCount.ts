// stepRowCount — HEL-1579 (design.md D9): the row count the spine shows after one step. The
// in-session run's counts (Redux, from a Run or Dry run in this page session) win; otherwise the
// persisted latest run's `lastRunStepRowCounts` from the pipeline response; otherwise `null`
// ("not recorded", rendered "—", never as zero). Ids of removed steps are simply never asked for,
// and a step added after the run has no entry, so it falls through to `null`.

type StepRowCounts = Record<string, number> | null | undefined;

export function stepRowCount(
  stepId: string,
  inSessionCounts: StepRowCounts,
  persistedCounts: StepRowCounts,
): number | null {
  return inSessionCounts?.[stepId] ?? persistedCounts?.[stepId] ?? null;
}

/** Which source the displayed counts come from, so the truncation context can follow it
 *  (`pipeline-run-truncation-reporting`): "session" when the in-session run has any counts. */
export function stepRowCountSource(
  inSessionCounts: StepRowCounts,
  persistedCounts: StepRowCounts,
): "session" | "persisted" | "none" {
  if (inSessionCounts && Object.keys(inSessionCounts).length > 0) return "session";
  if (persistedCounts && Object.keys(persistedCounts).length > 0) return "persisted";
  return "none";
}
