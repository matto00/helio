import { evaluatePipeline, type Frame, type StepDefinition, type WalkResult } from "../evaluator";
import { decodeRow } from "../evaluator/wire";
import {
  NOT_PREVIEWED_AI,
  NO_TRANSPORT,
  createViewTracker,
  mapStepView,
  type ServerStepResult,
  type TransportView,
} from "./draftStepView";

const frame = (...rows: Array<Record<string, unknown>>): Frame => rows.map(decodeRow);
const ROOT = frame({ n: 1 }, { n: 2 }, { n: 3 });

const def = (id: string, kind: string, parent: string | null, config: unknown): StepDefinition => ({
  id,
  kind,
  parentStepId: parent,
  rootId: parent === null ? "r1" : null,
  position: 0,
  enabled: true,
  config,
});
const limit = (n: number) => ({ count: n });
const walk = (...defs: StepDefinition[]): WalkResult =>
  evaluatePipeline(defs, [{ rootId: "r1", rows: ROOT }]);

function transport(
  over: Partial<Omit<TransportView, "results">> & {
    results?: Array<[string, ServerStepResult]>;
  } = {},
): TransportView {
  return { ...NO_TRANSPORT, ...over, results: new Map(over.results ?? []) };
}

const view = (
  stepId: string,
  w: WalkResult,
  t: TransportView = NO_TRANSPORT,
  lastGood?: { count: number; rows: Frame | null },
) =>
  mapStepView({
    stepId,
    node: w.nodes.get(stepId),
    walk: w,
    transport: t,
    lastGood,
    sampleLoading: false,
  });

