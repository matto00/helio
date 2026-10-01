import type { FirstRunBuildResult } from "../services/firstRunService";

/** The assistant draft "Refine with the assistant" prefills: names what was just built, by name
 *  and id, and stops mid-sentence so the user finishes the request in their own words. */
export function buildRefineDraft(result: FirstRunBuildResult): string {
  return (
    `I just dropped the CSV "${result.sourceName}" (source id ${result.sourceId}) and Helio built ` +
    `the dashboard "${result.dashboardName}" (id ${result.dashboardId}) from the pipeline ` +
    `"${result.pipelineName}" (id ${result.pipelineId}). Please refine it: `
  );
}

export function canRefineWithAssistant(tier: string | undefined): boolean {
  return tier === "beta" || tier === "owner";
}
