import { fireEvent, render, screen } from "@testing-library/react";
import { PivotConfig } from "./PivotConfig";
import type { PivotConfigValue } from "./PivotConfig";
import type { SchemaField } from "../../types/pipelineStep";

const sampleSchema: SchemaField[] = [
  { name: "region", type: "string" },
  { name: "product", type: "string" },
  { name: "revenue", type: "number" },
];

const sampleColumns = sampleSchema.map((f) => f.name);

const emptyConfig: PivotConfigValue = { index: [], column: "", values: "", agg: "sum" };

/** Open the custom Select identified by aria-label and click the option with
 * the given label. Replaces fireEvent.change for our app-styled Select. */
function chooseSelectOption(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("PivotConfig", () => {
  it("renders Add index field button with empty config", () => {
    render(
      <PivotConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /add index field/i })).toBeInTheDocument();
  });

  it("renders no index rows when index is empty", () => {
    render(
      <PivotConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /index field 1/i })).not.toBeInTheDocument();
  });

  it("pivot column dropdown offers every analyzeColumns entry", () => {
    render(
      <PivotConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /^pivot column$/i }));
    expect(screen.getByRole("option", { name: "region" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "product" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "revenue" })).toBeInTheDocument();
  });

  it("agg dropdown offers exactly sum/count/avg/min/max/first", () => {
    render(
      <PivotConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /pivot aggregation function/i }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["sum", "count", "avg", "min", "max", "first"]);
  });

  it("hydrates index row with persisted field name", () => {
    const config: PivotConfigValue = { ...emptyConfig, index: ["region"] };
    render(
      <PivotConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: /index field 1/i })).toHaveTextContent("region");
  });

  it("clicking Add index field appends a new index row with first schema field", () => {
    const onChange = jest.fn();
    render(
      <PivotConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add index field/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as PivotConfigValue;
    expect(parsed.index).toEqual(["region"]);
  });

  it("removing an index row calls onChange without that row", () => {
    const onChange = jest.fn();
    const config: PivotConfigValue = { ...emptyConfig, index: ["region", "product"] };
    render(
      <PivotConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove index field 1/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as PivotConfigValue;
    expect(parsed.index).toEqual(["product"]);
  });

  it("changing an index row's field calls onChange with the field patched in", () => {
    const onChange = jest.fn();
    const config: PivotConfigValue = { ...emptyConfig, index: ["region"] };
    render(
      <PivotConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Index field 1", "product");

    expect(onChange).toHaveBeenCalledWith({ ...config, index: ["product"] });
  });

  it("selecting the pivot column calls onChange with column patched in", () => {
    const onChange = jest.fn();
    render(
      <PivotConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Pivot column", "product");

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, column: "product" });
  });

  it("selecting the values field calls onChange with values patched in", () => {
    const onChange = jest.fn();
    render(
      <PivotConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Values field", "revenue");

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, values: "revenue" });
  });

  it("selecting an agg function calls onChange with agg patched in", () => {
    const onChange = jest.fn();
    render(
      <PivotConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Pivot aggregation function", "first");

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, agg: "first" });
  });
});
