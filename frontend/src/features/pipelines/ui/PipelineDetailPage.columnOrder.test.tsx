// HEL-1732 (design.md D6): the "Rows after step N" grid's column ORDER on the real page. A draft over a six-column source whose
// sample rows arrive in the server's hash key order: the shown step and a descendant step show the declared order, a rename sits where
// the original was, a draft-inserted step shows its parent's columns then its own, and none of it sends a request.

import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  analyzePipeline,
  fetchRunHistory,
  fetchStepPreview,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
  updatePipelineStep,
} from "../services/pipelineService";
import { postDraftPreview } from "../services/draftPreviewClient";
import { chunkedResponse } from "../services/draftPreviewTestSupport";
import type { DraftPreviewRequest } from "../types/draftPreview";
import { listOutputs } from "../services/outputService";
import { httpClient } from "../../../services/httpClient";
import type { SourceSample } from "../../sources/types/dataSource";
import type { PipelineStep, SchemaField } from "../types/pipelineStep";
import {
  SPINE_PIPELINE,
  analyzeFor,
  makeSpineStore,
  renderSpinePageSettled,
  wireStep,
} from "./pipelineSpineTestKit";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  runPipeline: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  updatePipeline: jest.fn(),
  updatePipelineStep: jest.fn(),
  createPipelineStep: jest.fn(),
  deletePipelineStep: jest.fn(),
  analyzePipeline: jest.fn(),
  fetchStepPreview: jest.fn(),
  getPipelineSchedule: jest.fn(),
  putPipelineSchedule: jest.fn(),
  deletePipelineSchedule: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  expandPipelineShape: jest.fn(),
  reorderPipelineSteps: jest.fn(),
  updatePipelineStepEnabled: jest.fn(),
  duplicatePipelineStep: jest.fn(),
  listPipelinePermissions: jest.fn(),
  grantPipelinePermission: jest.fn(),
  revokePipelinePermission: jest.fn(),
  addPipelineRoot: jest.fn(),
  removePipelineRoot: jest.fn(),
}));

jest.mock("../services/draftPreviewClient", () => ({
  ...jest.requireActual("../services/draftPreviewClient"),
  postDraftPreview: jest.fn(),
}));

jest.mock("../services/outputService", () => ({
  ...jest.requireActual("../services/outputService"),
  previewOutputs: jest.fn(),
  listOutputs: jest.fn(),
}));

const DECLARED = ["id", "region", "status", "amount", "total", "created"];
const SCHEMA: SchemaField[] = DECLARED.map((name) => ({
  name,
  type: name === "id" || name === "amount" || name === "total" ? "integer" : "string",
}));
// Row keys in the hash order the /sample endpoint delivers (not the declared order).
const hashRow = (i: number) => ({
  total: 100 + i,
  amount: 10 + i,
  id: i,
  status: i % 2 ? "ok" : "bad",
  region: "east",
  created: `2026-09-0${i + 1}`,
});
const SAMPLE: SourceSample = {
  rows: [0, 1, 2, 3, 4].map(hashRow),
  capturedAt: "2026-10-19T00:00:00Z",
  sourceRowCount: 5,
  truncated: false,
  live: false,
};
const STEPS: PipelineStep[] = [
  wireStep("s1", "filter", {
    combinator: "and",
    conditions: [{ field: "amount", operator: ">=", value: "0" }],
  }),
  wireStep("s2", "rename", { renames: {} }, { parentStepId: "s1", position: 0, rootId: undefined }),
  wireStep(
    "s3",
    "compute",
    { column: "margin", expression: "$amount - $total", type: "float" },
    { parentStepId: "s2", position: 0, rootId: undefined },
  ),
  // The client cannot evaluate this one: its rows come from the draft-preview server, in Scala Map hash order.
  wireStep(
    "s4",
    "convertformat",
    { field: "status", from: "text", to: "markdown" },
    { parentStepId: "s3", position: 0, rootId: undefined },
  ),
];

