// StepSchemaDiffChips — HEL-405: renders a step's real added/dropped/retyped/
// renamed schema diff as chips, replacing StepCard's hardcoded placeholder.
// Pure presentational wrapper around `computeSchemaDiff`; kept out of
// StepCard.tsx (already past the 400-line budget — HEL-682 owns the split).

import { computeSchemaDiff } from "../state/schemaDiff";
import type { SchemaField } from "../types/pipelineStep";

interface StepSchemaDiffChipsProps {
  /** The step's analyze inputSchema. */
  input: SchemaField[];
  /** The step's analyze outputSchema. */
  output: SchemaField[];
  /** `step.config.renames` — pass only for the `rename` op (design.md Decision 1). */
  renames?: Record<string, string>;
}

export function StepSchemaDiffChips({ input, output, renames }: StepSchemaDiffChipsProps) {
  const { added, dropped, renamed, retyped } = computeSchemaDiff(input, output, renames);

  if (added.length === 0 && dropped.length === 0 && renamed.length === 0 && retyped.length === 0) {
    return null;
  }

  return (
    <div className="pipeline-detail-page__step-card-diff">
      {added.map((field) => (
        <span
          key={`added-${field.name}`}
          className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--added"
        >
          + {field.name}
        </span>
      ))}
      {dropped.map((field) => (
        <span
          key={`dropped-${field.name}`}
          className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--removed"
        >
          − {field.name}
        </span>
      ))}
      {retyped.map((field) => (
        <span
          key={`retyped-${field.name}`}
          className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--changed"
        >
          ~ {field.name}: {field.fromType}→{field.toType}
        </span>
      ))}
      {renamed.map((field) => (
        <span
          key={`renamed-${field.from}`}
          className="pipeline-detail-page__step-card-diff-chip pipeline-detail-page__step-card-diff-chip--renamed"
        >
          {field.from} → {field.to}
        </span>
      ))}
    </div>
  );
}
