// HEL-399 — DataTypeSelectStep's "start from a shape" cards: rendered only
// when `offeredShapes` is non-empty, and selecting one diverges entirely
// from the existing-DataType path (`onSelectShape`, not `onSelect`).

import { fireEvent, render, screen, within } from "@testing-library/react";
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
  const onRetry = jest.fn();

  render(
    <MemoryRouter>
      <DataTypeSelectStep
        loading={false}
        registryDataTypes={[dataType]}
        pipelineNameByTypeId={new Map()}
        selectedDataTypeId={null}
        onSelect={onSelect}
        allowSkip={false}
        onEmptyStateNavigate={onEmptyStateNavigate}
        onBack={onBack}
        onNext={onNext}
        onRetry={onRetry}
        offeredShapes={[]}
        onSelectShape={onSelectShape}
        {...overrides}
      />
    </MemoryRouter>,
  );

  return { onSelect, onSelectShape, onNext, onBack, onRetry };
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

// F-036 — text/markdown are meaningful with no data type bound; `allowSkip`
// lets Next proceed unselected instead of hard-gating on a DataType pick.
describe("DataTypeSelectStep — allowSkip (text/markdown)", () => {
  it("Next is disabled with no selection when allowSkip is false", () => {
    renderStep({ allowSkip: false });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows 'Continue without data' and enables it with no selection when allowSkip is true", () => {
    const { onNext } = renderStep({ allowSkip: true });
    const button = screen.getByRole("button", { name: "Continue without data" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onNext).toHaveBeenCalled();
  });

  it("reverts to the plain 'Next' label once a DataType is selected, even with allowSkip", () => {
    renderStep({ allowSkip: true, selectedDataTypeId: "dt-1" });
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue without data" })).not.toBeInTheDocument();
  });
});

// F-109 — a failed data-types fetch is a distinct state from "successfully
// empty", with the slice's own error and a Retry action, never the empty copy.
describe("DataTypeSelectStep — fetch error", () => {
  it("shows the error and a Retry action instead of the empty state", () => {
    renderStep({ registryDataTypes: [], error: "Failed to load data types." });
    expect(screen.getByText("Failed to load data types.")).toBeInTheDocument();
    expect(screen.queryByTestId("datatype-empty-state")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  it("Retry dispatches onRetry", () => {
    const { onRetry } = renderStep({ registryDataTypes: [], error: "Failed to load data types." });
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

// F-108 — eyebrow header, filter, and a muted per-card metadata line.
describe("DataTypeSelectStep — list header, filter, and metadata", () => {
  it("shows the eyebrow without 'Or' when no shape section is present", () => {
    renderStep({ offeredShapes: [] });
    expect(screen.getByText("Bind an existing data type")).toBeInTheDocument();
  });

  it("shows the eyebrow with 'Or' when a shape section is present", () => {
    renderStep({ offeredShapes: [singleRowShape] });
    expect(screen.getByText("Or bind an existing data type")).toBeInTheDocument();
  });

  it("filters the DataType list by name", () => {
    renderStep({
      registryDataTypes: [dataType, { ...dataType, id: "dt-2", name: "Signups" }],
    });
    expect(screen.getByRole("button", { name: "Revenue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Signups" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter data types by name"), {
      target: { value: "sign" },
    });

    expect(screen.queryByRole("button", { name: "Revenue" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Signups" })).toBeInTheDocument();
  });

  // HEL-548 D3/task 6.3/6.4 — filter-to-zero is its own EmptyState (distinct
  // from the no-types-exist state), names the query, and offers a way out.
  it("HEL-548: a query matching no data types renders the filtered empty state naming the query", () => {
    renderStep({
      registryDataTypes: [dataType, { ...dataType, id: "dt-2", name: "Signups" }],
    });

    fireEvent.change(screen.getByLabelText("Filter data types by name"), {
      target: { value: "zzz-nope" },
    });

    const filteredState = screen.getByLabelText("No matches");
    expect(filteredState).toBeInTheDocument();
    expect(within(filteredState).getByText('No data types match "zzz-nope".')).toBeInTheDocument();
    // Not the no-types-exist copy — the registry genuinely has types, this
    // query just didn't match any of them.
    expect(screen.queryByTestId("datatype-empty-state")).not.toBeInTheDocument();
    expect(within(filteredState).getByRole("button", { name: "Clear filter" })).toBeInTheDocument();
  });

  it("HEL-548: activating the filtered empty state's clear action restores the data-type list", () => {
    renderStep({
      registryDataTypes: [dataType, { ...dataType, id: "dt-2", name: "Signups" }],
    });

    fireEvent.change(screen.getByLabelText("Filter data types by name"), {
      target: { value: "zzz-nope" },
    });
    const filteredState = screen.getByLabelText("No matches");
    fireEvent.click(within(filteredState).getByRole("button", { name: "Clear filter" }));

    expect(screen.getByRole("button", { name: "Revenue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Signups" })).toBeInTheDocument();
  });

  it("HEL-548: an empty registry still renders the pipeline guidance, not the filtered wording", () => {
    renderStep({ registryDataTypes: [] });

    expect(screen.getByTestId("datatype-empty-state")).toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  it("shows a muted field-count line, including the producing pipeline when known", () => {
    renderStep({
      registryDataTypes: [
        {
          ...dataType,
          fields: [{ name: "amount", displayName: "amount", dataType: "float", nullable: false }],
        },
      ],
      pipelineNameByTypeId: new Map([["dt-1", "Sales ETL"]]),
    });
    expect(screen.getByText("Sales ETL · 1 field")).toBeInTheDocument();
  });

  it("shows a check icon on the selected card", () => {
    renderStep({ selectedDataTypeId: "dt-1" });
    const card = screen.getByRole("button", { name: "Revenue" });
    expect(card.querySelector("svg")).toBeInTheDocument();
  });
});
