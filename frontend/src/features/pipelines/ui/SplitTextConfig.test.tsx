import { fireEvent, render, screen } from "@testing-library/react";
import { SplitTextConfig } from "./SplitTextConfig";
import type { SplitTextConfigValue } from "./SplitTextConfig";
import type { SchemaField } from "../types/pipelineStep";

/** Open the custom Select identified by aria-label and click the option with
 * the given label. Replaces fireEvent.change for our app-styled Select. */
function chooseSelectOption(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

const mixedSchema: SchemaField[] = [
  { name: "content", type: "string-body" },
  { name: "filename", type: "string" },
];

const noContentSchema: SchemaField[] = [{ name: "filename", type: "string" }];

const emptyConfig: SplitTextConfigValue = {
  field: "",
  mode: "paragraph",
  headingLevel: 1,
  indexField: "segmentIndex",
};

describe("SplitTextConfig", () => {
  // Scenario: Field dropdown offers only string-body fields
  it("field dropdown offers only string-body fields", () => {
    render(
      <SplitTextConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: /content field to split/i }));
    expect(screen.getByRole("option", { name: "content" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "filename" })).not.toBeInTheDocument();
  });

  // Scenario: No string-body fields renders an empty dropdown
  it("renders an empty dropdown when no string-body fields exist", () => {
    render(
      <SplitTextConfig config={emptyConfig} analyzeSchema={noContentSchema} onChange={jest.fn()} />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: /content field to split/i }));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  // Scenario: Changing the field updates the step config
  it("selecting a field calls onChange with the field patched in", () => {
    const onChange = jest.fn();
    render(
      <SplitTextConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={onChange} />,
    );

    chooseSelectOption("Content field to split", "content");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, field: "content" });
  });

  // Scenario: Heading-level input is shown only in heading mode
  it("hides the heading-level input in paragraph mode", () => {
    render(
      <SplitTextConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.queryByRole("spinbutton", { name: /heading level/i })).not.toBeInTheDocument();
  });

  it("shows the heading-level input once heading mode is selected", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <SplitTextConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /markdown heading/i }));
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, mode: "heading" });

    rerender(
      <SplitTextConfig
        config={{ ...emptyConfig, mode: "heading" }}
        analyzeSchema={mixedSchema}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("spinbutton", { name: /heading level/i })).toBeInTheDocument();
  });

  it("switching back to paragraph mode hides the heading-level input", () => {
    const config: SplitTextConfigValue = { ...emptyConfig, mode: "heading" };
    const { rerender } = render(
      <SplitTextConfig config={config} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.getByRole("spinbutton", { name: /heading level/i })).toBeInTheDocument();

    rerender(
      <SplitTextConfig
        config={{ ...config, mode: "paragraph" }}
        analyzeSchema={mixedSchema}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByRole("spinbutton", { name: /heading level/i })).not.toBeInTheDocument();
  });

  it("changing the heading-level input patches headingLevel", () => {
    const onChange = jest.fn();
    const config: SplitTextConfigValue = { ...emptyConfig, mode: "heading" };
    render(<SplitTextConfig config={config} analyzeSchema={mixedSchema} onChange={onChange} />);

    fireEvent.change(screen.getByRole("spinbutton", { name: /heading level/i }), {
      target: { value: "2" },
    });

    expect(onChange).toHaveBeenCalledWith({ ...config, headingLevel: 2 });
  });
});
