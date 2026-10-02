/**
 * HEL-1069: zero-row warnings for `run_pipeline`, computed client-side from data the backend
 * already returns (`stepRowCounts`, `sourceRowCount`) plus the pipeline's step graph. A zero count
 * on a step whose input was non-empty is the observable signature of a silently-wrong branch
 * (e.g. a join whose key types mismatch, or a step aggregating a field its new parent no longer
 * outputs). It is a prompt to check, not proof of a bug: a filter that legitimately matches
 * nothing warns too. Counts cannot reveal wrong VALUES (a step can keep its count while its
 * numbers are wrong), so placement correctness is the primary defence and this the secondary one.
 */

import type { PipelineStepResponse } from "./types.js";

export interface RunWarning {
  stepId: string;
  type: string;
  message: string;
  /** Row counts of the inputs that were non-empty: `parent` is the nearest counted ancestor (or
   *  the primary source for a root-level step), `lane` the `secondaryInput` lane step's count. */
  inputCounts: { parent?: number; lane?: number };
}

const LANE_OPS = new Set(["join", "union", "lookup"]);

/** The lane step id a join/union/lookup reads via `config.secondaryInput`, or undefined when the
 *  step has none or its config is not the expected shape (never throws). */
function laneStepIdOf(step: PipelineStepResponse): string | undefined {
  if (!LANE_OPS.has(step.type)) return undefined;
  const config = step.config;
  if (typeof config !== "object" || config === null) return undefined;
  const secondary = (config as Record<string, unknown>).secondaryInput;
  if (typeof secondary !== "object" || secondary === null) return undefined;
  const { kind, stepId } = secondary as Record<string, unknown>;
  return kind === "lane" && typeof stepId === "string" ? stepId : undefined;
}

export function computeRunWarnings(input: {
  steps: PipelineStepResponse[];
  stepRowCounts: Record<string, number>;
  sourceRowCount: number;
  /** The root whose source the backend's `sourceRowCount` reflects (first root by position). */
  primaryRootId: string | undefined;
}): RunWarning[] {
  const { steps, stepRowCounts: counts, sourceRowCount, primaryRootId } = input;
  const byId = new Map(steps.map((s) => [s.id, s]));

  /** Row count feeding `step` from its parent side, or undefined when it cannot be established
   *  (a root-level step of a non-primary root, an unknown ancestor, a cycle). */
  const parentInputOf = (step: PipelineStepResponse): number | undefined => {
    const seen = new Set<string>();
    let current: PipelineStepResponse | undefined = step;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (!current.parentStepId) {
        return primaryRootId !== undefined && current.rootId === primaryRootId
          ? sourceRowCount
          : undefined;
      }
      const parentCount = counts[current.parentStepId];
      if (parentCount !== undefined) return parentCount;
      current = byId.get(current.parentStepId);
    }
    return undefined;
  };

  const warnings: RunWarning[] = [];
  for (const step of steps) {
    if (counts[step.id] !== 0) continue; // no entry (disabled) or non-zero: nothing to flag
    const parent = parentInputOf(step);
    const laneId = laneStepIdOf(step);
    const lane = laneId === undefined ? undefined : counts[laneId];
    const inputCounts: RunWarning["inputCounts"] = {};
    if (parent !== undefined && parent > 0) inputCounts.parent = parent;
    if (lane !== undefined && lane > 0) inputCounts.lane = lane;
    if (inputCounts.parent === undefined && inputCounts.lane === undefined) continue;
    const inputs = [
      inputCounts.parent !== undefined ? `parent input ${inputCounts.parent} rows` : undefined,
      inputCounts.lane !== undefined ? `lane input ${inputCounts.lane} rows` : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    warnings.push({
      stepId: step.id,
      type: step.type,
      inputCounts,
      message:
        `Step ${step.id} (${step.type}) produced 0 rows from a non-empty input (${inputs}). ` +
        "Check the step's config (join key types, referenced fields, filter conditions); a filter " +
        "that legitimately matches nothing also triggers this warning.",
    });
  }
  return warnings;
}
