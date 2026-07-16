import { render, screen } from "@testing-library/react";

import { ChartDisplayFields } from "./ChartDisplayFields";
import type { ChartType } from "../../../../utils/chartAppearance";

const noop = () => {};

function renderFields(overrides: { chartType: ChartType; isBound?: boolean }) {
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
