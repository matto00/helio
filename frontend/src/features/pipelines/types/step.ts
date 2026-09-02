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
  // HEL-412 — persisted disable/enable flag. Always a real boolean here
  // (normalized from the wire's `enabled ?? true` before a Step is built).
  enabled: boolean;
  // HEL-908 task 3.4 — carries the wire `PipelineStep.parentStepId` through
  // for `buildStepTree` (`../state/stepTree.ts`) to group trunk vs. tail.
  // `undefined` for the pipeline's root step AND for a freshly created,
  // not-yet-persisted step (`makeStep`) whose real parent isn't known until
  // the create call resolves.
  parentStepId?: string | null;
  // Evaluation-1 cycle-2 CR1 — carries the wire `PipelineStep.position`
  // through so `buildStepTree` can disambiguate a SINGLE-child node's tail
  // vs. trunk-continuation status even when array order alone can't (a
  // childless anchor gaining exactly one new child is the same flat-array
  // shape whether that child lands at position 0 or position >= 1 --
  // `executionOrder` has no OTHER child to order it against). `undefined`
  // for a freshly created, not-yet-persisted step (`makeStep`).
  position?: number;
}
