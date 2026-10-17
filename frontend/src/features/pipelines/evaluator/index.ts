// HEL-1581 — the client pipeline evaluator's public surface. Nothing in the app imports it yet (the draft
// UI is HEL-1631/HEL-1632); the corpus in shared-test-fixtures/pipeline-step-parity/ holds it to the Scala engine.

export { clientEvaluable, evaluateStep } from "./evaluateStep";
export type {
  ClientDeclineReason,
  ClientEvaluable,
  RunContext,
  StepInput,
  StepOutcome,
} from "./evaluateStep";
export { evaluatePipeline, frameSchema } from "./evaluatePipeline";
export type {
  NodeResult,
  RootFrame,
  SourceFrames,
  StepDefinition,
  WalkOptions,
  WalkResult,
} from "./evaluatePipeline";
export { Integral, anyToString, int, long, toJsonRows, toJsonValue } from "./value";
export type { Frame, Row, Value } from "./value";
