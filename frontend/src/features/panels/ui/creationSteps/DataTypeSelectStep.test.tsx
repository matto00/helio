// HEL-399 — DataTypeSelectStep's "start from a shape" cards: rendered only
// when `offeredShapes` is non-empty, and selecting one diverges entirely
// from the existing-DataType path (`onSelectShape`, not `onSelect`).

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { DataTypeSelectStep } from "./DataTypeSelectStep";
import type { PipelineShapeCatalogEntry } from "../../../pipelines/types/pipelineShape";

const singleRowShape: PipelineShapeCatalogEntry = {
  id: "single-row",
  label: "Single row",
  description: "Reduces a source to exactly one row.",
  paramsSchema: [],
  outputContract: { rowCount: { kind: "exactly-one" }, description: "" },
};

const topNShape: PipelineShapeCatalogEntry = {
  id: "top-n",
  label: "Top N",
  description: "Sorts and limits to the top N rows.",
  paramsSchema: [],
  outputContract: {
    rowCount: { kind: "at-most-param", paramName: "n" },
    description: "",
  },
};

const dataType = {
  id: "dt-1",
  name: "Revenue",
  sourceId: null,
  version: 1,
  fields: [],
  computedFields: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderStep(overrides?: Partial<Parameters<typeof DataTypeSelectStep>[0]>) {
  const onSelect = jest.fn();
  const onSelectShape = jest.fn();
  const onNext = jest.fn();
  const onBack = jest.fn();
  const onEmptyStateNavigate = jest.fn();

  render(
    <MemoryRouter>
      <DataTypeSelectStep
        loading={false}
        registryDataTypes={[dataType]}
        selectedDataTypeId={null}
        onSelect={onSelect}
        onEmptyStateNavigate={onEmptyStateNavigate}
        onBack={onBack}
        onNext={onNext}
        offeredShapes={[]}
        onSelectShape={onSelectShape}
        {...overrides}
      />
    </MemoryRouter>,
  );

  return { onSelect, onSelectShape, onNext, onBack };
}

describe("DataTypeSelectStep — shape offering", () => {
  it("renders no shape cards when offeredShapes is empty (e.g. text panel type)", () => {
    renderStep({ offeredShapes: [] });
    expect(screen.queryByRole("group", { name: "Start from a shape" })).not.toBeInTheDocument();
  });

  it("renders a shape card for each offered shape, with label and description", () => {
    renderStep({ offeredShapes: [singleRowShape] });
    expect(screen.getByText("Single row")).toBeInTheDocument();
    expect(screen.getByText("Reduces a source to exactly one row.")).toBeInTheDocument();
  });

  it("renders multiple shape cards (e.g. chart → time-series, top-n)", () => {
    renderStep({ offeredShapes: [singleRowShape, topNShape] });
    expect(screen.getByText("Single row")).toBeInTheDocument();
    expect(screen.getByText("Top N")).toBeInTheDocument();
  });

  it("clicking a shape card calls onSelectShape with the shape, not onSelect", () => {
    const { onSelect, onSelectShape } = renderStep({ offeredShapes: [singleRowShape] });

    fireEvent.click(screen.getByText("Single row"));

    expect(onSelectShape).toHaveBeenCalledWith(singleRowShape);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still renders the existing DataType list alongside shape cards", () => {
    renderStep({ offeredShapes: [singleRowShape] });
    expect(screen.getByRole("button", { name: "Revenue" })).toBeInTheDocument();
  });

  it("shows an inline error instead of shape cards when the catalog fetch failed", () => {
    renderStep({ offeredShapes: [], shapeCatalogError: "Failed to load shape catalog." });
    expect(screen.getByText("Failed to load shape catalog.")).toBeInTheDocument();
    expect(screen.queryByText("Single row")).not.toBeInTheDocument();
  });
});
