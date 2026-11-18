// HEL-1734: `buildDraftSaveRequest` with root ops: the final roots go in the body, a root op the fresh saved roots cannot take is
// reported as dropped (nothing is sent), and a draft with no root op sends no `roots` at all.

import type { DraftOp } from "../state/draftOps";
import { EMPTY_OVERLAY } from "../state/pipelineDraft";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type { PipelineRoot } from "../types/pipelineStep";
import { threeSteps } from "../ui/pipelineSpineTestKit";
import { buildDraftSaveRequest } from "./draftSaveRequest";

const wire = threeSteps();
const steps = wire.map(pipelineStepToStep);
const root = (id: string): PipelineRoot => ({ id, dataSourceId: `ds-${id}`, dataSourceName: id });
const SAVED = [root("root-1"), root("root-2")];
const summary = (roots: PipelineRoot[] = SAVED) => ({
  fingerprint: "v1:" + "a".repeat(64),
  roots,
  definition: { steps: wire, outputs: [] },
});
const add: DraftOp = {
  kind: "rootAdd",
  clientId: "draft-x",
  sourceId: "ds-new",
  dataSourceName: "New",
};
const build = (ops: DraftOp[], over: { fresh?: PipelineRoot[]; saved?: PipelineRoot[] } = {}) =>
  buildDraftSaveRequest({
    summary: summary(over.fresh),
    persistedSteps: steps,
    baseOutputs: null,
    overlay: { ...EMPTY_OVERLAY, ops },
    roots: over.saved ?? SAVED,
    confirm: undefined,
  });

describe("buildDraftSaveRequest with root ops", () => {
  it("sends the final roots: the saved ones kept by id, the added one by clientId and source", () => {
    const built = build([add]);
    expect(built.kind).toBe("ready");
    if (built.kind !== "ready") return;
    expect(built.request.roots).toEqual([
      { id: "root-1" },
      { id: "root-2" },
      { clientId: "draft-x", sourceId: "ds-new" },
    ]);
  });

  it("omits a removed saved root from the list, and its steps from the tree", () => {
    const built = build([{ kind: "rootRemove", rootId: "root-1" }]);
    expect(built.kind).toBe("ready");
    if (built.kind !== "ready") return;
    expect(built.request.roots).toEqual([{ id: "root-2" }]);
    expect(built.request.steps).toEqual([]);
  });

  it("names the draft root on a step added at its head (rootClientId, no rootId)", () => {
    const insert: DraftOp = {
      kind: "insert",
      clientId: "draft-s",
      type: "limit",
      config: { count: 1 },
      anchor: { head: "draft-x" },
    };
    const built = build([add, insert]);
    expect(built.kind).toBe("ready");
    if (built.kind !== "ready") return;
    const created = built.request.steps.find((s) => s.clientId === "draft-s");
    expect(created).toMatchObject({ rootClientId: "draft-x" });
    expect(created?.rootId).toBeUndefined();
  });

  it("is stale, nothing sent, when the freshly read roots are not the roots the draft was made against", () => {
    expect(build([add], { fresh: [...SAVED, root("root-3")] })).toEqual({ kind: "stale" });
    expect(build([add], { fresh: [SAVED[1], SAVED[0]] })).toEqual({ kind: "stale" });
    expect(build([add], { fresh: [root("root-1")] })).toEqual({ kind: "stale" });
  });

  it("is dropped, with the count, when a root op cannot apply to the (matching) saved roots", () => {
    const only = [root("root-1")];
    const built = build([{ kind: "rootRemove", rootId: "root-1" }], { fresh: only, saved: only });
    expect(built).toEqual({ kind: "dropped", count: 1 });
  });

  it("sends no roots at all for a draft with no root op", () => {
    const built = build([]);
    expect(built.kind).toBe("ready");
    if (built.kind !== "ready") return;
    expect("roots" in built.request).toBe(false);
  });
});
