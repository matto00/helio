// HEL-402 — "Add Outputs from a shape" picker + params form + submit flow. Covers
// shape selection → per-dataType widget rendering → submit → seeded steps,
// plus the two non-silent-failure paths the ticket exists to guard against
// (HEL-336 lookup-picker defect): a 422/404 from `/expand` shown inline with
// the modal kept open, and a client-side JSON-parse failure that never even
// calls the endpoint.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ShapePickerModal } from "./ShapePickerModal";
import { expandPipelineShape, getPipelineShapeCatalog } from "../../services/pipelineService";
import type {
  ExpandPipelineShapeResponse,
  PipelineShapeCatalogEntry,
} from "../../types/pipelineShape";

jest.mock("../../services/pipelineService", () => ({
  getPipelineShapeCatalog: jest.fn(),
  expandPipelineShape: jest.fn(),
}));

const getPipelineShapeCatalogMock = jest.mocked(getPipelineShapeCatalog);
const expandPipelineShapeMock = jest.mocked(expandPipelineShape);

const singleRowShape: PipelineShapeCatalogEntry = {
  id: "single-row",
  label: "Single row",
  description: "Reduces a source to exactly one row.",
  paramsSchema: [
    {
      name: "mode",
      label: "Mode",
      dataType: "string",
      required: true,
      description: 'Either "aggregate" or "filter".',
    },
    {
      name: "measures",
      label: "Measures",
      dataType: "object[]",
      required: false,
      description: "Non-empty array of { fn, field, alias }.",
    },
  ],
  outputContract: { rowCount: { kind: "exactly-one" }, description: "" },
};

const topNShape: PipelineShapeCatalogEntry = {
  id: "top-n",
  label: "Top N",
  description: "Sorts and limits to the top N rows.",
  paramsSchema: [
    { name: "measure", label: "Measure", dataType: "string", required: true, description: "" },
    { name: "direction", label: "Direction", dataType: "string", required: true, description: "" },
    { name: "n", label: "N", dataType: "integer", required: true, description: "" },
    { name: "ties", label: "Ties", dataType: "string", required: false, description: "" },
  ],
  outputContract: {
    rowCount: { kind: "at-most-param", paramName: "n" },
    description: "",
  },
};

const catalog = [singleRowShape, topNShape];

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

