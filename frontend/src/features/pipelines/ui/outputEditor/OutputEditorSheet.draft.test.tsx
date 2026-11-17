// HEL-1733 (design.md D5): the Output editor sheet while a pipeline draft exists. Its column types are the server's projection of the DRAFT
// (`analyze-proposal`), never inferred; Save records a draft entry through the page handlers (no thunk, no write request); a projection
// that is unavailable blocks the kinds with a type-restricted slot and no others.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { outputsReducer } from "../../state/outputsSlice";
import { pipelineStepToStep } from "../../state/stepNarrowing";
import type { PipelineRoot } from "../../types/pipelineStep";
import { threeSteps } from "../pipelineSpineTestKit";
import type { OutputActions } from "../../hooks/useOutputImmediateActions";
import { OutputEditorSheet } from "./OutputEditorSheet";
import {
  CHECKING_TYPES_HINT,
  TYPES_UNAVAILABLE_HINT,
  type OutputSheetDraft,
} from "./outputSheetDraft";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const http = jest.mocked(httpClient);

const roots: PipelineRoot[] = [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Sales" }];
const steps = threeSteps().map(pipelineStepToStep);

function projection(nodeId: string, schema: { name: string; type: string }[]) {
  return {
    data: {
      sourceSchemas: [{ rootId: "root-1", dataSourceName: "Sales", sourceSchema: [] }],
      steps: [{ id: nodeId, outputSchema: schema }],
      outputs: [],
    },
  };
}

function makeDraft(over: Partial<OutputSheetDraft> = {}): OutputSheetDraft {
  return {
    pipelineName: "Revenue rollup",
    roots,
    frames: null,
    onNodeChange: jest.fn(),
    ...over,
  };
}

const makeActions = (over: Partial<OutputActions> = {}): OutputActions => ({
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  ...over,
});

function renderSheet(
  draft: OutputSheetDraft,
  onClose = jest.fn(),
  actions: OutputActions = makeActions(),
) {
  const store = configureStore({ reducer: { outputs: outputsReducer } });
  render(
    <MemoryRouter>
      <Provider store={store}>
        <OutputEditorSheet
          open
          onClose={onClose}
          pipelineId="pipe-1"
          output={null}
          createTargetStepId="s2"
          steps={steps}
          draft={draft}
          actions={actions}
        />
      </Provider>
    </MemoryRouter>,
  );
  return onClose;
}

const pickKind = async (label: string) => {
  fireEvent.click(await screen.findByRole("combobox", { name: "Output kind" }));
  fireEvent.click(await screen.findByRole("option", { name: label }));
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  http.get.mockResolvedValue({ data: { columns: [], capabilities: {} } });
});

describe("the sheet in a draft reads the server's projection of the draft", () => {
  it("(a) offers a column the draft cast to a number for a histogram field, and not one that stayed text", async () => {
    http.post.mockResolvedValue(
      projection("s2", [
        { name: "duration_s", type: "integer" },
        { name: "status", type: "string" },
      ]),
    );
    renderSheet(makeDraft());
    await waitFor(() => expect(screen.queryByText(CHECKING_TYPES_HINT)).toBeNull());
    fireEvent.click(screen.getByRole("combobox", { name: "Chart type" }));
    fireEvent.click(await screen.findByRole("option", { name: "Histogram" }));
    fireEvent.click(await screen.findByRole("combobox", { name: "Histogram field" }));
    expect(await screen.findByRole("option", { name: "duration_s" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "status" })).toBeNull();
  });

  it("(b) a column the draft no longer types as a number is not offered", async () => {
    http.post.mockResolvedValue(projection("s2", [{ name: "duration_s", type: "string" }]));
    renderSheet(makeDraft());
    await waitFor(() => expect(screen.queryByText(CHECKING_TYPES_HINT)).toBeNull());
    fireEvent.click(screen.getByRole("combobox", { name: "Chart type" }));
    fireEvent.click(await screen.findByRole("option", { name: "Histogram" }));
    expect(screen.getByRole("combobox", { name: "Histogram field" })).toBeDisabled();
  });

  it("(g) the request carries pipelineName, every step's enabled flag, and no temp step; and no stored-step capabilities are asked for", async () => {
    http.post.mockResolvedValue(projection("s2", [{ name: "a", type: "string" }]));
    renderSheet(makeDraft());
    await waitFor(() => expect(http.post).toHaveBeenCalled());
    const [url, body] = http.post.mock.calls[0] as [
      string,
      { pipelineName: string; steps: { clientId: string; enabled: boolean }[] },
    ];
    expect(url).toBe("/api/pipelines/analyze-proposal");
    expect(body.pipelineName).toBe("Revenue rollup");
    expect(body.steps.map((s) => s.clientId)).toEqual(["s1", "s2", "s3"]);
    expect(body.steps.every((s) => typeof s.enabled === "boolean")).toBe(true);
    expect(http.get.mock.calls.some(([u]) => String(u).includes("/capabilities"))).toBe(false);
  });

  it("(e) an unavailable projection disables a chart Save with the reason, and leaves a markdown Save enabled", async () => {
    http.post.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    renderSheet(makeDraft());
    await screen.findByText(TYPES_UNAVAILABLE_HINT);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await pickKind("Markdown");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(screen.queryByText(TYPES_UNAVAILABLE_HINT)).toBeNull();
  });
});

