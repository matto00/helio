import { fireEvent, render, screen } from "@testing-library/react";
import { FillNullConfig } from "./FillNullConfig";
import type { FillNullConfigValue } from "./FillNullConfig";

const columns = ["price", "qty", "region"];

const emptyConfig: FillNullConfigValue = { columns: [], strategy: "constant", value: null };

function chooseStrategy(optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Fill strategy" }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("FillNullConfig", () => {
  // Scenario: User selects columns and a strategy
  it("selecting a column calls onChange with the column added to columns", () => {
    const onChange = jest.fn();
    render(<FillNullConfig config={emptyConfig} analyzeColumns={columns} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "price" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      columns: ["price"],
      strategy: "constant",
      value: null,
    });
  });

  it("selecting a second column appends it to the existing columns, then selecting a strategy updates it", () => {
    const onChange = jest.fn();
    const config: FillNullConfigValue = { columns: ["price"], strategy: "constant", value: null };
    render(<FillNullConfig config={config} analyzeColumns={columns} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "qty" }));
    expect(onChange).toHaveBeenCalledWith({
      columns: ["price", "qty"],
      strategy: "constant",
      value: null,
    });
  });

  it("unchecking a selected column removes it from columns", () => {
    const onChange = jest.fn();
    const config: FillNullConfigValue = {
      columns: ["price", "qty"],
      strategy: "constant",
      value: null,
    };
    render(<FillNullConfig config={config} analyzeColumns={columns} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "price" }));

    expect(onChange).toHaveBeenCalledWith({ columns: ["qty"], strategy: "constant", value: null });
  });

  it("selecting the mean strategy calls onChange with the config JSON for the selected columns/strategy", () => {
    const onChange = jest.fn();
    const config: FillNullConfigValue = {
      columns: ["price", "qty"],
      strategy: "constant",
      value: null,
    };
    render(<FillNullConfig config={config} analyzeColumns={columns} onChange={onChange} />);

    chooseStrategy("mean");

    expect(onChange).toHaveBeenCalledWith({
      columns: ["price", "qty"],
      strategy: "mean",
      value: null,
    });
  });

  it("renders an empty checklist when there are no analyze columns", () => {
    render(<FillNullConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // Scenario: Constant value input only shown for constant strategy
  it("shows the constant-value input when strategy is constant", () => {
    render(<FillNullConfig config={emptyConfig} analyzeColumns={columns} onChange={jest.fn()} />);

    expect(screen.getByRole("textbox", { name: "Constant value" })).toBeInTheDocument();
  });

  it("does not render the constant-value input when strategy is forwardFill", () => {
    const config: FillNullConfigValue = { columns: [], strategy: "forwardFill", value: null };
    render(<FillNullConfig config={config} analyzeColumns={columns} onChange={jest.fn()} />);

    expect(screen.queryByRole("textbox", { name: "Constant value" })).not.toBeInTheDocument();
  });

  it("does not render the constant-value input when strategy is mean/median/mode", () => {
    (["mean", "median", "mode"] as const).forEach((strategy) => {
      const config: FillNullConfigValue = { columns: [], strategy, value: null };
      const { unmount } = render(
        <FillNullConfig config={config} analyzeColumns={columns} onChange={jest.fn()} />,
      );
      expect(screen.queryByRole("textbox", { name: "Constant value" })).not.toBeInTheDocument();
      unmount();
    });
  });

  it("typing into the constant-value input calls onChange with the typed value", () => {
    const onChange = jest.fn();
    const config: FillNullConfigValue = {
      columns: ["region"],
      strategy: "constant",
      value: null,
    };
    render(<FillNullConfig config={config} analyzeColumns={columns} onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Constant value" }), {
      target: { value: "n/a" },
    });

    expect(onChange).toHaveBeenCalledWith({
      columns: ["region"],
      strategy: "constant",
      value: "n/a",
    });
  });
});
