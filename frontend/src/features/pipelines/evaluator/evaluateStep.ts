// HEL-1581 — `clientEvaluable` and single-step evaluation (design Decision 2). The order mirrors the
// engine's `evalOneStep`: a step the client cannot evaluate declines; otherwise the kind's ported
// `requiredConfigProblems` run first (any problem is an `error`), then the step is evaluated, and a
// thrown failure is also an `error`. The evaluator never returns rows for a declined or erroring step.

import { StepConfigError } from "./config";
import { AI_KINDS, SERVER_KINDS, handlerFor } from "./steps/registry";
import type { ClientDeclineReason, RunContext } from "./steps/types";
import type { Frame } from "./value";

export type { ClientDeclineReason, RunContext } from "./steps/types";

/** The part of a pipeline step the evaluator reads. */
export interface StepInput {
  id: string;
  kind: string;
  config: unknown;
}

export type ClientEvaluable = { ok: true } | { ok: false; reason: ClientDeclineReason };

export type StepOutcome =
  | { status: "ok"; rows: Frame; writesOnSave: boolean }
  /** `internal` marks a failure that is not a configuration problem (an evaluator bug): it still never yields rows. */
  | { status: "error"; message: string; internal?: boolean }
  | { status: "needsServer"; reason: ClientDeclineReason }
  | { status: "notPreviewed" };

function reasonForKind(kind: string): ClientDeclineReason | undefined {
  if (SERVER_KINDS.includes(kind)) return "serverKind";
  if (AI_KINDS.includes(kind)) return "aiStep";
  return handlerFor(kind) ? undefined : "unknownKind";
}

const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : "step evaluation failed";

/**
 * Whether the client can evaluate this (enabled) step at all. A config that cannot even be decoded is
 * reported as evaluable here; `evaluateStep` then reports it as an `error`, as the engine would.
 */
export function clientEvaluable(step: StepInput, ctx: RunContext): ClientEvaluable {
  const kindReason = reasonForKind(step.kind);
  if (kindReason !== undefined) return { ok: false, reason: kindReason };
  const handler = handlerFor(step.kind)!;
  try {
    const reason = handler.declines?.(handler.decode(step.config), ctx);
    return reason === undefined ? { ok: true } : { ok: false, reason };
  } catch {
    return { ok: true };
  }
}

/** Evaluates one enabled step over its input frame. */
export function evaluateStep(step: StepInput, input: Frame, ctx: RunContext): StepOutcome {
  const kindReason = reasonForKind(step.kind);
  if (kindReason === "aiStep") return { status: "notPreviewed" };
  if (kindReason !== undefined) return { status: "needsServer", reason: kindReason };
  const handler = handlerFor(step.kind)!;
  try {
    const config = handler.decode(step.config);
    const declined = handler.declines?.(config, ctx);
    if (declined !== undefined) return { status: "needsServer", reason: declined };
    const problems = handler.problems(config);
    if (problems.length > 0) return { status: "error", message: problems.join("; ") };
    return {
      status: "ok",
      rows: handler.apply(input, config, ctx),
      writesOnSave: handler.writesOnSave === true,
    };
  } catch (e) {
    return {
      status: "error",
      message: messageOf(e),
      ...(e instanceof StepConfigError ? {} : { internal: true }),
    };
  }
}