// The server's answer for s4: every step line, then the requested step's rows with the keys in hash order.
function fakeServer(request: DraftPreviewRequest): Response {
  const lines = [
    ...request.steps.map((st) => ({ type: "step", step: st.id, count: 5, schema: [] })),
    {
      type: "rows",
      step: request.rowsStepId,
      available: true,
      count: 1,
      truncated: false,
      rows: [
        {
          margin: 1.5,
          total: { $int: 100 },
          id: { $int: 0 },
          body: "x",
          created: "2026-09-01",
          status: "ok",
          amount: { $int: 10 },
          area: "east",
        },
      ],
    },
  ];
  return chunkedResponse([lines.map((l) => JSON.stringify(l)).join("\n") + "\n"]);
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

beforeEach(() => {
  jest.mocked(listOutputs).mockResolvedValue([]);
  jest.mocked(httpClient.get).mockResolvedValue({ data: { columns: [], capabilities: {} } });
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  jest.mocked(getPipelineById).mockResolvedValue(SPINE_PIPELINE);
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest
    .mocked(getPipelineSchedule)
    .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
  jest.mocked(getPipelineSteps).mockResolvedValue(STEPS);
  jest.mocked(analyzePipeline).mockResolvedValue(
    analyzeFor(STEPS, {
      sourceSchemas: [{ rootId: "root-1", sourceSchema: SCHEMA }],
      steps: STEPS.map((s, i) => ({
        id: s.id,
        position: i,
        type: s.type,
        config: s.config,
        inputSchema: SCHEMA,
        outputSchema:
          s.id === "s3" || s.id === "s4" ? [...SCHEMA, { name: "margin", type: "float" }] : SCHEMA,
      })) as never,
    }),
  );
  jest.mocked(fetchStepPreview).mockResolvedValue({ rows: [], rowCount: 0 });
  jest
    .mocked(postDraftPreview)
    .mockImplementation((_id, request) => Promise.resolve(fakeServer(request)));
});

afterEach(() => {
  jest.clearAllMocks();
});

/** The grid's headers for the step table on screen, without the type captions. */
function headers(): string[] {
  const table = screen.getByRole("region", { name: /^Rows after step/ });
  return Array.from(table.querySelectorAll("thead th")).map((th) => {
    const clone = th.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".ui-data-grid__th-type").forEach((el) => el.remove());
    return (clone.textContent ?? "").trim();
  });
}

async function openDraftOnRename() {
  const store = makeSpineStore({ samples: { "src-1": SAMPLE }, outputs: [] });
  await renderSpinePageSettled(store);
  fireEvent.click(await screen.findByRole("button", { name: /^Step 2:/ }));
  await screen.findByRole("region", { name: "Step 2 Rename column" });
  return store;
}

const requestCounts = () => ({
  post: jest.mocked(httpClient.post).mock.calls.length,
  get: jest.mocked(httpClient.get).mock.calls.length,
  patch: jest.mocked(httpClient.patch).mock.calls.length,
  analyze: jest.mocked(analyzePipeline).mock.calls.length,
  preview: jest.mocked(fetchStepPreview).mock.calls.length,
  stepUpdate: jest.mocked(updatePipelineStep).mock.calls.length,
});

describe("the draft grid's column order on the page (HEL-1732)", () => {
  it("a rename in the shown step keeps its position, a descendant step keeps it too, and the edit sends no request", async () => {
    await openDraftOnRename();
    const before = requestCounts();

    fireEvent.change(screen.getByLabelText("New name for region"), { target: { value: "area" } });
    await screen.findByText("Draft · unsaved changes");
    await waitFor(() => expect(headers()).toContain("area"));

    // The shown step (the rename): the declared order with `region` renamed in place.
    expect(headers()).toEqual(["id", "area", "status", "amount", "total", "created"]);

    // A descendant step (the compute below it) keeps `area` where it is and appends its own column.
    fireEvent.click(screen.getByRole("button", { name: /^Step 3:/ }));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Rows after step 3" })).toBeInTheDocument(),
    );
    await waitFor(() => expect(headers()).toContain("margin"));
    expect(headers()).toEqual(["id", "area", "status", "amount", "total", "created", "margin"]);

    // The first step is the declared order, not the sample's.
    fireEvent.click(screen.getByRole("button", { name: /^Step 1:/ }));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Rows after step 1" })).toBeInTheDocument(),
    );
    expect(headers()).toEqual(DECLARED);

    expect(requestCounts()).toEqual(before);
  });

  it("a server-resolved step below an edited step shows its nearest client ancestor's order, its new column after (HEL-1732 D3b)", async () => {
    await openDraftOnRename();
    fireEvent.change(screen.getByLabelText("New name for region"), { target: { value: "area" } });
    await screen.findByText("Draft · unsaved changes");

    fireEvent.click(screen.getByRole("button", { name: /^Step 4:/ }));
    await waitFor(() => expect(headers()).toContain("body"));
    // The server's keys were margin,total,id,body,...; the ancestor (compute) shows id,area,...,margin and the new `body` follows.
    expect(headers()).toEqual([
      "id",
      "area",
      "status",
      "amount",
      "total",
      "created",
      "margin",
      "body",
    ]);
  });

  it("the first edit after the re-key flashes only the rows that changed: the saved and draft frames share one key order", async () => {
    const store = makeSpineStore({ samples: { "src-1": SAMPLE }, outputs: [] });
    await renderSpinePageSettled(store);
    await screen.findByRole("region", { name: "Rows after step 1" });
    // Tighten the filter: every row that remains was already in the saved frame, so nothing is new.
    fireEvent.change(screen.getByDisplayValue("0"), { target: { value: "12" } });
    await screen.findByText("Draft · unsaved changes");
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    expect(document.querySelectorAll("td.step-preview__cell--changed")).toHaveLength(0);
  });
});
