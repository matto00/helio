import { fireEvent, render, screen } from "@testing-library/react";
import { AggregateConfig, FN_HINTS } from "./AggregateConfig";
import type { AggregateConfigValue } from "./AggregateConfig";
import type { SchemaField } from "../../types/pipelineStep";

const sampleSchema: SchemaField[] = [
  { name: "dept", type: "string" },
  { name: "age", type: "number" },
  { name: "revenue", type: "number" },
];

const sampleColumns = sampleSchema.map((f) => f.name);

const emptyConfig: AggregateConfigValue = { groupBy: [], aggregations: [] };

describe("AggregateConfig", () => {
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
    const parsed = onChange.mock.calls[0][0] as AggregateConfigValue;
    expect(parsed.groupBy).toHaveLength(1);
    expect(parsed.groupBy[0].name).toBe("dept");
  });

  // HEL sweep F-129 regression: the default for a new group-by row must skip
  // fields already used by an earlier row — duplicating a partition key is
  // never useful.
  it("clicking Add group-by field again skips the already-used field and picks the next one", () => {
    const onChange = jest.fn();
    const config: AggregateConfigValue = {
      groupBy: [{ name: "dept", type: "string" }],
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

    fireEvent.click(screen.getByRole("button", { name: /add group-by field/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as AggregateConfigValue;
    expect(parsed.groupBy.map((g) => g.name)).toEqual(["dept", "age"]);
  });

  it("leaves a new group-by row unselected once every schema field is already used", () => {
    const onChange = jest.fn();
    const config: AggregateConfigValue = {
      groupBy: sampleSchema.map((f) => ({ name: f.name, type: f.type })),
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

    fireEvent.click(screen.getByRole("button", { name: /add group-by field/i }));

    const parsed = onChange.mock.calls[0][0] as AggregateConfigValue;
    expect(parsed.groupBy).toHaveLength(sampleSchema.length + 1);
    expect(parsed.groupBy[parsed.groupBy.length - 1].name).toBe("");
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
    const parsed = onChange.mock.calls[0][0] as AggregateConfigValue;
    expect(parsed.groupBy).toHaveLength(1);
    expect(parsed.groupBy[0].name).toBe("age");
  });

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
    const parsed = onChange.mock.calls[0][0] as AggregateConfigValue;
    expect(parsed.aggregations).toHaveLength(1);
    expect(parsed.aggregations[0].fn).toBe("sum");
  });

  // HEL sweep F-129 regression: sum/avg/min/max only make sense on numeric
  // fields, so a new aggregation must default to the first numeric schema
  // field ("age", not the string "dept" that happens to come first).
  it("clicking Add aggregation defaults the field to the first numeric schema field", () => {
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

    const parsed = onChange.mock.calls[0][0] as AggregateConfigValue;
    expect(parsed.aggregations[0].field).toBe("age");
  });

  it("leaves a new aggregation's field unselected when the schema has no numeric field", () => {
    const onChange = jest.fn();
    const stringOnlySchema: SchemaField[] = [{ name: "dept", type: "string" }];
    render(
      <AggregateConfig
        config={emptyConfig}
        analyzeSchema={stringOnlySchema}
        analyzeColumns={stringOnlySchema.map((f) => f.name)}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add aggregation/i }));

    const parsed = onChange.mock.calls[0][0] as AggregateConfigValue;
    expect(parsed.aggregations[0].field).toBe("");
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
    const parsed = onChange.mock.calls[0][0] as AggregateConfigValue;
    expect(parsed.aggregations).toHaveLength(1);
    expect(parsed.aggregations[0].alias).toBe("cnt");
  });

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
    const parsed = onChange.mock.calls[0][0] as AggregateConfigValue;
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
    const parsed = onChange.mock.calls[0][0] as AggregateConfigValue;
    expect(parsed.aggregations[0].fn).toBe("avg");
  });

  it("shows sum hint text below fn dropdown when fn=sum", () => {
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
    expect(screen.getByText("Sums numeric values; ignores nulls")).toBeInTheDocument();
  });

  it("shows avg hint text below fn dropdown when fn=avg", () => {
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "avg_age", fn: "avg", field: "age" }],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText("Averages numeric values; ignores nulls")).toBeInTheDocument();
  });

  it("shows min hint text below fn dropdown when fn=min", () => {
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "mn", fn: "min", field: "age" }],
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
      screen.getByText("Minimum numeric value; ignores nulls and non-numeric"),
    ).toBeInTheDocument();
  });

  it("shows max hint text below fn dropdown when fn=max", () => {
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "mx", fn: "max", field: "age" }],
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
      screen.getByText("Maximum numeric value; ignores nulls and non-numeric"),
    ).toBeInTheDocument();
  });

  it("shows count hint text below fn dropdown when fn=count", () => {
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "n", fn: "count", field: "age" }],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText("Counts non-null values in the field")).toBeInTheDocument();
  });

  it("does not show alias error before the alias input has been blurred", () => {
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "", fn: "sum", field: "age" }],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByText("Output name required")).not.toBeInTheDocument();
  });

  it("shows 'Output name required' after blurring an empty alias input", () => {
    const config: AggregateConfigValue = {
      groupBy: [],
      aggregations: [{ alias: "", fn: "sum", field: "age" }],
    };
    render(
      <AggregateConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );

    fireEvent.blur(screen.getByRole("textbox", { name: /alias for aggregation 1/i }));

    expect(screen.getByText("Output name required")).toBeInTheDocument();
  });

  it("does not show alias error after blur when alias is non-empty", () => {
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

    fireEvent.blur(screen.getByRole("textbox", { name: /alias for aggregation 1/i }));

    expect(screen.queryByText("Output name required")).not.toBeInTheDocument();
  });

  it("shows group-by relationship description text", () => {
    render(
      <AggregateConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText(/Group-by fields define the partition keys/i)).toBeInTheDocument();
  });

  describe("median / percentile / count_distinct (HEL-1310)", () => {
    function renderRow(row: AggregateConfigValue["aggregations"][number]) {
      const onChange = jest.fn();
      const view = render(
        <AggregateConfig
          config={{ groupBy: [], aggregations: [row] }}
          analyzeSchema={sampleSchema}
          analyzeColumns={sampleColumns}
          onChange={onChange}
        />,
      );
      return { onChange, ...view };
    }
    const lastConfig = (onChange: jest.Mock) =>
      onChange.mock.calls[onChange.mock.calls.length - 1][0] as AggregateConfigValue;

    it("offers the three new functions", () => {
      renderRow({ alias: "x", fn: "sum", field: "age" });
      fireEvent.click(screen.getByRole("combobox", { name: /function for aggregation 1/i }));
      for (const fn of ["median", "percentile", "count_distinct"]) {
        expect(screen.getByRole("option", { name: fn })).toBeInTheDocument();
      }
    });

    it("shows a hint for each new function", () => {
      for (const fn of ["median", "percentile", "count_distinct"]) {
        const { unmount } = renderRow({ alias: "x", fn, field: "age", p: 50 });
        expect(
          document.querySelector(".pipeline-detail-page__aggregate-fn-hint")?.textContent,
        ).toBe(FN_HINTS[fn as keyof typeof FN_HINTS]);
        unmount();
      }
    });

    it("does not render a p input for non-percentile functions", () => {
      renderRow({ alias: "x", fn: "median", field: "age" });
      expect(
        screen.queryByRole("spinbutton", { name: /percentile p \(row 1\)/i }),
      ).not.toBeInTheDocument();
    });

    it("switching to percentile seeds p: 50 and reveals the p input; entering 90 emits p: 90", () => {
      const { onChange, rerender } = renderRow({ alias: "x", fn: "sum", field: "age" });
      fireEvent.click(screen.getByRole("combobox", { name: /function for aggregation 1/i }));
      fireEvent.click(screen.getByRole("option", { name: "percentile" }));
      expect(lastConfig(onChange).aggregations[0]).toEqual({
        alias: "x",
        fn: "percentile",
        field: "age",
        p: 50,
      });

      rerender(
        <AggregateConfig
          config={lastConfig(onChange)}
          analyzeSchema={sampleSchema}
          analyzeColumns={sampleColumns}
          onChange={onChange}
        />,
      );
      const input = screen.getByRole("spinbutton", { name: /percentile p \(row 1\)/i });
      expect(input).toHaveValue(50);
      fireEvent.change(input, { target: { value: "90" } });
      expect(lastConfig(onChange).aggregations[0].p).toBe(90);
    });

    it.each(["", "abc", "101", "-1"])(
      "an invalid p (%p) shows an inline error and does not emit",
      (bad) => {
        const { onChange } = renderRow({ alias: "x", fn: "percentile", field: "age", p: 90 });
        const input = screen.getByRole("spinbutton", { name: /percentile p \(row 1\)/i });
        // number inputs sanitize "abc" to "", which exercises the cleared path
        fireEvent.change(input, { target: { value: bad } });
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText(/percentile p must be a number between 0 and 100/i)).toBeVisible();
      },
    );

    it("recovers from an invalid p once a valid value is entered", () => {
      const { onChange } = renderRow({ alias: "x", fn: "percentile", field: "age", p: 90 });
      const input = screen.getByRole("spinbutton", { name: /percentile p \(row 1\)/i });
      fireEvent.change(input, { target: { value: "150" } });
      fireEvent.change(input, { target: { value: "95" } });
      expect(lastConfig(onChange).aggregations[0].p).toBe(95);
      expect(screen.queryByText(/percentile p must be a number/i)).not.toBeInTheDocument();
    });

    it("switching away from percentile drops p", () => {
      const { onChange } = renderRow({ alias: "x", fn: "percentile", field: "age", p: 90 });
      fireEvent.click(screen.getByRole("combobox", { name: /function for aggregation 1/i }));
      fireEvent.click(screen.getByRole("option", { name: "median" }));
      const row = lastConfig(onChange).aggregations[0];
      expect(row.fn).toBe("median");
      expect("p" in row).toBe(false);
    });
  });

  describe("case-insensitive stored function (HEL-1407)", () => {
    function renderRow(row: AggregateConfigValue["aggregations"][number]) {
      return render(
        <AggregateConfig
          config={{ groupBy: [], aggregations: [row] }}
          analyzeSchema={sampleSchema}
          analyzeColumns={sampleColumns}
          onChange={jest.fn()}
        />,
      );
    }
    const hintText = () =>
      document.querySelector(".pipeline-detail-page__aggregate-fn-hint")?.textContent;

    it("a stored SUM shows the sum hint and selects the sum picker option", () => {
      renderRow({ alias: "x", fn: "SUM", field: "age" });
      expect(hintText()).toBe(FN_HINTS.sum);
      expect(
        screen.getByRole("combobox", { name: /function for aggregation 1/i }),
      ).toHaveTextContent("sum");
    });

    it("a stored PERCENTILE shows its hint and the p input", () => {
      renderRow({ alias: "x", fn: "PERCENTILE", field: "age", p: 90 });
      expect(hintText()).toBe(FN_HINTS.percentile);
      expect(screen.getByRole("spinbutton", { name: /percentile p/i })).toHaveValue(90);
    });
  });

  describe("percentile p input accessibility (HEL-1407)", () => {
    function renderPercentile(p: number) {
      return render(
        <AggregateConfig
          config={{
            groupBy: [],
            aggregations: [{ alias: "x", fn: "percentile", field: "age", p }],
          }}
          analyzeSchema={sampleSchema}
          analyzeColumns={sampleColumns}
          onChange={jest.fn()}
        />,
      );
    }

    it("has a visible label element, with a value present, that names the row", () => {
      renderPercentile(90);
      const input = screen.getByRole("spinbutton", { name: /percentile p/i }) as HTMLInputElement;
      expect(input).toHaveValue(90);
      expect(input.labels).toHaveLength(1);
      expect(input.labels?.[0].tagName).toBe("LABEL");
      expect(input.labels?.[0]).toHaveTextContent(/percentile p.*1/i);
      expect(input).not.toHaveAttribute("aria-label");
    });

    it("links an invalid-p error to the input with aria-invalid and aria-describedby", () => {
      renderPercentile(90);
      const input = screen.getByRole("spinbutton", { name: /percentile p/i });
      expect(input).not.toHaveAttribute("aria-invalid");
      fireEvent.change(input, { target: { value: "150" } });
      const error = screen.getByText(/percentile p must be a number between 0 and 100/i);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleDescription(error.textContent ?? "");
      expect(input.getAttribute("aria-describedby")).toBe(error.id);
    });

    it("gives each percentile row its own label and error ids", () => {
      render(
        <AggregateConfig
          config={{
            groupBy: [],
            aggregations: [
              { alias: "a", fn: "percentile", field: "age", p: 10 },
              { alias: "b", fn: "percentile", field: "age", p: 20 },
            ],
          }}
          analyzeSchema={sampleSchema}
          analyzeColumns={sampleColumns}
          onChange={jest.fn()}
        />,
      );
      const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
      expect(inputs).toHaveLength(2);
      expect(inputs[0].labels?.[0]).toHaveTextContent("row 1");
      expect(inputs[1].labels?.[0]).toHaveTextContent("row 2");
      inputs.forEach((input) => fireEvent.change(input, { target: { value: "150" } }));
      const [first, second] = inputs.map((input) => input.getAttribute("aria-describedby"));
      expect(first).toBeTruthy();
      expect(first).not.toBe(second);
      expect(document.getElementById(first as string)).toHaveTextContent(/between 0 and 100/);
      expect(document.getElementById(second as string)).toHaveTextContent(/between 0 and 100/);
    });
  });
});
