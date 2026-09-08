// OutputSchemaDisclosure.test.tsx — HEL-1022. This component is only
// mounted by `PipelineDetailFooter` above the small-schema threshold, so
// every fixture here is deliberately large (well past 12 fields) to match
// the real repro (a ~200-field REST source ballooning the footer).

import { fireEvent, render, screen } from "@testing-library/react";

import { OutputSchemaDisclosure } from "./OutputSchemaDisclosure";
import type { SchemaField } from "../types/pipelineStep";

function fields(n: number): SchemaField[] {
  return Array.from({ length: n }, (_, i) => ({ name: `field_${i}`, type: "string" }));
}

function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: /fields/ }));
}

describe("OutputSchemaDisclosure", () => {
  it("renders a compact 'N fields' trigger rather than one chip per field", () => {
    render(<OutputSchemaDisclosure fields={fields(203)} />);
    expect(screen.getByRole("button", { name: "203 fields" })).toBeInTheDocument();
    // The whole point of the fix: none of the 203 field chips exist until
    // the trigger is activated.
    expect(screen.queryByText("field_0")).not.toBeInTheDocument();
  });

  it("the trigger advertises a popup and its open state", () => {
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    const trigger = screen.getByRole("button", { name: "50 fields" });
    expect(trigger).toHaveAttribute("aria-haspopup");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    openPopover();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("opening the popover reveals the field list via the shared SchemaFieldViewer", () => {
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    expect(screen.getByText("field_0")).toBeInTheDocument();
    // SchemaFieldViewer's own chrome (filter box) confirms it's the real
    // shared viewer doing the work, not a re-implementation.
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("Escape closes the popover and returns focus to the trigger", () => {
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    const trigger = screen.getByRole("button", { name: "50 fields" });
    openPopover();
    expect(screen.getByText("field_0")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("field_0")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("an outside click (the scrim) closes the popover", () => {
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    expect(screen.getByText("field_0")).toBeInTheDocument();
    const scrim = document.querySelector(".popover__scrim");
    expect(scrim).not.toBeNull();
    fireEvent.click(scrim as Element);
    expect(screen.queryByText("field_0")).not.toBeInTheDocument();
  });
});
