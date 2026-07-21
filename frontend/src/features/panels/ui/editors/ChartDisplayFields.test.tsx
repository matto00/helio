import { fireEvent, render, screen } from "@testing-library/react";

import { ChartDisplayFields } from "./ChartDisplayFields";
import type { BoundOrLiteralState } from "./useBoundOrLiteralState";
import type { ChartType } from "../../../../utils/chartAppearance";

const noop = () => {};

/** Minimal `BoundOrLiteralState` stub for driving the annotation control. */
function makeAnnotationState(overrides: Partial<BoundOrLiteralState> = {}): BoundOrLiteralState {
  return {
    mode: "literal",
    setMode: jest.fn(),
    fieldValue: "",
    setFieldValue: jest.fn(),
    literalValue: "",
    setLiteralValue: jest.fn(),
    dirty: false,
    reset: jest.fn(),
    patchValue: undefined,
    fieldMappingValue: undefined,
    ...overrides,
  };
}

function renderFields(overrides: {
  chartType: ChartType;
  isBound?: boolean;
  annotationState?: BoundOrLiteralState;
}) {
  return render(
    <ChartDisplayFields
      chartType={overrides.chartType}
      line={{}}
      onLineChange={noop}
      bar={{}}
      onBarChange={noop}
      pie={{}}
      onPieChange={noop}
      scatter={{}}
      onScatterChange={noop}
      fieldOptions={[
        { value: "population", label: "population" },
        { value: "region", label: "region" },
      ]}
      isBound={overrides.isBound ?? true}
      annotationState={overrides.annotationState ?? makeAnnotationState()}
    />,
  );
}

describe("ChartDisplayFields (HEL-248) — controls swap per chart type", () => {
  it("renders line toggles for chartType line", () => {
    renderFields({ chartType: "line" });
    expect(screen.getByText("Smooth lines")).toBeInTheDocument();
    expect(screen.getByText("Point markers")).toBeInTheDocument();
    expect(screen.getByText("Area fill")).toBeInTheDocument();
    // Not the bar/pie/scatter controls.
    expect(screen.queryByRole("combobox", { name: "Bar orientation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Donut hole size" })).not.toBeInTheDocument();
  });

  it("renders bar orientation/stacking/gap for chartType bar", () => {
    renderFields({ chartType: "bar" });
    expect(screen.getByRole("combobox", { name: "Bar orientation" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Bar stacking" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Bar group spacing" })).toBeInTheDocument();
    expect(screen.queryByText("Smooth lines")).not.toBeInTheDocument();
  });

  it("renders pie donut + percentage labels for chartType pie", () => {
    renderFields({ chartType: "pie" });
    expect(screen.getByRole("slider", { name: "Donut hole size" })).toBeInTheDocument();
    expect(screen.getByText("Percentage labels")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Bar orientation" })).not.toBeInTheDocument();
  });

  it("renders scatter size/color field selects when bound", () => {
    renderFields({ chartType: "scatter", isBound: true });
    expect(screen.getByRole("combobox", { name: "Scatter point size field" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Scatter color-by field" })).toBeInTheDocument();
  });

  it("hides scatter field selects and shows a hint when unbound", () => {
    renderFields({ chartType: "scatter", isBound: false });
    expect(
      screen.queryByRole("combobox", { name: "Scatter point size field" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Bind a data type/i)).toBeInTheDocument();
  });

  it("always renders the Display section heading", () => {
    renderFields({ chartType: "line" });
    expect(screen.getByRole("heading", { name: "Display" })).toBeInTheDocument();
  });
});

describe("ChartDisplayFields — annotation control (HEL-318 / HEL-323)", () => {
  it("renders a fixed-text-only input (no mode toggle) when unbound", () => {
    renderFields({
      chartType: "line",
      isBound: false,
      annotationState: makeAnnotationState({ literalValue: "Source: internal" }),
    });
    const input = screen.getByRole("textbox", { name: "Annotation" });
    expect(input).toHaveValue("Source: internal");
    // The Bind-to-field mode toggle is not offered without a bound DataType.
    expect(screen.queryByRole("button", { name: "Bind to field" })).not.toBeInTheDocument();
  });

  it("edits the fixed-text literal via setLiteralValue when unbound", () => {
    const setLiteralValue = jest.fn();
    renderFields({
      chartType: "bar",
      isBound: false,
      annotationState: makeAnnotationState({ setLiteralValue }),
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Annotation" }), {
      target: { value: "Preliminary data" },
    });
    expect(setLiteralValue).toHaveBeenCalledWith("Preliminary data");
  });

  it("offers the Fixed text / Bind to field mode toggle when bound", () => {
    renderFields({
      chartType: "line",
      isBound: true,
      annotationState: makeAnnotationState({ mode: "literal", literalValue: "Note" }),
    });
    expect(screen.getByRole("button", { name: "Fixed text" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bind to field" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Annotation text" })).toHaveValue("Note");
  });

  it("shows the field dropdown with the bound column selected in field mode", () => {
    renderFields({
      chartType: "pie",
      isBound: true,
      annotationState: makeAnnotationState({ mode: "field", fieldValue: "region" }),
    });
    const select = screen.getByRole("combobox", { name: "Annotation field" });
    expect(select).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Annotation text" })).not.toBeInTheDocument();
  });

  it("switches mode via the toggle buttons", () => {
    const setMode = jest.fn();
    renderFields({
      chartType: "line",
      isBound: true,
      annotationState: makeAnnotationState({ mode: "literal", setMode }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Bind to field" }));
    expect(setMode).toHaveBeenCalledWith("field");
  });

  // Regression guard (HEL-323 cycle-2, skeptic CR1): the bound branch must not
  // stack an outer "Annotation" section label above BoundOrLiteralField's own
  // "Annotation" mapping-label — the word must appear exactly once.
  it("renders the 'Annotation' label exactly once when bound", () => {
    renderFields({
      chartType: "line",
      isBound: true,
      annotationState: makeAnnotationState({ mode: "literal", literalValue: "Note" }),
    });
    expect(screen.getAllByText("Annotation")).toHaveLength(1);
  });

  it("renders the 'Annotation' label exactly once when unbound", () => {
    renderFields({
      chartType: "line",
      isBound: false,
      annotationState: makeAnnotationState({ literalValue: "Note" }),
    });
    expect(screen.getAllByText("Annotation")).toHaveLength(1);
  });
});
