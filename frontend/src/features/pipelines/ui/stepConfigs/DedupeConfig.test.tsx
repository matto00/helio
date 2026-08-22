import { fireEvent, render, screen } from "@testing-library/react";
import { DedupeConfig } from "./DedupeConfig";
import type { DedupeConfigValue } from "./DedupeConfig";

const columns = ["id", "region", "amount"];

const emptyConfig: DedupeConfigValue = { keys: [], keep: "first" };

describe("DedupeConfig", () => {
  // Scenario: User selects key fields
  it("selecting a key field calls onChange with the field added to keys", () => {
    const onChange = jest.fn();
    render(<DedupeConfig config={emptyConfig} analyzeColumns={columns} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "id" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ keys: ["id"], keep: "first" });
  });

  it("selecting a second key field appends it to the existing keys", () => {
    const onChange = jest.fn();
    const config: DedupeConfigValue = { keys: ["id"], keep: "first" };
    render(<DedupeConfig config={config} analyzeColumns={columns} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "region" }));

    expect(onChange).toHaveBeenCalledWith({ keys: ["id", "region"], keep: "first" });
  });

  it("unchecking a selected key field removes it from keys", () => {
    const onChange = jest.fn();
    const config: DedupeConfigValue = { keys: ["id", "region"], keep: "first" };
    render(<DedupeConfig config={config} analyzeColumns={columns} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "id" }));

    expect(onChange).toHaveBeenCalledWith({ keys: ["region"], keep: "first" });
  });

  // Scenario: User leaves keys empty for whole-row distinct
  it("renders with no keys selected (whole-row distinct) as a valid initial state", () => {
    render(<DedupeConfig config={emptyConfig} analyzeColumns={columns} onChange={jest.fn()} />);

    columns.forEach((col) => {
      expect(screen.getByRole("checkbox", { name: col })).not.toBeChecked();
    });
  });

  it("renders an empty checklist when there are no analyze columns", () => {
    render(<DedupeConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // Scenario: User toggles keep to last
  it("toggling the keep control from first to last calls onChange with keep=last", () => {
    const onChange = jest.fn();
    render(<DedupeConfig config={emptyConfig} analyzeColumns={columns} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "LAST" }));

    expect(onChange).toHaveBeenCalledWith({ keys: [], keep: "last" });
  });

  it("toggling the keep control from last back to first calls onChange with keep=first", () => {
    const onChange = jest.fn();
    const config: DedupeConfigValue = { keys: [], keep: "last" };
    render(<DedupeConfig config={config} analyzeColumns={columns} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "FIRST" }));

    expect(onChange).toHaveBeenCalledWith({ keys: [], keep: "first" });
  });

  it("marks the active keep button with aria-pressed", () => {
    const config: DedupeConfigValue = { keys: [], keep: "last" };
    render(<DedupeConfig config={config} analyzeColumns={columns} onChange={jest.fn()} />);

    expect(screen.getByRole("button", { name: "FIRST" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "LAST" })).toHaveAttribute("aria-pressed", "true");
  });
});
