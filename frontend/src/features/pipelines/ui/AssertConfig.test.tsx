import { fireEvent, render, screen } from "@testing-library/react";
import { AssertConfig } from "./AssertConfig";
import type { AssertConfigValue, AssertRuleValue } from "./AssertConfig";
import type { SchemaField } from "../types/pipelineStep";

const sampleSchema: SchemaField[] = [
  { name: "id", type: "string" },
  { name: "amount", type: "number" },
];

const emptyConfig: AssertConfigValue = { rules: [] };

describe("AssertConfig", () => {
  // ── Render with empty config ───────────────────────────────────────────────

  it("renders the Add rule button with empty config", () => {
    render(<AssertConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: /add rule/i })).toBeInTheDocument();
  });

  it("renders no rule rows when rules is empty", () => {
    render(<AssertConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={jest.fn()} />);
    expect(screen.queryByRole("combobox", { name: /kind for rule 1/i })).not.toBeInTheDocument();
  });

  // ── Add rule ────────────────────────────────────────────────────────────────

  it("clicking 'Add rule' appends a rule with kind=notNull and severity=error", () => {
    const onChange = jest.fn();
    render(<AssertConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as AssertConfigValue;
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0].kind).toBe("notNull");
    expect(parsed.rules[0].severity).toBe("error");
  });

  it("Add rule seeds field with the first analyzeSchema field", () => {
    const onChange = jest.fn();
    render(<AssertConfig config={emptyConfig} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    const parsed = onChange.mock.calls[0][0] as AssertConfigValue;
    expect(parsed.rules[0].field).toBe("id");
  });

  // ── Remove rule ─────────────────────────────────────────────────────────────

  it("removing a rule calls onChange without that rule", () => {
    const onChange = jest.fn();
    const config: AssertConfigValue = {
      rules: [
        { kind: "notNull", field: "id", params: {}, severity: "error" },
        { kind: "unique", field: "amount", params: {}, severity: "warn" },
      ],
    };
    render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /remove rule 1/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as AssertConfigValue;
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0].kind).toBe("unique");
  });

  // ── Per-kind field show/hide (design.md Decision 4) ───────────────────────

  it.each(["notNull", "unique", "range", "regex"])(
    "shows the field selector for field-requiring kind '%s'",
    (kind) => {
      const config: AssertConfigValue = {
        rules: [{ kind, field: "id", params: {}, severity: "warn" }],
      };
      render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);
      expect(screen.getByRole("combobox", { name: /field for rule 1/i })).toBeInTheDocument();
    },
  );

  it.each(["rowCountMin", "rowCountMax"])(
    "hides the field selector for dataset-level kind '%s'",
    (kind) => {
      const config: AssertConfigValue = {
        rules: [{ kind, field: null, params: {}, severity: "warn" }],
      };
      render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);
      expect(screen.queryByRole("combobox", { name: /field for rule 1/i })).not.toBeInTheDocument();
    },
  );

  // ── Kind-specific params inputs ─────────────────────────────────────────────

  it("shows min/max inputs for kind=range", () => {
    const config: AssertConfigValue = {
      rules: [{ kind: "range", field: "amount", params: {}, severity: "warn" }],
    };
    render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);
    expect(screen.getByRole("spinbutton", { name: /minimum for rule 1/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /maximum for rule 1/i })).toBeInTheDocument();
  });

  it("shows a row-count input for kind=rowCountMin", () => {
    const config: AssertConfigValue = {
      rules: [{ kind: "rowCountMin", field: null, params: { count: 1 }, severity: "warn" }],
    };
    render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);
    expect(screen.getByRole("spinbutton", { name: /row count for rule 1/i })).toHaveValue(1);
  });

  it("shows a pattern input for kind=regex", () => {
    const config: AssertConfigValue = {
      rules: [{ kind: "regex", field: "id", params: { pattern: "^A" }, severity: "warn" }],
    };
    render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);
    expect(screen.getByRole("textbox", { name: /pattern for rule 1/i })).toHaveValue("^A");
  });

  it("shows no params inputs for kind=notNull", () => {
    const config: AssertConfigValue = {
      rules: [{ kind: "notNull", field: "id", params: {}, severity: "warn" }],
    };
    render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={jest.fn()} />);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /pattern/i })).not.toBeInTheDocument();
  });

  // ── onChange wiring ────────────────────────────────────────────────────────

  it("changing the kind dropdown calls onChange with the updated kind", () => {
    const onChange = jest.fn();
    const config: AssertConfigValue = {
      rules: [{ kind: "notNull", field: "id", params: {}, severity: "warn" }],
    };
    render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox", { name: /kind for rule 1/i }));
    fireEvent.click(screen.getByRole("option", { name: "unique" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as AssertConfigValue;
    expect(parsed.rules[0].kind).toBe("unique");
  });

  it("changing the field dropdown calls onChange with the updated field", () => {
    const onChange = jest.fn();
    const config: AssertConfigValue = {
      rules: [{ kind: "notNull", field: "id", params: {}, severity: "warn" }],
    };
    render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox", { name: /field for rule 1/i }));
    fireEvent.click(screen.getByRole("option", { name: "amount" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as AssertConfigValue;
    expect(parsed.rules[0].field).toBe("amount");
  });

  it("changing the severity dropdown calls onChange with the updated severity", () => {
    const onChange = jest.fn();
    const config: AssertConfigValue = {
      rules: [{ kind: "notNull", field: "id", params: {}, severity: "warn" }],
    };
    render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox", { name: /severity for rule 1/i }));
    fireEvent.click(screen.getByRole("option", { name: "error" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as AssertConfigValue;
    expect(parsed.rules[0].severity).toBe("error");
  });

  it("changing the minimum input for kind=range calls onChange with the updated params.min", () => {
    const onChange = jest.fn();
    const config: AssertConfigValue = {
      rules: [{ kind: "range", field: "amount", params: {}, severity: "warn" }],
    };
    render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /minimum for rule 1/i }), {
      target: { value: "10" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as AssertConfigValue;
    expect(parsed.rules[0].params.min).toBe(10);
  });

  it("changing the pattern input for kind=regex calls onChange with the updated params.pattern", () => {
    const onChange = jest.fn();
    const config: AssertConfigValue = {
      rules: [{ kind: "regex", field: "id", params: {}, severity: "warn" }],
    };
    render(<AssertConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox", { name: /pattern for rule 1/i }), {
      target: { value: "^[A-Z]+$" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = onChange.mock.calls[0][0] as AssertConfigValue;
    expect(parsed.rules[0].params.pattern).toBe("^[A-Z]+$");
  });

  // ── Hydration ──────────────────────────────────────────────────────────────

  it("hydrates a persisted rule's kind, field, and severity", () => {
    const rule: AssertRuleValue = {
      kind: "unique",
      field: "amount",
      params: {},
      severity: "error",
    };
    render(
      <AssertConfig config={{ rules: [rule] }} analyzeSchema={sampleSchema} onChange={jest.fn()} />,
    );

    expect(screen.getByRole("combobox", { name: /kind for rule 1/i })).toHaveTextContent("unique");
    expect(screen.getByRole("combobox", { name: /field for rule 1/i })).toHaveTextContent("amount");
    expect(screen.getByRole("combobox", { name: /severity for rule 1/i })).toHaveTextContent(
      "error",
    );
  });
});
