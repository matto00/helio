// HEL-1581 — the shape every step kind implements. A kind mirrors its Scala companion: `decode` is
// `*Config.decode` (tolerant, but a wrong-typed key throws `StepConfigTypeMismatch`), `problems` is
// `requiredConfigProblems` (the engine runs it before `evaluate`), `apply` is `evaluate`.

import type { Frame } from "../value";

/** Spike section 3.1's classes. `server` kinds are never evaluated client-side. */
export type StepClass = "client" | "client*" | "identity" | "server";

/** Why `clientEvaluable` declined (design Decision 2). */
export type ClientDeclineReason =
  | "serverKind"
  | "aiStep"
  | "legacyExpression"
  | "unsafeRegex"
  | "secondaryNotCached"
  | "unknownFunction"
  | "unknownKind";

/** What a step may read besides its input frame. */
export interface RunContext {
  /** True when the input frame is a Scala `List` (downstream of aggregate / groupby / pivot), else a `Vector`. */
  readonly listFrame?: boolean;
  /** The already-evaluated frame of a lane `secondaryInput` step. */
  lane(stepId: string): Frame | undefined;
  /** A source `secondaryInput` frame the caller cached, and whether it is complete. */
  source(dataSourceId: string): { rows: Frame; complete: boolean } | undefined;
}

export interface StepHandler<C = unknown> {
  readonly stepClass: Exclude<StepClass, "server">;
  decode(raw: unknown): C;
  problems(config: C): string[];
  apply(rows: Frame, config: C, ctx: RunContext): Frame;
  /** A config-level reason this step cannot be evaluated client-side, checked before `problems`. */
  declines?(config: C, ctx: RunContext): ClientDeclineReason | undefined;
  /** True for `upsertsource`: the step writes on Save & run. */
  readonly writesOnSave?: boolean;
}
