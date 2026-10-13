import { fireEvent, render, screen } from "@testing-library/react";
import { ComputeFieldConfig } from "./ComputeFieldConfig";
import type { ComputeConfigValue } from "./ComputeFieldConfig";

const emptyConfig: ComputeConfigValue = { column: "", expression: "", type: "number" };

describe("ComputeFieldConfig", () => {
  it("renders the output field name input", () => {
    render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);
    expect(screen.getByRole("textbox", { name: "Output field name" })).toBeInTheDocument();
  });

  it("renders the expression input", () => {
    render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);
    expect(screen.getByRole("textbox", { name: "Expression" })).toBeInTheDocument();
  });

  it("renders available-fields hint list, $-prefixed, when analyzeColumns is non-empty", () => {
    render(
      <ComputeFieldConfig
        config={emptyConfig}
        analyzeColumns={["revenue", "users", "cost"]}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("list", { name: "Available fields" })).toBeInTheDocument();
    expect(screen.getByText("$revenue")).toBeInTheDocument();
    expect(screen.getByText("$users")).toBeInTheDocument();
    expect(screen.getByText("$cost")).toBeInTheDocument();
  });

  it("does not render available-fields hint when analyzeColumns is empty", () => {
    render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);
    expect(screen.queryByRole("list", { name: "Available fields" })).not.toBeInTheDocument();
  });

  it("hydrates column name input from config prop", () => {
    const config: ComputeConfigValue = {
      column: "revenue_per_user",
      expression: "",
      type: "number",
    };
    render(<ComputeFieldConfig config={config} analyzeColumns={[]} onChange={jest.fn()} />);
    expect(screen.getByRole("textbox", { name: "Output field name" })).toHaveValue(
      "revenue_per_user",
    );
  });

  it("hydrates expression input from config prop", () => {
    const config: ComputeConfigValue = {
      column: "",
      expression: "revenue / users",
      type: "number",
    };
    render(<ComputeFieldConfig config={config} analyzeColumns={[]} onChange={jest.fn()} />);
    expect(screen.getByRole("textbox", { name: "Expression" })).toHaveValue("revenue / users");
  });

  it("calls onChange with serialized config when column name changes", () => {
    const onChange = jest.fn();
    render(
      <ComputeFieldConfig
        config={{ column: "", expression: "revenue / users", type: "number" }}
        analyzeColumns={[]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Output field name" }), {
      target: { value: "rev_per_user" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as ComputeConfigValue;
    expect(emitted.column).toBe("rev_per_user");
    expect(emitted.expression).toBe("revenue / users");
    expect(emitted.type).toBe("number");
  });

  it("calls onChange with serialized config when expression changes", () => {
    const onChange = jest.fn();
    render(
      <ComputeFieldConfig
        config={{ column: "result", expression: "", type: "number" }}
        analyzeColumns={[]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Expression" }), {
      target: { value: "price * quantity" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as ComputeConfigValue;
    expect(emitted.column).toBe("result");
    expect(emitted.expression).toBe("price * quantity");
    expect(emitted.type).toBe("number");
  });

  it.each(["Output field name", "Expression"])("does not call onChange on blur of %s", (name) => {
    const onChange = jest.fn();
    render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={onChange} />);

    fireEvent.blur(screen.getByRole("textbox", { name }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders the validationError message inline when present", () => {
    render(
      <ComputeFieldConfig
        config={{ column: "revenue", expression: "price * qty", type: "number" }}
        analyzeColumns={[]}
        validationError="Column references require a '$' prefix"
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText("Column references require a '$' prefix")).toBeInTheDocument();
  });

  it("renders no inline error when validationError is undefined", () => {
    render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);
    expect(screen.queryByText(/prefix|Unknown field/)).not.toBeInTheDocument();
  });

  describe("function reference disclosure", () => {
    it("is collapsed by default behind a reachable 'Functions and operators' control", () => {
      render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);
      const details = screen.getByText("Functions and operators").closest("details");
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute("open");
      expect(screen.getByText("Functions and operators").tagName).toBe("SUMMARY");
    });

    it("lists the date/time functions once toggled open", () => {
      render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);
      fireEvent.click(screen.getByText("Functions and operators"));
      const details = screen.getByText("Functions and operators").closest("details");
      expect(details).toHaveAttribute("open");
      const list = screen.getByRole("list", { name: "Expression functions" });
      expect(list).toHaveTextContent("seconds_between(end, start)");
      expect(list).toHaveTextContent('date_trunc("unit", ts)');
      expect(list).toHaveTextContent("add_days(ts, n)");
      expect(list).toHaveTextContent("if(cond, then, else)");
    });

    it("lists the comparison and boolean operators and literals once toggled open", () => {
      render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);
      fireEvent.click(screen.getByText("Functions and operators"));
      const list = screen.getByRole("list", { name: "Expression operators" });
      expect(list).toHaveTextContent("a != b");
      expect(list).toHaveTextContent("a >= b");
      expect(list).toHaveTextContent("a and b");
      expect(list).toHaveTextContent("a or b");
      expect(list).toHaveTextContent("not a");
      expect(list).toHaveTextContent("true");
    });
  });
});
