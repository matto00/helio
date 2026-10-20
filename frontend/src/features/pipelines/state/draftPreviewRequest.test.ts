import { evaluatePipeline, type Frame, type StepDefinition } from "../evaluator";
import { decodeRow } from "../evaluator/wire";
import { buildDraftPreviewRequest } from "./draftPreviewRequest";

const frame = (...rows: Array<Record<string, unknown>>): Frame => rows.map(decodeRow);
const ROOTS = [{ rootId: "r1", rows: frame({ n: 1 }, { n: 2 }) }];
const def = (id: string, kind: string, parent: string | null, config: unknown): StepDefinition => ({
  id,
  kind,
  parentStepId: parent,
  rootId: parent === null ? "r1" : null,
  position: 0,
  enabled: true,
  config,
});
const CONVERT = { field: "n", from: "csv", to: "json" };

function build(defs: StepDefinition[], focusStepId: string | null = null, sources = {}) {
  const walk = evaluatePipeline(defs, ROOTS, { sources });
  return buildDraftPreviewRequest({ defs, walk, rootFrames: ROOTS, sources, focusStepId });
}

describe("buildDraftPreviewRequest", () => {
  it("asks nothing when every step is client-evaluable", () => {
    expect(build([def("a", "limit", null, { count: 1 })])).toBeNull();
  });

  it("sends the server step with the client's frame as a synthetic root, and only the steps from there down", () => {
    const built = build([
      def("a", "limit", null, { count: 2 }),
      def("b", "convertformat", "a", CONVERT),
      def("c", "limit", "b", { count: 1 }),
    ])!;
    expect(built.request.steps.map((s) => s.id)).toEqual(["b", "c"]);
    expect(built.request.roots).toHaveLength(1);
    expect(built.request.roots[0].id).toBe("frame:a");
    expect(built.request.roots[0].rows).toEqual(
      [{ n: 1 }, { n: 2 }].map((r) => expect.objectContaining(r)),
    );
    const b = built.request.steps[0];
    expect(b.rootId).toBe("frame:a");
    expect(b.parentStepId).toBeUndefined();
    expect(built.request.steps[1].parentStepId).toBe("b");
    expect(built.stepIds).toEqual(new Set(["b", "c"]));
  });

  it("names the step to return rows for: the focused server step, else the first one", () => {
    const defs = [def("a", "convertformat", null, CONVERT), def("b", "limit", "a", { count: 1 })];
    expect(build(defs, "b")!.request.rowsStepId).toBe("b");
    expect(build(defs, "zzz")!.request.rowsStepId).toBe("a");
    expect(build(defs, null)!.request.rowsStepId).toBe("a");
  });

  it("changes its key when an input frame changes even though no server step's config did", () => {
    const defs1 = [def("a", "limit", null, { count: 1 }), def("b", "convertformat", "a", CONVERT)];
    const defs2 = [def("a", "limit", null, { count: 2 }), def("b", "convertformat", "a", CONVERT)];
    const walk1 = evaluatePipeline(defs1, ROOTS);
    const args = { rootFrames: ROOTS, sources: {}, focusStepId: null };
    const k1 = buildDraftPreviewRequest({ defs: defs1, walk: walk1, ...args })!.key;
    const k2 = build(defs2)!.key;
    expect(k1).not.toBe(k2);
    expect(buildDraftPreviewRequest({ defs: defs1, walk: walk1, ...args })!.key).toBe(k1);
  });

  it("supplies a lane secondary that lives outside the request as a lanes frame", () => {
    const join = def("j", "join", "a", {
      secondaryInput: { kind: "lane", stepId: "x" },
      joinKey: "n",
      joinType: "inner",
    });
    const defs = [
      def("a", "convertformat", null, CONVERT),
      def("x", "limit", null, { count: 1 }),
      join,
    ];
    const built = build(defs)!;
    expect(Object.keys(built.request.lanes ?? {})).toEqual(["x"]);
    expect(built.request.steps.map((s) => s.id)).toEqual(["a", "j"]);
  });
});
