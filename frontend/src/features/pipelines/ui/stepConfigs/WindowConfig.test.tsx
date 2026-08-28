import { fireEvent, render, screen } from "@testing-library/react";
import { WindowConfig } from "./WindowConfig";
import type { WindowConfigValue } from "./WindowConfig";
import type { SchemaField } from "../../types/pipelineStep";

const sampleSchema: SchemaField[] = [
  { name: "category", type: "string" },
  { name: "amount", type: "number" },
  { name: "day", type: "integer" },
];

const sampleColumns = sampleSchema.map((f) => f.name);

const emptyConfig: WindowConfigValue = {
  partitionBy: [],
  orderBy: [],
  function: "row_number",
  field: "",
  outputColumn: "",
  offset: 1,
};

/** Open the custom Select identified by aria-label and click the option with
 * the given label. Replaces fireEvent.change for our app-styled Select. */
function chooseSelectOption(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("WindowConfig", () => {
  it("renders Add partition field button with empty config", () => {
    render(
      <WindowConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /add partition field/i })).toBeInTheDocument();
  });

  it("renders no partition rows when partitionBy is empty", () => {
    render(
      <WindowConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /partition field 1/i })).not.toBeInTheDocument();
  });

  it("function dropdown offers exactly the six supported functions", () => {
    render(
      <WindowConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /window function/i }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["row_number", "rank", "dense_rank", "running_sum", "lag", "lead"]);
  });

  // ── Field/offset visibility per function (design.md decision 4) ─────────────

  it("does not render a source field selector for row_number (rank family ignores field)", () => {
    render(
      <WindowConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /^source field$/i })).not.toBeInTheDocument();
  });

  it("does not render an offset input for row_number", () => {
    render(
      <WindowConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByRole("spinbutton", { name: /offset/i })).not.toBeInTheDocument();
  });

  it("renders a source field selector (no offset) for running_sum", () => {
    const config: WindowConfigValue = { ...emptyConfig, function: "running_sum" };
    render(
      <WindowConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: /^source field$/i })).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /offset/i })).not.toBeInTheDocument();
  });

  it("renders both a source field selector and an offset input for lag", () => {
    const config: WindowConfigValue = { ...emptyConfig, function: "lag" };
    render(
      <WindowConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: /^source field$/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /offset/i })).toBeInTheDocument();
  });

  it("renders both a source field selector and an offset input for lead", () => {
    const config: WindowConfigValue = { ...emptyConfig, function: "lead" };
    render(
      <WindowConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: /^source field$/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /offset/i })).toBeInTheDocument();
  });

  it("clicking Add partition field appends a new row with the first schema field", () => {
    const onChange = jest.fn();
    render(
      <WindowConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add partition field/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as WindowConfigValue;
    expect(parsed.partitionBy).toEqual(["category"]);
  });

  it("removing a partition row calls onChange without that row", () => {
    const onChange = jest.fn();
    const config: WindowConfigValue = { ...emptyConfig, partitionBy: ["category", "amount"] };
    render(
      <WindowConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove partition field 1/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as WindowConfigValue;
    expect(parsed.partitionBy).toEqual(["amount"]);
  });

  it("changing a partition row's field calls onChange with the field patched in", () => {
    const onChange = jest.fn();
    const config: WindowConfigValue = { ...emptyConfig, partitionBy: ["category"] };
    render(
      <WindowConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Partition field 1", "amount");

    expect(onChange).toHaveBeenCalledWith({ ...config, partitionBy: ["amount"] });
  });

  it("adding an order-by key calls onChange with orderBy populated", () => {
    const onChange = jest.fn();
    render(
      <WindowConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add sort key/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as WindowConfigValue;
    expect(parsed.orderBy).toEqual([{ field: "category", direction: "asc" }]);
  });

  it("selecting a function calls onChange with function patched in", () => {
    const onChange = jest.fn();
    render(
      <WindowConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Window function", "rank");

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, function: "rank" });
  });

  it("selecting a source field calls onChange with field patched in", () => {
    const onChange = jest.fn();
    const config: WindowConfigValue = { ...emptyConfig, function: "lag" };
    render(
      <WindowConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Source field", "amount");

    expect(onChange).toHaveBeenCalledWith({ ...config, field: "amount" });
  });

  it("changing the offset input calls onChange with offset patched in", () => {
    const onChange = jest.fn();
    const config: WindowConfigValue = { ...emptyConfig, function: "lag" };
    render(
      <WindowConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: /offset/i }), {
      target: { value: "2" },
    });

    expect(onChange).toHaveBeenCalledWith({ ...config, offset: 2 });
  });

  it("does not call onChange when offset is 0 (invalid)", () => {
    const onChange = jest.fn();
    const config: WindowConfigValue = { ...emptyConfig, function: "lag" };
    render(
      <WindowConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: /offset/i }), {
      target: { value: "0" },
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("changing the output column input calls onChange with outputColumn patched in", () => {
    const onChange = jest.fn();
    render(
      <WindowConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /output column/i }), {
      target: { value: "rank_in_category" },
    });

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, outputColumn: "rank_in_category" });
  });
});
