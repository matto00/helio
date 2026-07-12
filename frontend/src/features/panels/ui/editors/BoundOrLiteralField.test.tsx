import { fireEvent, render, screen } from "@testing-library/react";

import { BoundOrLiteralField, defaultBoundOrLiteralMode } from "./BoundOrLiteralField";
import type { SelectOption } from "../../../../shared/ui/index";

const fieldOptions: SelectOption[] = [
  { value: "", label: "— None —" },
  { value: "rating", label: "rating" },
  { value: "title", label: "title" },
];

function renderField(overrides: Partial<Parameters<typeof BoundOrLiteralField>[0]> = {}) {
  const props = {
    label: "Label",
    mode: "field" as const,
    onModeChange: jest.fn(),
    fieldOptions,
    fieldValue: "",
    onFieldChange: jest.fn(),
    literalValue: "",
    onLiteralChange: jest.fn(),
    ...overrides,
  };
  render(<BoundOrLiteralField {...props} />);
  return props;
}

describe("defaultBoundOrLiteralMode", () => {
  it("returns 'literal' when a literal override is set", () => {
    expect(defaultBoundOrLiteralMode(true)).toBe("literal");
  });

  it("returns 'field' when no literal override is set", () => {
    expect(defaultBoundOrLiteralMode(false)).toBe("field");
  });
});

describe("BoundOrLiteralField", () => {
  it("renders a field-select dropdown in 'field' mode", () => {
    renderField({ mode: "field" });
    expect(screen.getByLabelText("Label field")).toBeInTheDocument();
    expect(screen.queryByLabelText("Label text")).not.toBeInTheDocument();
  });

  it("renders a text input in 'literal' mode", () => {
    renderField({ mode: "literal", literalValue: "Revenue" });
    expect(screen.getByLabelText("Label text")).toBeInTheDocument();
    expect(screen.queryByLabelText("Label field")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Label text")).toHaveValue("Revenue");
  });

  it("calls onModeChange when the toggle buttons are clicked", () => {
    const onModeChange = jest.fn();
    renderField({ mode: "field", onModeChange });

    fireEvent.click(screen.getByRole("button", { name: "Fixed text" }));
    expect(onModeChange).toHaveBeenCalledWith("literal");
  });

  it("marks the active mode button with aria-pressed", () => {
    renderField({ mode: "literal" });
    expect(screen.getByRole("button", { name: "Bind to field" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Fixed text" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("propagates literal text edits via onLiteralChange (controlled value)", () => {
    const onLiteralChange = jest.fn();
    renderField({ mode: "literal", literalValue: "", onLiteralChange });

    fireEvent.change(screen.getByLabelText("Label text"), { target: { value: "Revenue" } });
    expect(onLiteralChange).toHaveBeenCalledWith("Revenue");
  });

  it("propagates field selection via onFieldChange", () => {
    const onFieldChange = jest.fn();
    renderField({ mode: "field", onFieldChange });

    fireEvent.click(screen.getByLabelText("Label field"));
    fireEvent.click(screen.getByRole("option", { name: "rating" }));
    expect(onFieldChange).toHaveBeenCalledWith("rating");
  });

  // HEL-244 — additive `literalMultiline` prop (Decision 3): default `false`
  // preserves today's single-line behavior; existing Metric call sites above
  // (no `literalMultiline` passed) already exercise that default unmodified.
  describe("literalMultiline", () => {
    it("renders a single-line text field in literal mode when omitted (default false)", () => {
      renderField({ mode: "literal", literalValue: "Revenue" });
      const input = screen.getByLabelText("Label text");
      expect(input.tagName).toBe("INPUT");
    });

    it("renders a multiline textarea in literal mode when literalMultiline is true", () => {
      renderField({ mode: "literal", literalValue: "Hello world", literalMultiline: true });
      const input = screen.getByLabelText("Label text");
      expect(input.tagName).toBe("TEXTAREA");
      expect(input).toHaveValue("Hello world");
    });

    it("does not render a textarea in field mode even when literalMultiline is true", () => {
      renderField({ mode: "field", literalMultiline: true });
      expect(screen.getByLabelText("Label field")).toBeInTheDocument();
      expect(screen.queryByLabelText("Label text")).not.toBeInTheDocument();
    });

    it("propagates textarea edits via onLiteralChange when literalMultiline is true", () => {
      const onLiteralChange = jest.fn();
      renderField({ mode: "literal", literalValue: "", literalMultiline: true, onLiteralChange });

      fireEvent.change(screen.getByLabelText("Label text"), {
        target: { value: "Multi\nline" },
      });
      expect(onLiteralChange).toHaveBeenCalledWith("Multi\nline");
    });
  });
});
