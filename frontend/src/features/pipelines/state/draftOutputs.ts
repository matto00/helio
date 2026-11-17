// draftOutputs -- HEL-1733 (design.md D1/D2/D4): Output create/delete ops and Output edits in the pipeline draft, replayed in ONE
// pass together with the step ops, so every op is judged against the steps and Outputs as they are at its own point in the log.
// Pure; `pipelineDraft.ts` calls it, the hooks only hold state.

import type { Output } from "../types/output";
import type { Step } from "../types/step";
import { applyOp, isDraftClientId, isOutputOp } from "./draftOps";
import { jsonEqual } from "./jsonEqual";
import type { DraftOp, DraftOutputNode } from "./draftOps";

/** The whole resulting name and config of an edited Output (D4: the server writes the draft's whole config). */
export interface OutputEdit {
  name: string;
  config: Record<string, unknown>;
}

export type OutputEdits = Readonly<Record<string, OutputEdit>>;

export const UNTITLED_OUTPUT = "Untitled output";

/** The Output a created draft entry renders as: `id` is its client id, `nodeStepId` the step (saved id or client id) or absent
 *  for a root node (then `rootId` names it). */
export function outputFromCreate(op: Extract<DraftOp, { kind: "outputCreate" }>): Output {
  const base: Output = {
    id: op.clientId,
    pipelineId: "",
    ownerId: "",
    name: op.name.trim() || UNTITLED_OUTPUT,
    kind: op.outputKind,
    config: op.config,
    schema: [],
    createdAt: "",
    updatedAt: "",
    panelCount: 0,
  };
  return "step" in op.node
    ? { ...base, nodeStepId: op.node.step }
    : { ...base, rootId: op.node.root };
}

/** True for an Output that exists only in the draft. */
export function isDraftOutput(output: Pick<Output, "id">): boolean {
  return isDraftClientId(output.id);
}

export function nodeOf(output: Output): DraftOutputNode | null {
  if (output.nodeStepId !== undefined) return { step: output.nodeStepId };
  if (output.rootId !== undefined) return { root: output.rootId };
  return null;
}

/** `{...currentConfig, ...patch}`: the server's `mergeConfig` (a shallow merge; a `null` patch value is kept as `null`). Held to
 *  the Scala result by the parity fixture. */
export function draftMerge(
  stored: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...stored, ...patch };
}

export interface InterleavedReplay {
  steps: Step[];
  /** `null` while the base Outputs are not loaded: Output ops are carried through untouched and judged later. */
  outputs: Output[] | null;
  keptOps: DraftOp[];
  droppedOps: DraftOp[];
  /** Outputs a step delete took with it (the server cascades; never counted). */
  cascadedOutputIds: ReadonlySet<string>;
  /** Outputs an `outputDelete` removed. */
  deletedOutputIds: ReadonlySet<string>;
}

