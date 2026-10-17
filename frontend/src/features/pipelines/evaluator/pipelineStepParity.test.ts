// HEL-1581 — the Jest half of the client-evaluator parity corpus. The Scala half
// (PipelineStepParitySpec) runs every vector through InProcessPipelineEngine.executeTree and checks the
// expectation stored in the file; this runs the same files through the TypeScript evaluator, so drift on
// either side fails CI. A TS-vs-fixture-only check never satisfies parity: every expectation here was
// produced by the Scala engine.

import { clientEvaluable, evaluateStep, type RunContext } from "./evaluateStep";
import {
  evaluatePipeline,
  type NodeResult,
  type RootFrame,
  type SourceFrames,
  type StepDefinition,
} from "./evaluatePipeline";
import { BOOLEAN_LITERALS, SUPPORTED_FUNCTIONS, SUPPORTED_OPERATORS } from "./expression/compile";
import { AI_KINDS, CLIENT_HANDLERS, SERVER_KINDS } from "./steps/registry";
import { decodeRows, diffFrames, readCorpusFile, type Manifest } from "./testing/corpus";
import type { Frame } from "./value";

interface StepVector {
  name: string;
  config: unknown;
  inputRows: unknown[];
  enabled?: boolean;
  secondary?: { kind: "lane" | "source"; id?: string; rows: unknown[]; complete: boolean };
  expect?: {
    rows?: unknown[];
    error?: boolean;
    clientDeclines?: string;
    scalaRows?: unknown[];
    scalaError?: boolean;
  };
}

interface WalkVector {
  name: string;
  rootFrames: Array<{ rootId: string; rows: unknown[] }>;
  steps: StepDefinition[];
  scala: { frames?: Record<string, unknown[]>; framesWithout?: Record<string, unknown[]> };
  client: Record<string, { status: string; rows?: unknown[]; reason?: string }>;
}

const manifest = readCorpusFile<Manifest>("manifest.json");
const nonServerKinds = Object.keys(manifest.kinds).filter(
  (k) => manifest.kinds[k].class !== "server",
);
const serverKinds = Object.keys(manifest.kinds).filter((k) => manifest.kinds[k].class === "server");

function contextFor(vector: StepVector): RunContext {
  const s = vector.secondary;
  const rows = s ? (decodeRows(s.rows) as Frame) : [];
  const config = vector.config as { secondaryInput?: { stepId?: string } };
  return {
    lane: (stepId) =>
      s?.kind === "lane" && stepId === config.secondaryInput?.stepId ? rows : undefined,
    source: (id) =>
      s?.kind === "source" && id === s.id ? { rows, complete: s.complete } : undefined,
  };
}

describe("agreement checks (design Decision 4)", () => {
  it("check 2: the evaluator's kind set is the manifest's non-server set, each with a vector file of at least minVectors", () => {
    expect(Object.keys(CLIENT_HANDLERS).sort()).toEqual([...nonServerKinds].sort());
    expect([...SERVER_KINDS, ...AI_KINDS].sort()).toEqual([...serverKinds].sort());
    for (const kind of nonServerKinds) {
      const file = readCorpusFile<{ vectors: unknown[] }>(`${kind}.json`);
      expect({ kind, enough: file.vectors.length >= manifest.kinds[kind].minVectors }).toEqual({
        kind,
        enough: true,
      });
      expect({ kind, stepClass: CLIENT_HANDLERS[kind].stepClass }).toEqual({
        kind,
        stepClass: manifest.kinds[kind].class,
      });
    }
  });

  it("check 3: the compute function, operator and literal tables equal compute-expression-functions.json", () => {
    const seam = readCorpusFile<{ functions: string[]; operators: string[]; literals: string[] }>(
      "../compute-expression-functions.json",
    );
    expect([...SUPPORTED_FUNCTIONS]).toEqual([...seam.functions].sort());
    expect([...SUPPORTED_OPERATORS].sort()).toEqual([...seam.operators].sort());
    expect([...BOOLEAN_LITERALS].sort()).toEqual([...seam.literals].sort());
  });
});

