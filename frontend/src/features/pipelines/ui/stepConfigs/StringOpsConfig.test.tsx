import { fireEvent, render, screen } from "@testing-library/react";
import { StringOpsConfig } from "./StringOpsConfig";
import type { StringOpsConfigValue } from "./StringOpsConfig";
import type { SchemaField } from "../../types/pipelineStep";

const sampleSchema: SchemaField[] = [
  { name: "first", type: "string" },
  { name: "last", type: "string" },
  { name: "email", type: "string" },
];

const sampleColumns = sampleSchema.map((f) => f.name);

const emptyConfig: StringOpsConfigValue = {
  operation: "trim",
  field: "",
  outputColumn: "",
  pattern: "",
  separator: "",
  index: 0,
  fields: [],
};

/** Open the custom Select identified by aria-label and click the option with
 * the given label. Replaces fireEvent.change for our app-styled Select. */
function chooseSelectOption(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("StringOpsConfig", () => {
  it("operation dropdown offers exactly the six supported operations", () => {
    render(
      <StringOpsConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /^operation$/i }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["trim", "upper", "lower", "split", "extractRegex", "concat"]);
  });

  it("selecting an operation calls onChange with operation patched in", () => {
    const onChange = jest.fn();
    render(
      <StringOpsConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Operation", "upper");

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, operation: "upper" });
  });

  it("trim shows a source field selector and an output column input, hides split/extractRegex/concat params", () => {
    render(
      <StringOpsConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: /^source field$/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /output column/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^separator$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /^index$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^pattern$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /available fields/i })).not.toBeInTheDocument();
  });

  it("split shows source field, separator, and index inputs, hides pattern and the fields checklist", () => {
    const config: StringOpsConfigValue = { ...emptyConfig, operation: "split" };
    render(
      <StringOpsConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: /^source field$/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^separator$/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /^index$/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^pattern$/i })).not.toBeInTheDocument();
  });

  it("extractRegex shows source field and pattern inputs, hides separator/index/fields", () => {
    const config: StringOpsConfigValue = { ...emptyConfig, operation: "extractRegex" };
    render(
      <StringOpsConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: /^source field$/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^pattern$/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^separator$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: /^index$/i })).not.toBeInTheDocument();
  });

  it("concat shows the fields checklist and separator, hides the single source-field selector and pattern", () => {
    const config: StringOpsConfigValue = { ...emptyConfig, operation: "concat" };
    render(
      <StringOpsConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /^source field$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^separator$/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /^pattern$/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(sampleColumns.length);
  });

  it("changing the output column input calls onChange with outputColumn patched in", () => {
    const onChange = jest.fn();
    render(
      <StringOpsConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /output column/i }), {
      target: { value: "fullName" },
    });

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, outputColumn: "fullName" });
  });

  it("selecting a source field calls onChange with field patched in", () => {
    const onChange = jest.fn();
    render(
      <StringOpsConfig
        config={emptyConfig}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Source field", "email");

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, field: "email" });
  });

  it("changing the separator input calls onChange with separator patched in", () => {
    const onChange = jest.fn();
    const config: StringOpsConfigValue = { ...emptyConfig, operation: "split" };
    render(
      <StringOpsConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /^separator$/i }), {
      target: { value: "," },
    });

    expect(onChange).toHaveBeenCalledWith({ ...config, separator: "," });
  });

  it("changing the index input calls onChange with index patched in", () => {
    const onChange = jest.fn();
    const config: StringOpsConfigValue = { ...emptyConfig, operation: "split" };
    render(
      <StringOpsConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: /^index$/i }), {
      target: { value: "2" },
    });

    expect(onChange).toHaveBeenCalledWith({ ...config, index: 2 });
  });

  it("changing the pattern input calls onChange with pattern patched in", () => {
    const onChange = jest.fn();
    const config: StringOpsConfigValue = { ...emptyConfig, operation: "extractRegex" };
    render(
      <StringOpsConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /^pattern$/i }), {
      target: { value: "^([^@]+)@" },
    });

    expect(onChange).toHaveBeenCalledWith({ ...config, pattern: "^([^@]+)@" });
  });

  it("checking a field in the concat checklist calls onChange with fields appended", () => {
    const onChange = jest.fn();
    const config: StringOpsConfigValue = { ...emptyConfig, operation: "concat" };
    render(
      <StringOpsConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "first" }));

    expect(onChange).toHaveBeenCalledWith({ ...config, fields: ["first"] });
  });

  it("unchecking a field in the concat checklist calls onChange with fields removed", () => {
    const onChange = jest.fn();
    const config: StringOpsConfigValue = {
      ...emptyConfig,
      operation: "concat",
      fields: ["first", "last"],
    };
    render(
      <StringOpsConfig
        config={config}
        analyzeSchema={sampleSchema}
        analyzeColumns={sampleColumns}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "first" }));

    expect(onChange).toHaveBeenCalledWith({ ...config, fields: ["last"] });
  });
});
