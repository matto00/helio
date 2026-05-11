import { fireEvent, render, screen } from "@testing-library/react";
import { AggregateConfig } from "./AggregateConfig";
import type { AggregateConfigValue } from "./AggregateConfig";
import type { SchemaField } from "../types/models";

const sampleSchema: SchemaField[] = [
  { name: "dept", type: "string" },
  { name: "age", type: "number" },
  { name: "revenue", type: "number" },
];

const sampleColumns = sampleSchema.map((f) => f.name);

const emptyConfig: AggregateConfigValue = { groupBy: [], aggregations: [] };

describe("AggregateConfig", () => {
  // ── Render with empty config ───────────────────────────────────────────────

  it("renders Add group-by field button with empty config", () => {
    render(
      <AggregateConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /add group-by field/i })).toBeInTheDocument();
  });

  it("renders Add aggregation button with empty config", () => {
    render(
      <AggregateConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /add aggregation/i })).toBeInTheDocument();
  });

  it("renders no group-by rows when groupBy is empty", () => {
    render(
      <AggregateConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /group-by field 1/i })).not.toBeInTheDocument();
  });

  it("renders no aggregation rows when aggregations is empty", () => {
    render(
      <AggregateConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(
      screen.queryByRole("combobox", { name: /function for aggregation 1/i }),
    ).not.toBeInTheDocument();
  });

  // ── Render with hydrated config ────────────────────────────────────────────

  it("hydrates group-by row with persisted field name", () => {
    const config: AggregateConfigValue = {
      groupBy: [{ name: "dept", type: "string" }],
      aggregations: [],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: /group-by field 1/i })).toHaveTextContent("dept");
  });

  it("hydrates aggregation row with persisted alias, fn, and field", () => {
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "total_age", fn: "sum", field: "age" }],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: /alias for aggregation 1/i })).toHaveValue(
      "total_age",
    );
    expect(screen.getByRole("combobox", { name: /function for aggregation 1/i })).toHaveTextContent(
      "sum",
    );
    expect(screen.getByRole("combobox", { name: /field for aggregation 1/i })).toHaveTextContent(
      "age",
    );
  });

  // ── Add group-by field ─────────────────────────────────────────────────────

  it("clicking Add group-by field appends a new group-by row with first schema field", () => {
    const onChange = jest.fn();
    render(
      <AggregateConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add group-by field/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as AggregateConfigValue;
    expect(parsed.groupBy).toHaveLength(1);
    expect(parsed.groupBy[0].name).toBe("dept");
  });

  it("removing a group-by row calls onChange without that row", () => {
    const onChange = jest.fn();
    const config: AggregateConfigValue = {
      groupBy: [
        { name: "dept", type: "string" },
        { name: "age", type: "number" },
      ],
      aggregations: [],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove group-by field 1/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as AggregateConfigValue;
    expect(parsed.groupBy).toHaveLength(1);
    expect(parsed.groupBy[0].name).toBe("age");
  });

  // ── Add / remove aggregation row ──────────────────────────────────────────

  it("clicking Add aggregation appends a new aggregation row with fn=sum", () => {
    const onChange = jest.fn();
    render(
      <AggregateConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add aggregation/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as AggregateConfigValue;
    expect(parsed.aggregations).toHaveLength(1);
    expect(parsed.aggregations[0].fn).toBe("sum");
  });

  it("removing an aggregation row calls onChange without that row", () => {
    const onChange = jest.fn();
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [
        { alias: "total", fn: "sum", field: "age" },
        { alias: "cnt", fn: "count", field: "revenue" },
      ],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove aggregation 1/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as AggregateConfigValue;
    expect(parsed.aggregations).toHaveLength(1);
    expect(parsed.aggregations[0].alias).toBe("cnt");
  });

  // ── Inline warning for missing field ──────────────────────────────────────

  it("shows inline warning when aggregation field is not in analyzeSchema", () => {
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "x", fn: "sum", field: "nonexistent_col" }],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("alert", { name: /warning.*nonexistent_col.*not in schema/i }),
    ).toBeInTheDocument();
  });

  it("does not show inline warning when aggregation field is in analyzeSchema", () => {
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "total", fn: "sum", field: "age" }],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not show inline warning when aggregation field is empty string", () => {
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "", fn: "sum", field: "" }],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // ── onChange wiring ────────────────────────────────────────────────────────

  it("changing alias input calls onChange with updated alias", () => {
    const onChange = jest.fn();
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "", fn: "sum", field: "age" }],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /alias for aggregation 1/i }), {
      target: { value: "total_age" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as AggregateConfigValue;
    expect(parsed.aggregations[0].alias).toBe("total_age");
    expect(parsed.aggregations[0].fn).toBe("sum");
    expect(parsed.aggregations[0].field).toBe("age");
  });

  it("changing fn dropdown calls onChange with updated function", () => {
    const onChange = jest.fn();
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "x", fn: "sum", field: "age" }],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: /function for aggregation 1/i }));
    fireEvent.click(screen.getByRole("option", { name: "avg" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as AggregateConfigValue;
    expect(parsed.aggregations[0].fn).toBe("avg");
  });
});
