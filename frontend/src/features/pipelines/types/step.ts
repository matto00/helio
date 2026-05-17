// PipelineDetailPage UI step types — the local representation the page uses
// internally for op-type metadata (label + icon) and per-step UI state.
//
// These are deliberately distinct from the persisted-wire `PipelineStep`
// discriminated union in `./pipelineStep.ts`: the wire type encodes
// `{ type, config }` only, while the UI needs a richer object that bundles
// each op-type with its display label and FontAwesome icon. Conversion
// between the two happens via the helpers in `../state/stepNarrowing.ts`
// (`pipelineStepToStep`, `defaultConfigFor`, `makeStep`).

import type { IconDefinition } from "@fortawesome/free-solid-svg-icons";

import type { PipelineStepConfig } from "./pipelineStep";

export interface OpType {
  id: string;
  label: string;
  icon: IconDefinition;
}

export interface Step {
  id: string;
  opType: OpType;
  label: string;
  config: PipelineStepConfig;
}