describe("the sheet in a draft: the rest of the typed-schema cases (HEL-1733 D5)", () => {
  const histogramOptions = async () => {
    await waitFor(() => expect(screen.queryByText(CHECKING_TYPES_HINT)).toBeNull());
    fireEvent.click(screen.getByRole("combobox", { name: "Chart type" }));
    fireEvent.click(await screen.findByRole("option", { name: "Histogram" }));
    return screen.getByRole("combobox", { name: "Histogram field" });
  };

  it("(c) an unedited saved step below an edited one uses the projection, never its saved capabilities", async () => {
    http.get.mockResolvedValue({
      data: {
        columns: [{ name: "saved_col", dataType: "integer", nullable: false }],
        capabilities: { chart: { eligibleColumns: { yAxis: ["saved_col"] } } },
      },
    });
    http.post.mockResolvedValue(projection("s2", [{ name: "from_draft", type: "float" }]));
    renderSheet(makeDraft());
    fireEvent.click(await histogramOptions());
    expect(await screen.findByRole("option", { name: "from_draft" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "saved_col" })).toBeNull();
  });

  it("(d) a column the draft renamed carries its type", async () => {
    http.post.mockResolvedValue(projection("s2", [{ name: "renamed_n", type: "integer" }]));
    renderSheet(makeDraft());
    fireEvent.click(await histogramOptions());
    expect(await screen.findByRole("option", { name: "renamed_n" })).toBeInTheDocument();
  });

  it.each([
    ["404 (an editor grantee who does not own the root source)", 404],
    ["500 (a step config that does not decode)", 500],
  ])("(e) a %s disables a chart Save and leaves a markdown Save enabled", async (_name, status) => {
    http.post.mockRejectedValue({ isAxiosError: true, response: { status } });
    renderSheet(makeDraft());
    await screen.findByText(TYPES_UNAVAILABLE_HINT);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await pickKind("Markdown");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  });

  it("(wiring) changing the Step picker to a draft-new step reports the node, and the columns become that step's", async () => {
    const fresh = { ...steps[1], id: "draft-new1", label: "Fresh limit" };
    http.post.mockResolvedValue({
      data: {
        sourceSchemas: [],
        steps: [
          { id: "s2", outputSchema: [{ name: "old_col", type: "integer" }] },
          { id: "draft-new1", outputSchema: [{ name: "new_col", type: "integer" }] },
        ],
        outputs: [],
      },
    });
    const draft = makeDraft();
    const store = configureStore({ reducer: { outputs: outputsReducer } });
    render(
      <MemoryRouter>
        <Provider store={store}>
          <OutputEditorSheet
            open
            onClose={jest.fn()}
            pipelineId="pipe-1"
            output={null}
            createTargetStepId="s2"
            steps={[...steps, fresh]}
            draft={draft}
            actions={makeActions()}
          />
        </Provider>
      </MemoryRouter>,
    );
    fireEvent.click(await histogramOptions());
    expect(await screen.findByRole("option", { name: "old_col" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("combobox", { name: "Target step" }));
    fireEvent.click(await screen.findByRole("option", { name: "Fresh limit" }));
    expect(draft.onNodeChange).toHaveBeenCalledWith("draft-new1");
    await waitFor(() => expect(screen.queryByText(CHECKING_TYPES_HINT)).toBeNull());
    fireEvent.click(await screen.findByRole("combobox", { name: "Histogram field" }));
    expect(await screen.findByRole("option", { name: "new_col" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "old_col" })).toBeNull();
  });
});

describe("Save and Delete record draft entries", () => {
  it("Save of a create hands the page the node, kind, name and config, and writes nothing", async () => {
    http.post.mockResolvedValue(projection("s2", [{ name: "a", type: "string" }]));
    const draft = makeDraft();
    const actions = makeActions();
    const onClose = renderSheet(draft, jest.fn(), actions);
    await pickKind("Table");
    await waitFor(() => expect(screen.queryByText(CHECKING_TYPES_HINT)).toBeNull());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  My table " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1));
    expect(actions.create).toHaveBeenCalledWith(
      expect.objectContaining({ nodeStepId: "s2", kind: "table", name: "My table" }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(http.patch).not.toHaveBeenCalled();
    expect(http.delete).not.toHaveBeenCalled();
    expect(
      http.post.mock.calls.every(([u]) => String(u) === "/api/pipelines/analyze-proposal"),
    ).toBe(true);
  });

  it("a page handler that throws (several sources, no step) shows its message and keeps the sheet open", async () => {
    http.post.mockResolvedValue(projection("s2", [{ name: "a", type: "string" }]));
    const actions = makeActions({
      create: jest.fn(() => {
        throw new Error("Pick a step: this pipeline has several sources.");
      }),
    });
    const onClose = renderSheet(makeDraft(), jest.fn(), actions);
    await pickKind("Table");
    await waitFor(() => expect(screen.queryByText(CHECKING_TYPES_HINT)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/several sources/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
