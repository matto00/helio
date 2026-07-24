import { fireEvent, render, screen } from "@testing-library/react";
import { UnpivotConfig } from "./UnpivotConfig";
import type { UnpivotConfigValue } from "./UnpivotConfig";
import type { SchemaField } from "../types/pipelineStep";

const sampleSchema: SchemaField[] = [
  { name: "region", type: "string" },
  { name: "jan", type: "number" },
  { name: "feb", type: "number" },
];

const emptyConfig: UnpivotConfigValue = {
  idVars: [],
  valueVars: [],
  varName: "variable",
  valueName: "value",
};

/** Open the custom Select identified by aria-label and click the option with
 * the given label. Replaces fireEvent.change for our app-styled Select. */
function chooseSelectOption(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("UnpivotConfig", () => {
  // ── Render with empty config ───────────────────────────────────────────────

  it("renders Add id field and Add value field buttons with empty config", () => {
    render(
      <UnpivotConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={jest.fn()} />,
    );
    expect(screen.getByRole("button", { name: /add id field/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add value field/i })).toBeInTheDocument();
  });

  it("renders no id/value rows when idVars/valueVars are empty", () => {
    render(
      <UnpivotConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={jest.fn()} />,
    );
    expect(screen.queryByRole("combobox", { name: /id field 1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /value field 1/i })).not.toBeInTheDocument();
  });

  it("varName/valueName inputs are pre-filled with their defaults", () => {
    render(
      <UnpivotConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={jest.fn()} />,
    );
    expect(screen.getByLabelText(/variable column/i)).toHaveValue("variable");
    expect(screen.getByLabelText(/value column/i)).toHaveValue("value");
  });

  // ── Render with hydrated config ────────────────────────────────────────────

  it("hydrates id/value rows with persisted field names", () => {
    const config: UnpivotConfigValue = { ...emptyConfig, idVars: ["region"], valueVars: ["jan"] };
    render(<UnpivotConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);
    expect(screen.getByRole("combobox", { name: /id field 1/i })).toHaveTextContent("region");
    expect(screen.getByRole("combobox", { name: /value field 1/i })).toHaveTextContent("jan");
  });

  // ── Add / remove id field ───────────────────────────────────────────────────

  it("clicking Add id field appends a new id row with the first schema field", () => {
    const onChange = jest.fn();
    render(<UnpivotConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /add id field/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as UnpivotConfigValue;
    expect(parsed.idVars).toEqual(["region"]);
  });

  it("removing an id row calls onChange without that row", () => {
    const onChange = jest.fn();
    const config: UnpivotConfigValue = { ...emptyConfig, idVars: ["region", "jan"] };
    render(<UnpivotConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /remove id field 1/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as UnpivotConfigValue;
    expect(parsed.idVars).toEqual(["jan"]);
  });

  it("changing an id row's field calls onChange with the field patched in", () => {
    const onChange = jest.fn();
    const config: UnpivotConfigValue = { ...emptyConfig, idVars: ["region"] };
    render(<UnpivotConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    chooseSelectOption("Id field 1", "jan");

    expect(onChange).toHaveBeenCalledWith({ ...config, idVars: ["jan"] });
  });

  // ── Add / remove value field ────────────────────────────────────────────────

  it("clicking Add value field appends a new value row with the first schema field", () => {
    const onChange = jest.fn();
    render(<UnpivotConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /add value field/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as UnpivotConfigValue;
    expect(parsed.valueVars).toEqual(["region"]);
  });

  it("removing a value row calls onChange without that row", () => {
    const onChange = jest.fn();
    const config: UnpivotConfigValue = { ...emptyConfig, valueVars: ["jan", "feb"] };
    render(<UnpivotConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /remove value field 1/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as UnpivotConfigValue;
    expect(parsed.valueVars).toEqual(["feb"]);
  });

  it("changing a value row's field calls onChange with the field patched in", () => {
    const onChange = jest.fn();
    const config: UnpivotConfigValue = { ...emptyConfig, valueVars: ["jan"] };
    render(<UnpivotConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    chooseSelectOption("Value field 1", "feb");

    expect(onChange).toHaveBeenCalledWith({ ...config, valueVars: ["feb"] });
  });

  // ── varName / valueName onChange wiring ─────────────────────────────────────

  it("editing the variable column input calls onChange with varName patched in", () => {
    const onChange = jest.fn();
    render(<UnpivotConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/variable column/i), { target: { value: "month" } });

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, varName: "month" });
  });

  it("editing the value column input calls onChange with valueName patched in", () => {
    const onChange = jest.fn();
    render(<UnpivotConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/value column/i), { target: { value: "amount" } });

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, valueName: "amount" });
  });
});
