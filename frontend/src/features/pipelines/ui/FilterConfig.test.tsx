import { fireEvent, render, screen } from "@testing-library/react";
import { FilterConfig } from "./FilterConfig";
import type { FilterConfigValue } from "./FilterConfig";
import type { SchemaField } from "../types/pipelineStep";

const sampleSchema: SchemaField[] = [
  { name: "name", type: "string" },
  { name: "age", type: "number" },
  { name: "dept", type: "string" },
];

const emptyConfig: FilterConfigValue = { combinator: "AND", conditions: [] };

describe("FilterConfig", () => {
  // 3.4 renders combinator toggle and condition rows from props
  it("renders the AND/OR combinator toggle buttons", () => {
    render(<FilterConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={jest.fn()} />);

    expect(screen.getByRole("button", { name: /all \(and\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /any \(or\)/i })).toBeInTheDocument();
  });

  it("renders one condition row per condition in config", () => {
    const config: FilterConfigValue = {
      combinator: "AND",
      conditions: [
        { field: "name", operator: "=", value: "alice" },
        { field: "age", operator: ">", value: "18" },
      ],
    };
    render(<FilterConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);

    expect(screen.getByRole("combobox", { name: /field for condition 1/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /field for condition 2/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /operator for condition 1/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /operator for condition 2/i })).toBeInTheDocument();
  });

  // 3.5 AND/OR toggle calls onChange with updated combinator
  it("clicking OR toggle calls onChange with combinator OR", () => {
    const onChange = jest.fn();
    render(<FilterConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /any \(or\)/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as FilterConfigValue;
    expect(parsed.combinator).toBe("OR");
  });

  it("clicking AND toggle calls onChange with combinator AND", () => {
    const onChange = jest.fn();
    const config: FilterConfigValue = { combinator: "OR", conditions: [] };
    render(<FilterConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /all \(and\)/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as FilterConfigValue;
    expect(parsed.combinator).toBe("AND");
  });

  // 3.6 value input hidden for unary operators, visible for binary
  it("hides value input when operator is 'is null'", () => {
    const config: FilterConfigValue = {
      combinator: "AND",
      conditions: [{ field: "name", operator: "is null" }],
    };
    render(<FilterConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);

    expect(
      screen.queryByRole("textbox", { name: /value for condition 1/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", { name: /value for condition 1/i }),
    ).not.toBeInTheDocument();
  });

  it("hides value input when operator is 'is not null'", () => {
    const config: FilterConfigValue = {
      combinator: "AND",
      conditions: [{ field: "name", operator: "is not null" }],
    };
    render(<FilterConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);

    expect(
      screen.queryByRole("textbox", { name: /value for condition 1/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", { name: /value for condition 1/i }),
    ).not.toBeInTheDocument();
  });

  it("shows value input for binary operator '='", () => {
    const config: FilterConfigValue = {
      combinator: "AND",
      conditions: [{ field: "name", operator: "=", value: "" }],
    };
    render(<FilterConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);

    expect(screen.getByRole("textbox", { name: /value for condition 1/i })).toBeInTheDocument();
  });

  // 3.7 type-aware input: number for numeric types, text otherwise
  it("renders text input for string field type", () => {
    const config: FilterConfigValue = {
      combinator: "AND",
      conditions: [{ field: "name", operator: "=", value: "" }],
    };
    render(<FilterConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);

    const input = screen.getByRole("textbox", { name: /value for condition 1/i });
    expect(input).toHaveAttribute("type", "text");
  });

  it("renders number input for numeric field type", () => {
    const config: FilterConfigValue = {
      combinator: "AND",
      conditions: [{ field: "age", operator: ">", value: "" }],
    };
    render(<FilterConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);

    // number inputs have role "spinbutton"
    expect(screen.getByRole("spinbutton", { name: /value for condition 1/i })).toBeInTheDocument();
  });

  // 3.8 Add condition and Remove condition update the config
  it("clicking 'Add condition' appends a blank condition row", () => {
    const onChange = jest.fn();
    render(<FilterConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /add condition/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as FilterConfigValue;
    expect(parsed.conditions).toHaveLength(1);
    expect(parsed.conditions[0].operator).toBe("=");
  });

  it("clicking Remove button removes the corresponding condition", () => {
    const onChange = jest.fn();
    const config: FilterConfigValue = {
      combinator: "AND",
      conditions: [
        { field: "name", operator: "=", value: "alice" },
        { field: "age", operator: ">", value: "18" },
      ],
    };
    render(<FilterConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /remove condition 1/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as FilterConfigValue;
    expect(parsed.conditions).toHaveLength(1);
    expect(parsed.conditions[0].field).toBe("age");
  });

  // 3.9 hydration — existing conditions rendered correctly from persisted config
  it("hydrates existing conditions: field and operator selects show persisted values", () => {
    const config: FilterConfigValue = {
      combinator: "OR",
      conditions: [{ field: "dept", operator: "!=", value: "eng" }],
    };
    render(<FilterConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);

    expect(screen.getByRole("combobox", { name: /field for condition 1/i })).toHaveTextContent(
      "dept",
    );
    // The custom Select's trigger renders the option label ("≠" for "!=").
    expect(screen.getByRole("combobox", { name: /operator for condition 1/i })).toHaveTextContent(
      "≠",
    );
    expect(screen.getByRole("textbox", { name: /value for condition 1/i })).toHaveValue("eng");
  });

  it("hydrates combinator OR button as active", () => {
    const config: FilterConfigValue = { combinator: "OR", conditions: [] };
    render(<FilterConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);

    expect(screen.getByRole("button", { name: /any \(or\)/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /all \(and\)/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