describe("mapStepView (design D3's table)", () => {
  it("an ok step shows its count and rows as current", () => {
    const w = walk(def("a", "limit", null, limit(2)));
    expect(view("a", w)).toMatchObject({
      status: "ok",
      count: 2,
      frameStale: false,
      message: null,
    });
  });

  it("a disabled step is ok and passes the input count through", () => {
    const w = walk({ ...def("a", "limit", null, limit(2)), enabled: false });
    expect(view("a", w)).toMatchObject({ status: "ok", count: 3 });
  });

  it("an error step shows its message and keeps its last good frame, marked stale", () => {
    const w = walk(def("a", "limit", null, { count: "x" }));
    const v = view("a", w, NO_TRANSPORT, { count: 2, rows: ROOT });
    expect(v.status).toBe("error");
    expect(v.message).toEqual(expect.any(String));
    expect(v).toMatchObject({ count: 2, frameStale: true });
  });

  it("a step downstream of an error freezes at its last good frame, status stale", () => {
    const w = walk(def("a", "limit", null, { count: "x" }), def("b", "limit", "a", limit(1)));
    expect(w.nodes.get("b")?.status).toBe("blocked");
    expect(view("b", w, NO_TRANSPORT, { count: 1, rows: ROOT })).toMatchObject({
      status: "stale",
      count: 1,
      frameStale: true,
    });
  });

  it("an AI step and everything downstream read 'not previewed (AI step)', never pending", () => {
    const w = walk(
      def("a", "analyzewithai", null, { inputField: "n", instruction: "x", outputSchema: [] }),
      def("b", "limit", "a", limit(1)),
    );
    expect(view("a", w)).toMatchObject({ status: "notPreviewed", message: NOT_PREVIEWED_AI });
    expect(view("b", w)).toMatchObject({ status: "notPreviewed", message: NOT_PREVIEWED_AI });
  });

  it("a server-only step is pending until the transport answers, with its previous frame visible and stale", () => {
    const w = walk(def("a", "convertformat", null, { field: "n", from: "csv", to: "json" }));
    expect(w.nodes.get("a")?.status).toBe("needsServer");
    expect(view("a", w, transport({ pending: true }), { count: 3, rows: ROOT })).toMatchObject({
      status: "pending",
      count: 3,
      frameStale: true,
    });
  });

  it("a step blocked behind a server-only step is pending with it, then takes the server's answer", () => {
    const w = walk(
      def("a", "convertformat", null, { field: "n", from: "csv", to: "json" }),
      def("b", "limit", "a", limit(1)),
    );
    expect(view("b", w, transport({ pending: true })).status).toBe("pending");
    expect(view("b", w, transport({ results: [["b", { kind: "ok", count: 1 }]] }))).toMatchObject({
      status: "ok",
      count: 1,
      frameStale: false,
    });
  });

  it("the server's rows line supplies the rows of the step it was asked for", () => {
    const w = walk(def("a", "convertformat", null, { field: "n", from: "csv", to: "json" }));
    const rows = frame({ n: 9 });
    const v = view(
      "a",
      w,
      transport({ results: [["a", { kind: "ok", count: 1 }]], rows: { stepId: "a", rows } }),
    );
    expect(v).toMatchObject({ status: "ok", count: 1 });
    expect(v.rows).toBe(rows);
  });

  it("a server error line is an error; an unavailable AI line is not previewed; a downstream-of-error line is stale", () => {
    const w = walk(def("a", "convertformat", null, { field: "n", from: "csv", to: "json" }));
    expect(
      view("a", w, transport({ results: [["a", { kind: "error", message: "bad" }]] })),
    ).toMatchObject({
      status: "error",
      message: "bad",
    });
    expect(
      view(
        "a",
        w,
        transport({ results: [["a", { kind: "unavailable", reason: "downstreamOfAiStep" }]] }),
      ),
    ).toMatchObject({ status: "notPreviewed", message: NOT_PREVIEWED_AI });
    expect(
      view(
        "a",
        w,
        transport({ results: [["a", { kind: "unavailable", reason: "downstreamOfError" }]] }),
      ).status,
    ).toBe("stale");
  });

  it("a failed or too-large request turns the unanswered step into an error that keeps its frame", () => {
    const w = walk(def("a", "convertformat", null, { field: "n", from: "csv", to: "json" }));
    expect(
      view("a", w, transport({ failure: { kind: "tooLarge", message: "Too large" } }), {
        count: 3,
        rows: ROOT,
      }),
    ).toMatchObject({ status: "error", message: "Too large", frameStale: true });
  });

  it("a step whose root has no sample yet is pending while it loads and an error once it has failed", () => {
    const w = evaluatePipeline([def("a", "limit", null, limit(1))], []);
    const input = {
      stepId: "a",
      node: w.nodes.get("a"),
      walk: w,
      transport: NO_TRANSPORT,
      lastGood: undefined,
    };
    expect(mapStepView({ ...input, sampleLoading: true }).status).toBe("pending");
    expect(mapStepView({ ...input, sampleLoading: false }).status).toBe("error");
  });
});

describe("createViewTracker", () => {
  it("seeds a step's last good frame from the saved walk, so a first edit that breaks upstream still shows the old count downstream", () => {
    const saved = walk(def("a", "limit", null, limit(2)), def("b", "limit", "a", limit(1)));
    const broken = walk(def("a", "limit", null, { count: "x" }), def("b", "limit", "a", limit(1)));
    const views = createViewTracker().derive(broken, saved, NO_TRANSPORT, false);
    expect(views.get("a")?.status).toBe("error");
    expect(views.get("b")).toMatchObject({ status: "stale", count: 1, frameStale: true });
  });

  it("remembers the latest good frame across edits and forgets everything on reset", () => {
    const tracker = createViewTracker();
    const good = walk(def("a", "limit", null, limit(2)));
    const bad = walk(def("a", "limit", null, { count: "x" }));
    tracker.derive(good, null, NO_TRANSPORT, false);
    expect(tracker.derive(bad, null, NO_TRANSPORT, false).get("a")).toMatchObject({
      count: 2,
      frameStale: true,
    });
    tracker.reset();
    expect(tracker.derive(bad, null, NO_TRANSPORT, false).get("a")).toMatchObject({
      count: null,
      frameStale: false,
    });
  });
});
