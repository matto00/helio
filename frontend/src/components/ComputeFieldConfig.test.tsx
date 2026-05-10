import { fireEvent, render, screen } from "@testing-library/react";
import { ComputeFieldConfig } from "./ComputeFieldConfig";
import type { ComputeConfigValue } from "./ComputeFieldConfig";

const emptyConfig: ComputeConfigValue = { column: "", expression: "", type: "number" };

describe("ComputeFieldConfig", () => {
  // ── Render inputs ──────────────────────────────────────────────────────────

  it("renders the output field name input", () => {
    render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);
    expect(screen.getByRole("textbox", { name: "Output field name" })).toBeInTheDocument();
  });

  it("renders the expression input", () => {
    render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);
    expect(screen.getByRole("textbox", { name: "Expression" })).toBeInTheDocument();
  });

  // ── Available fields hint ──────────────────────────────────────────────────

  it("renders available-fields hint list when analyzeColumns is non-empty", () => {
    render(
      <ComputeFieldConfig
        config={emptyConfig}
        analyzeColumns={["revenue", "users", "cost"]}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("list", { name: "Available fields" })).toBeInTheDocument();
    expect(screen.getByText("revenue")).toBeInTheDocument();
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("cost")).toBeInTheDocument();
  });

  it("does not render available-fields hint when analyzeColumns is empty", () => {
    render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={jest.fn()} />);
    expect(screen.queryByRole("list", { name: "Available fields" })).not.toBeInTheDocument();
  });

  // ── Config hydration ───────────────────────────────────────────────────────

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

  // ── onChange patch ─────────────────────────────────────────────────────────

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
    const emitted = JSON.parse(onChange.mock.calls[0][0] as string) as ComputeConfigValue;
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
    const emitted = JSON.parse(onChange.mock.calls[0][0] as string) as ComputeConfigValue;
    expect(emitted.column).toBe("result");
    expect(emitted.expression).toBe("price * quantity");
    expect(emitted.type).toBe("number");
  });

  it("calls onChange on blur of column name input", () => {
    const onChange = jest.fn();
    render(<ComputeFieldConfig config={emptyConfig} analyzeColumns={[]} onChange={onChange} />);

    fireEvent.blur(screen.getByRole("textbox", { name: "Output field name" }));

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
