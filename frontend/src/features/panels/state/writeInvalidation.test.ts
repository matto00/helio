import { applyCombinedProposal } from "../../proposals/services/combinedProposalService";
import {
  buildFirstRunDashboard,
  buildTemplateDashboard,
} from "../../onboarding/services/firstRunService";
import { applyPatchSet, undoPatchSet } from "../../patchSets/services/patchSetService";
import { applyPipelineProposal } from "../../pipelines/services/pipelineProposalService";
import { createOutput, deleteOutput, updateOutput } from "../../pipelines/services/outputService";
import {
  addPipelineRoot,
  createPipelineStep,
  deletePipeline,
  deletePipelineStep,
  duplicatePipelineStep,
  removePipelineRoot,
  reorderPipelineSteps,
  runPipeline,
  updatePipeline,
  updatePipelineStep,
  updatePipelineStepEnabled,
} from "../../pipelines/services/pipelineService";
import { httpClient } from "../../../services/httpClient";
import { logout } from "../../auth/state/authSlice";
import { currentGeneration, registerOutputPipeline } from "./outputFreshness";

// HEL-1392 design.md D4 -- every client write that can change an Output's metadata or rows
// invalidates what a remounting card would otherwise reuse, and only what it can touch.
jest.mock("../../../services/httpClient", () => ({
  httpClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const http = jest.mocked(httpClient);
const ok = { data: { id: "x", config: {}, steps: [], items: [], type: "filter" } };

beforeEach(() => {
  jest.clearAllMocks();
  for (const verb of ["get", "post", "patch", "put", "delete"] as const) {
    http[verb].mockResolvedValue(ok);
  }
  registerOutputPipeline("o1", "p1");
  registerOutputPipeline("o2", "p2");
});

const swallow = (call: () => Promise<unknown>) => call().catch(() => undefined);

const outputWrites: [string, () => Promise<unknown>][] = [
  ["updateOutput", () => updateOutput("o1", { name: "n" } as never)],
  ["deleteOutput", () => deleteOutput("o1")],
];

const pipelineWrites: [string, () => Promise<unknown>][] = [
  ["createOutput", () => createOutput("p1", { kind: "table", name: "n" } as never)],
  ["updatePipeline", () => updatePipeline("p1", "n")],
  ["deletePipeline", () => deletePipeline("p1")],
  ["createPipelineStep", () => createPipelineStep("p1", "filter" as never, {} as never)],
  ["addPipelineRoot", () => addPipelineRoot("p1", { sourceId: "s" })],
  ["removePipelineRoot", () => removePipelineRoot("p1", "r")],
  ["reorderPipelineSteps", () => reorderPipelineSteps("p1", ["a"])],
  ["runPipeline", () => runPipeline("p1")],
  ["runPipeline (dry)", () => runPipeline("p1", true)],
];

const globalWrites: [string, () => Promise<unknown>][] = [
  ["updatePipelineStep", () => updatePipelineStep("s", {} as never)],
  ["updatePipelineStepEnabled", () => updatePipelineStepEnabled("s", true)],
  ["duplicatePipelineStep", () => duplicatePipelineStep("s")],
  ["deletePipelineStep", () => deletePipelineStep("s")],
  ["applyPatchSet", () => applyPatchSet({} as never)],
  ["undoPatchSet", () => undoPatchSet("a")],
  ["applyCombinedProposal", () => applyCombinedProposal({} as never)],
  ["applyPipelineProposal", () => applyPipelineProposal({} as never)],
  ["buildFirstRunDashboard", () => buildFirstRunDashboard("s")],
  ["buildTemplateDashboard", () => buildTemplateDashboard("t")],
];

describe("write paths invalidate reusable Output data", () => {
  it.each(outputWrites)("%s invalidates that Output only", async (_name, write) => {
    const [a, b] = [currentGeneration("o1"), currentGeneration("o2")];
    await swallow(write);
    expect(currentGeneration("o1")).toBeGreaterThan(a);
    expect(currentGeneration("o2")).toBe(b);
  });

  it.each(pipelineWrites)("%s invalidates that pipeline's Outputs only", async (_name, write) => {
    const [a, b] = [currentGeneration("o1"), currentGeneration("o2")];
    await swallow(write);
    expect(currentGeneration("o1")).toBeGreaterThan(a);
    expect(currentGeneration("o2")).toBe(b);
  });

  it.each(globalWrites)("%s invalidates every Output", async (_name, write) => {
    const [a, b] = [currentGeneration("o1"), currentGeneration("o2")];
    await swallow(write);
    expect(currentGeneration("o1")).toBeGreaterThan(a);
    expect(currentGeneration("o2")).toBeGreaterThan(b);
  });

  it("a failed write invalidates nothing", async () => {
    http.patch.mockRejectedValueOnce(new Error("500"));
    const before = currentGeneration("o1");
    await swallow(() => updateOutput("o1", { name: "n" } as never));
    expect(currentGeneration("o1")).toBe(before);
  });

  it("logout forgets every generation, so the next user starts clean", async () => {
    await swallow(() => updateOutput("o1", { name: "n" } as never));
    expect(currentGeneration("o1")).toBeGreaterThan(0);
    http.post.mockResolvedValue(ok);
    const dispatch = jest.fn();
    await logout()(dispatch, () => ({}), undefined);
    expect(currentGeneration("o1")).toBe(0);
  });
});