/** Walks the single op log once, carrying the steps and (when loaded) the Outputs. */
export function replayInterleaved(
  base: readonly Step[],
  baseOutputs: readonly Output[] | null,
  ops: readonly DraftOp[],
): InterleavedReplay {
  let steps: Step[] = [...base];
  let outputs: Output[] | null = baseOutputs === null ? null : [...baseOutputs];
  const keptOps: DraftOp[] = [];
  const droppedOps: DraftOp[] = [];
  const cascaded = new Set<string>();
  const deleted = new Set<string>();
  for (const op of ops) {
    if (op.kind === "outputCreate") {
      if (outputs === null) {
        keptOps.push(op);
        continue;
      }
      const stepIds = new Set(steps.map((s) => s.id));
      const nodeOk = "step" in op.node ? stepIds.has(op.node.step) : true;
      if (!nodeOk || outputs.some((o) => o.id === op.clientId)) droppedOps.push(op);
      else {
        outputs = [...outputs, outputFromCreate(op)];
        keptOps.push(op);
      }
      continue;
    }
    if (op.kind === "outputDelete") {
      if (outputs === null) {
        keptOps.push(op);
      } else if (outputs.some((o) => o.id === op.outputId)) {
        outputs = outputs.filter((o) => o.id !== op.outputId);
        deleted.add(op.outputId);
        keptOps.push(op);
      } else if (!cascaded.has(op.outputId)) droppedOps.push(op);
      // else: a step delete already removed it: a no-op, not counted.
      continue;
    }
    const next = applyOp(steps, op);
    if (next === null) {
      droppedOps.push(op);
      continue;
    }
    steps = next;
    keptOps.push(op);
    if (outputs !== null) {
      const present = new Set(steps.map((s) => s.id));
      const gone = outputs.filter((o) => o.nodeStepId !== undefined && !present.has(o.nodeStepId));
      if (gone.length > 0) {
        for (const o of gone) cascaded.add(o.id);
        outputs = outputs.filter((o) => !cascaded.has(o.id));
      }
    }
  }
  return {
    steps,
    outputs,
    keptOps,
    droppedOps,
    cascadedOutputIds: cascaded,
    deletedOutputIds: deleted,
  };
}

/** Applies the edit map to the final Outputs. Returns the Outputs and how many entries named an Output that is simply gone
 *  (not removed by this draft: a rebase lost it), which the page counts. */
export function applyOutputEdits(
  outputs: readonly Output[],
  edits: OutputEdits,
  ignored: { cascaded: ReadonlySet<string>; deleted: ReadonlySet<string> },
): { outputs: Output[]; dropped: number } {
  let dropped = 0;
  const ids = new Set(outputs.map((o) => o.id));
  for (const id of Object.keys(edits)) {
    if (!ids.has(id) && !ignored.cascaded.has(id) && !ignored.deleted.has(id)) dropped += 1;
  }
  return {
    outputs: outputs.map((o) => {
      const edit = edits[o.id];
      return edit === undefined ? o : { ...o, name: edit.name, config: edit.config };
    }),
    dropped,
  };
}

/** The Output rules of `pruneOverlay` (D2), once the base Outputs are loaded: create-then-delete leaves nothing, an Output a step
 *  delete took is forgotten with its edit, an edit set back to the pre-edit name+config is dropped (for a created Output, equal to its
 *  create op: the entry goes, the op stays). */
export function pruneOutputOps(
  ops: readonly DraftOp[],
  edits: OutputEdits,
  replayed: Pick<InterleavedReplay, "cascadedOutputIds" | "deletedOutputIds"> & {
    outputs: Output[] | null;
  },
  baseOutputs: readonly Output[],
): { ops: DraftOp[]; outputEdits: OutputEdits } {
  const gone = new Set([...replayed.cascadedOutputIds, ...replayed.deletedOutputIds]);
  const keptOps = ops.filter(
    (op) =>
      !(op.kind === "outputCreate" && gone.has(op.clientId)) &&
      !(op.kind === "outputDelete" && isDraftClientId(op.outputId) && gone.has(op.outputId)),
  );
  const creates = new Map(
    keptOps.flatMap((op) => (op.kind === "outputCreate" ? [[op.clientId, op] as const] : [])),
  );
  const live = new Set((replayed.outputs ?? []).map((o) => o.id));
  const savedById = new Map(baseOutputs.map((o) => [o.id, o]));
  const outputEdits: Record<string, OutputEdit> = {};
  for (const [id, edit] of Object.entries(edits)) {
    if (!live.has(id)) continue;
    const saved = savedById.get(id);
    const create = creates.get(id);
    const before: OutputEdit | null = saved
      ? { name: saved.name, config: saved.config }
      : create
        ? { name: create.name.trim() || UNTITLED_OUTPUT, config: create.config }
        : null;
    if (before !== null && before.name === edit.name && jsonEqual(before.config, edit.config))
      continue;
    outputEdits[id] = edit;
  }
  return { ops: keptOps, outputEdits };
}

export { isOutputOp };