beforeEach(() => {
  getPipelineShapeCatalogMock.mockResolvedValue(catalog);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("ShapePickerModal", () => {
  it("lists every catalog entry with its label and description", async () => {
    render(<ShapePickerModal onClose={jest.fn()} onSeedSteps={jest.fn()} />);

    expect(await screen.findByText("Single row")).toBeInTheDocument();
    expect(screen.getByText("Reduces a source to exactly one row.")).toBeInTheDocument();
    expect(screen.getByText("Top N")).toBeInTheDocument();
    expect(screen.getByText("Sorts and limits to the top N rows.")).toBeInTheDocument();
  });

  it("renders four inputs for top-n, with a numeric input for the integer field", async () => {
    render(<ShapePickerModal onClose={jest.fn()} onSeedSteps={jest.fn()} />);

    fireEvent.click(await screen.findByText("Top N"));

    expect(screen.getByRole("textbox", { name: "Measure" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Direction" })).toBeInTheDocument();
    const nInput = screen.getByRole("spinbutton", { name: "N" });
    expect(nInput).toBeInTheDocument();
    expect(nInput).toHaveAttribute("type", "number");
    expect(screen.getByRole("textbox", { name: "Ties" })).toBeInTheDocument();
  });

  it("renders an object[] field as a text area with its description as helper text", async () => {
    render(<ShapePickerModal onClose={jest.fn()} onSeedSteps={jest.fn()} />);

    fireEvent.click(await screen.findByText("Single row"));

    expect(screen.getByRole("textbox", { name: "Measures" }).tagName).toBe("TEXTAREA");
    expect(screen.getByText("Non-empty array of { fn, field, alias }.")).toBeInTheDocument();
  });

  it("submit is disabled until every required field is non-empty", async () => {
    render(<ShapePickerModal onClose={jest.fn()} onSeedSteps={jest.fn()} />);

    fireEvent.click(await screen.findByText("Single row"));

    const submit = screen.getByRole("button", { name: "Add steps" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Mode" }), {
      target: { value: "aggregate" },
    });
    expect(submit).toBeEnabled();
  });

  it("submitting valid params expands the shape and hands the result to onSeedSteps, then closes", async () => {
    const expansions: ExpandPipelineShapeResponse = {
      steps: [{ clientId: "step-0", kind: "aggregate", config: { groupBy: [], aggregations: [] } }],
    };
    expandPipelineShapeMock.mockResolvedValueOnce(expansions);
    const onSeedSteps = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    render(<ShapePickerModal onClose={onClose} onSeedSteps={onSeedSteps} />);

    fireEvent.click(await screen.findByText("Single row"));
    fireEvent.change(screen.getByRole("textbox", { name: "Mode" }), {
      target: { value: "aggregate" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Measures" }), {
      target: { value: '[{"fn":"sum","field":"amount","alias":"total"}]' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add steps" }));

    await waitFor(() => {
      expect(expandPipelineShapeMock).toHaveBeenCalledWith("single-row", {
        mode: "aggregate",
        measures: [{ fn: "sum", field: "amount", alias: "total" }],
      });
    });
    await waitFor(() => expect(onSeedSteps).toHaveBeenCalledWith(expansions, undefined));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // HEL-336 defect guard: an invalid object[] field never even calls the
  // endpoint — it's blocked client-side with an inline error.
  it("an invalid JSON object[] field blocks submission with an inline error and never calls expand", async () => {
    render(<ShapePickerModal onClose={jest.fn()} onSeedSteps={jest.fn()} />);

    fireEvent.click(await screen.findByText("Single row"));
    fireEvent.change(screen.getByRole("textbox", { name: "Mode" }), {
      target: { value: "aggregate" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Measures" }), {
      target: { value: "{not valid json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add steps" }));

    await waitFor(() => {
      expect(screen.getByText(/must be valid JSON/i)).toBeInTheDocument();
    });
    expect(expandPipelineShapeMock).not.toHaveBeenCalled();
  });

  // HEL-336 defect guard: a 422 from /expand is shown inline, the modal stays
  // open, and no steps are seeded — never a silent swallow.
  it("a 422 from expand is shown inline and the modal stays open with no steps seeded", async () => {
    expandPipelineShapeMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 422,
        data: { message: "single-row shape: missing required field 'measures'" },
      },
    });
    const onSeedSteps = jest.fn();
    const onClose = jest.fn();

    render(<ShapePickerModal onClose={onClose} onSeedSteps={onSeedSteps} />);

    fireEvent.click(await screen.findByText("Single row"));
    fireEvent.change(screen.getByRole("textbox", { name: "Mode" }), {
      target: { value: "aggregate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add steps" }));

    await waitFor(() => {
      expect(
        screen.getByText("single-row shape: missing required field 'measures'"),
      ).toBeInTheDocument();
    });
    expect(onSeedSteps).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a 404 for an unknown shape id is surfaced inline, not silently dropped", async () => {
    expandPipelineShapeMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 404, data: { message: "Unknown pipeline shape: 'single-row'" } },
    });

    render(<ShapePickerModal onClose={jest.fn()} onSeedSteps={jest.fn()} />);

    fireEvent.click(await screen.findByText("Single row"));
    fireEvent.change(screen.getByRole("textbox", { name: "Mode" }), {
      target: { value: "aggregate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add steps" }));

    await waitFor(() => {
      expect(screen.getByText("Unknown pipeline shape: 'single-row'")).toBeInTheDocument();
    });
  });

  it("Back returns to the shape list without losing the loaded catalog", async () => {
    render(<ShapePickerModal onClose={jest.fn()} onSeedSteps={jest.fn()} />);

    fireEvent.click(await screen.findByText("Single row"));
    expect(screen.getByRole("textbox", { name: "Mode" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByText("Single row")).toBeInTheDocument();
    expect(screen.getByText("Top N")).toBeInTheDocument();
  });

  it("shows an inline error when the catalog fails to load", async () => {
    getPipelineShapeCatalogMock.mockReset();
    getPipelineShapeCatalogMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 500, data: { message: "Failed to load shape catalog." } },
    });

    render(<ShapePickerModal onClose={jest.fn()} onSeedSteps={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Failed to load shape catalog.")).toBeInTheDocument();
    });
  });
});