describe.each(nonServerKinds)("%s step vectors", (kind) => {
  const { vectors } = readCorpusFile<{ vectors: StepVector[] }>(`${kind}.json`);

  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_name, vector) => {
    const expectation = vector.expect;
    if (!expectation) throw new Error("vector has no expectation");
    const ctx = contextFor(vector);
    const input = decodeRows(vector.inputRows) as Frame;
    const step = { id: "under-test", kind, config: vector.config };
    const { steps, roots, sources } = oneStepPipeline(vector, kind);
    const walkNode = evaluatePipeline(steps, roots, { sources }).nodes.get("under-test")!;

    if (vector.enabled === false) {
      // A disabled step is transparent: the walk, not the step evaluator, owns that rule.
      expect(walkNode.status).toBe("disabled");
      expect(
        diffFrames((walkNode as { rows: Frame }).rows, decodeRows(expectation.rows ?? [])),
      ).toBeUndefined();
      return;
    }
    const outcome = evaluateStep(step, input, ctx);
    if (expectation.clientDeclines !== undefined) {
      expect(clientEvaluable(step, ctx)).toEqual({ ok: false, reason: expectation.clientDeclines });
      expect(outcome.status === "needsServer" || outcome.status === "notPreviewed").toBe(true);
      if (outcome.status === "needsServer") expect(outcome.reason).toBe(expectation.clientDeclines);
      expect(walkNode.status).toBe(outcome.status);
      return;
    }
    expect(clientEvaluable(step, ctx)).toEqual({ ok: true });
    if (expectation.error) {
      // The reason is not compared with Scala's message (only THAT the step fails is a parity property), but
      // a failure must be a configuration problem, never an evaluator exception.
      expect(outcome).toMatchObject({ status: "error" });
      expect(outcome).not.toHaveProperty("internal");
      expect(walkNode.status).toBe("error");
      return;
    }
    if (outcome.status !== "ok") throw new Error(`expected rows, got ${JSON.stringify(outcome)}`);
    expect(diffFrames(outcome.rows, decodeRows(expectation.rows ?? []))).toBeUndefined();
    // the walk reaches the same frame through its own plumbing
    expect(walkNode.status).toBe("ok");
    expect(diffFrames((walkNode as { rows: Frame }).rows, outcome.rows)).toBeUndefined();
  });
});

/** The vector as a one-step pipeline (plus a second root and a `limit 0` step for a lane secondary), as the oracle builds it. */
function oneStepPipeline(
  vector: StepVector,
  kind: string,
): { steps: StepDefinition[]; roots: RootFrame[]; sources: SourceFrames } {
  const under: StepDefinition = {
    id: "under-test",
    kind,
    parentStepId: null,
    rootId: "main",
    position: 0,
    enabled: vector.enabled !== false,
    config: vector.config,
  };
  const roots: RootFrame[] = [{ rootId: "main", rows: decodeRows(vector.inputRows) as Frame }];
  const steps = [under];
  const sources: Record<string, { rows: Frame; complete: boolean }> = {};
  const s = vector.secondary;
  if (s?.kind === "lane") {
    const stepId = (vector.config as { secondaryInput: { stepId: string } }).secondaryInput.stepId;
    roots.push({ rootId: "lane-root", rows: decodeRows(s.rows) as Frame });
    steps.push({
      id: stepId,
      kind: "limit",
      parentStepId: null,
      rootId: "lane-root",
      position: 0,
      enabled: true,
      config: { count: 0 },
    });
  } else if (s?.kind === "source") {
    sources[s.id!] = { rows: decodeRows(s.rows) as Frame, complete: s.complete };
  }
  return { steps, roots, sources };
}

function statusOf(node: NodeResult): string {
  return node.status;
}

describe("walk vectors", () => {
  const { vectors } = readCorpusFile<{ vectors: WalkVector[] }>("pipelines.json");

  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_name, vector) => {
    const walk = evaluatePipeline(
      vector.steps,
      vector.rootFrames.map((r) => ({ rootId: r.rootId, rows: decodeRows(r.rows) as Frame })),
    );
    expect([...walk.nodes.keys()].sort()).toEqual(Object.keys(vector.client).sort());
    const scalaFrames = { ...vector.scala.frames, ...vector.scala.framesWithout };
    for (const [id, expected] of Object.entries(vector.client)) {
      const node = walk.nodes.get(id)!;
      expect({ id, status: statusOf(node) }).toEqual({ id, status: expected.status });
      if (expected.reason !== undefined)
        expect((node as { reason?: string }).reason).toBe(expected.reason);
      if (expected.rows !== undefined) {
        const actual = (node as { rows: Frame }).rows;
        expect({ id, diff: diffFrames(actual, decodeRows(expected.rows)) }).toEqual({
          id,
          diff: undefined,
        });
        // every client rows value must equal a Scala-verified frame in the same vector
        expect({ id, hasFrame: id in scalaFrames }).toEqual({ id, hasFrame: true });
        expect({ id, diff: diffFrames(actual, decodeRows(scalaFrames[id])) }).toEqual({
          id,
          diff: undefined,
        });
      }
    }
  });
});
