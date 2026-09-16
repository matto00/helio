// AiStepCostDisclosure — the shared pre-run cost/quota disclosure both AI
// step cards render (HEL-1109 — design.md D5, pipeline-ai-step-authoring
// spec). States what is true and checkable: one model call per input row,
// never auto-run, drawing on the shared daily AI budget. Never a monetary or
// token figure — none exists on any surface. `estimatedRows`, when present,
// is explicitly attributed to the PIPELINE, not this step's own call count,
// since it's pipeline-level and a step downstream of a filter/limit/aggregate
// issues fewer calls.

interface AiStepCostDisclosureProps {
  estimatedRows?: number;
}

export function AiStepCostDisclosure({ estimatedRows }: AiStepCostDisclosureProps) {
  return (
    <p className="pipeline-detail-page__compute-fields-hint">
      This step calls the AI model once per input row. It never runs automatically, and each call
      draws on your account&apos;s shared daily AI budget.
      {typeof estimatedRows === "number" && (
        <> The pipeline&apos;s current estimated row count is {estimatedRows}.</>
      )}
    </p>
  );
}
