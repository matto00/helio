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

describe("OutputSchemaDisclosure panel placement (HEL-1582)", () => {
  const originalWidth = window.innerWidth;
  afterEach(() => {
    jest.restoreAllMocks();
    window.innerWidth = originalWidth;
  });

  it("keeps the panel inside the viewport when the trigger sits near the right edge", () => {
    window.innerWidth = 390;
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 276,
      right: 348,
      top: 424,
      bottom: 441,
      width: 72,
      height: 17,
      x: 276,
      y: 424,
      toJSON: () => ({}),
    });
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const left = parseFloat(screen.getByRole("dialog", { name: "Output schema" }).style.left);
    // 390 wide: the panel is 350 wide, so it must start at or before 390 - 350 - 8.
    expect(left).toBeLessThanOrEqual(32);
    expect(left).toBeGreaterThanOrEqual(8);
  });
});

describe("OutputSchemaDisclosure portal target and vertical placement (HEL-1582)", () => {
  const originalHeight = window.innerHeight;
  afterEach(() => {
    jest.restoreAllMocks();
    window.innerHeight = originalHeight;
  });

  it("portals the panel into the open <dialog> its trigger sits in (or it renders behind the modal)", () => {
    render(
      <dialog open data-testid="host">
        <OutputSchemaDisclosure fields={fields(50)} />
      </dialog>,
    );
    openPopover();
    expect(screen.getByTestId("host")).toContainElement(
      screen.getByRole("dialog", { name: "Output schema" }),
    );
  });

  it("portals the panel to the body when the trigger is not inside an open dialog", () => {
    const { container } = render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const panel = screen.getByRole("dialog", { name: "Output schema" });
    expect(container).not.toContainElement(panel);
    expect(panel.closest("dialog")).toBeNull();
  });

  function triggerAt(top: number) {
    jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 20,
      right: 92,
      top,
      bottom: top + 17,
      width: 72,
      height: 17,
      x: 20,
      y: top,
      toJSON: () => ({}),
    });
  }

  it("opens below, with its height capped to the room, when the trigger is near the top", () => {
    window.innerHeight = 844;
    triggerAt(120);
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const style = screen.getByRole("dialog", { name: "Output schema" }).style;
    expect(style.top).not.toBe("");
    expect(style.bottom).toBe("");
    expect(parseFloat(style.maxHeight)).toBeLessThanOrEqual(384);
  });

  it("opens above, as before, when the trigger has room above it", () => {
    window.innerHeight = 844;
    triggerAt(700);
    render(<OutputSchemaDisclosure fields={fields(50)} />);
    openPopover();
    const style = screen.getByRole("dialog", { name: "Output schema" }).style;
    expect(style.bottom).not.toBe("");
    expect(style.top).toBe("");
  });
});

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
