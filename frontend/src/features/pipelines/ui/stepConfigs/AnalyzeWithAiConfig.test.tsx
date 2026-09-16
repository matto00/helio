import { fireEvent, render, screen } from "@testing-library/react";
import { AnalyzeWithAiConfig } from "./AnalyzeWithAiConfig";
import {
  MAX_OUTPUT_SCHEMA_ENTRIES,
  type AnalyzeWithAiConfigValue,
} from "../../state/stepNarrowing";
import type { SchemaField } from "../../types/pipelineStep";

function chooseSelectOption(comboboxName: string | RegExp, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

const mixedSchema: SchemaField[] = [
  { name: "content", type: "string-body" },
  { name: "title", type: "string" },
  { name: "score", type: "number" },
];

const emptyConfig: AnalyzeWithAiConfigValue = { inputField: "", instruction: "", outputSchema: [] };

describe("AnalyzeWithAiConfig", () => {
  // Scenario: Only string-bearing fields are offerable
  it("input field picker offers only string/string-body fields", () => {
    render(
      <AnalyzeWithAiConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /input field to analyze/i }));
    expect(screen.getByRole("option", { name: "content" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "title" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "score" })).not.toBeInTheDocument();
  });

  // Scenario: The type control offers exactly four types
  it("output field type control offers exactly the four model-producible types", () => {
    const config: AnalyzeWithAiConfigValue = {
      inputField: "content",
      instruction: "x",
      outputSchema: [{ name: "a", type: "string" }],
    };
    render(
      <AnalyzeWithAiConfig config={config} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /output field 1 type/i }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "string",
      "integer",
      "float",
      "boolean",
    ]);
  });

  // Scenario: Reordering changes the emitted order
  it("moving the second field above the first reorders the emitted array", () => {
    const onChange = jest.fn();
    const config: AnalyzeWithAiConfigValue = {
      inputField: "content",
      instruction: "x",
      outputSchema: [
        { name: "b", type: "string" },
        { name: "a", type: "string" },
      ],
    };
    render(<AnalyzeWithAiConfig config={config} analyzeSchema={mixedSchema} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /move output field 2 up/i }));
    expect(onChange).toHaveBeenCalledWith({
      ...config,
      outputSchema: [
        { name: "a", type: "string" },
        { name: "b", type: "string" },
      ],
    });
  });

  // Scenario: A 51st declared field cannot be added
  it("disables adding a field past the MAX_OUTPUT_SCHEMA_ENTRIES cap and states the limit", () => {
    const config: AnalyzeWithAiConfigValue = {
      inputField: "content",
      instruction: "x",
      outputSchema: Array.from({ length: MAX_OUTPUT_SCHEMA_ENTRIES }, (_, i) => ({
        name: `f${i}`,
        type: "string" as const,
      })),
    };
    render(
      <AnalyzeWithAiConfig config={config} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.getByRole("button", { name: /add output field/i })).toBeDisabled();
    expect(screen.getByText(/limit reached/i)).toBeInTheDocument();
  });

  // Scenario: An empty declared name is flagged (skeptic-final-1.md CR1) — a
  // blank declared row was previously unreachable by both name-level checks
  // (both gated on `trimmedName !== ""`), so the card looked complete and
  // silently could never save.
  it("flags a blank declared name, wired for both sighted and non-visual discovery", () => {
    const config: AnalyzeWithAiConfigValue = {
      inputField: "content",
      instruction: "x",
      outputSchema: [{ name: "", type: "string" }],
    };
    render(
      <AnalyzeWithAiConfig config={config} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.getByText(/output field name is required/i)).toBeInTheDocument();

    const nameInput = screen.getByRole("textbox", { name: /output field 1 name/i });
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    const describedBy = nameInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /output field name is required/i,
    );
  });

  it("does not flag a filled declared name as empty", () => {
    const config: AnalyzeWithAiConfigValue = {
      inputField: "content",
      instruction: "x",
      outputSchema: [{ name: "sentiment", type: "string" }],
    };
    render(
      <AnalyzeWithAiConfig config={config} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.queryByText(/output field name is required/i)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /output field 1 name/i })).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  // Scenario: A duplicate declared name is flagged
  it("flags a duplicate declared name", () => {
    const config: AnalyzeWithAiConfigValue = {
      inputField: "content",
      instruction: "x",
      outputSchema: [
        { name: "a", type: "string" },
        { name: "a", type: "integer" },
      ],
    };
    render(
      <AnalyzeWithAiConfig config={config} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.getAllByText(/declared more than once/i).length).toBeGreaterThan(0);
  });

  // Scenario: A declared name colliding with the input field is flagged
  it("flags a declared name that collides with inputField", () => {
    const config: AnalyzeWithAiConfigValue = {
      inputField: "content",
      instruction: "x",
      outputSchema: [{ name: "content", type: "string" }],
    };
    render(
      <AnalyzeWithAiConfig config={config} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.getByText(/collides with the input field/i)).toBeInTheDocument();
  });

  // Scenario: An empty declared schema is flagged
  it("flags an empty declared schema", () => {
    render(
      <AnalyzeWithAiConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.getByText(/at least one output field is required/i)).toBeInTheDocument();
  });

  // Cost/quota disclosure (pipeline-ai-step-authoring spec)
  it("discloses per-row model cost, no-auto-run and the pipeline's estimated row count", () => {
    render(
      <AnalyzeWithAiConfig
        config={emptyConfig}
        analyzeSchema={mixedSchema}
        estimatedRows={1234}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText(/calls the ai model once per input row/i)).toBeInTheDocument();
    expect(screen.getByText(/never runs automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/1234/)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  // evaluation-1.md CR4 (task 4.4) — keyboard-driven completion of the
  // ordered-row move controls. The move/remove buttons are plain native
  // `<button type="button">` elements (no custom `role`/keydown handler of
  // their own), so the WHOLE keyboard-operability contract reduces to two
  // platform guarantees this test asserts directly rather than assumes:
  // (1) the control is genuinely in the keyboard tab order (a real
  // `<button>`, not `tabIndex={-1}`, not `disabled`, not `aria-hidden`) and
  // reachable via `.focus()`; (2) a native `<button>` fires a `click` on
  // Enter/Space release — a browser-level default action jsdom's `fireEvent`
  // does not synthesize without `@testing-library/user-event` (not a
  // dependency here), so this test exercises the SAME handler that
  // Enter/Space would reach, after confirming the button is genuinely
  // focusable — the one implementation-specific precondition native
  // Enter/Space activation depends on. (skeptic-final-1.md non-blocking:
  // no decorative `keyDown`/`keyUp` bracketing the click — they exercised
  // nothing and invited misreading this as a real synthesized-keypress test.)
  it("the move-up control is a real, focusable, non-disabled button reachable by keyboard, and activating it reorders", () => {
    const onChange = jest.fn();
    const config: AnalyzeWithAiConfigValue = {
      inputField: "content",
      instruction: "x",
      outputSchema: [
        { name: "b", type: "string" },
        { name: "a", type: "string" },
      ],
    };
    render(<AnalyzeWithAiConfig config={config} analyzeSchema={mixedSchema} onChange={onChange} />);

    const moveUpButton = screen.getByRole("button", { name: /move output field 2 up/i });
    expect(moveUpButton.tagName).toBe("BUTTON");
    expect(moveUpButton).not.toBeDisabled();
    expect(moveUpButton).not.toHaveAttribute("tabindex", "-1");
    expect(moveUpButton).not.toHaveAttribute("aria-hidden");

    moveUpButton.focus();
    expect(moveUpButton).toHaveFocus();
    fireEvent.click(moveUpButton);

    expect(onChange).toHaveBeenCalledWith({
      ...config,
      outputSchema: [
        { name: "a", type: "string" },
        { name: "b", type: "string" },
      ],
    });
  });

  it("the disabled boundary move-down control at the last row is excluded from keyboard activation", () => {
    const config: AnalyzeWithAiConfigValue = {
      inputField: "content",
      instruction: "x",
      outputSchema: [
        { name: "a", type: "string" },
        { name: "b", type: "string" },
      ],
    };
    render(
      <AnalyzeWithAiConfig config={config} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );

    const lastRowMoveDown = screen.getByRole("button", { name: /move output field 2 down/i });
    expect(lastRowMoveDown).toBeDisabled();
  });

  it("selecting an input field does not touch outputSchema", () => {
    const onChange = jest.fn();
    render(
      <AnalyzeWithAiConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={onChange} />,
    );
    chooseSelectOption(/input field to analyze/i, "content");
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, inputField: "content" });
  });
});
