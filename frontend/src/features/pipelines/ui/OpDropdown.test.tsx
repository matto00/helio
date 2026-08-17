import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { OpDropdown } from "./OpDropdown";
import { OP_TYPES } from "../state/stepNarrowing";
import type { OpType } from "../types/step";

function Harness({
  onSelect,
  onClose,
}: {
  onSelect: (opType: OpType) => void;
  onClose: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchorRef}>+ Add step</button>
      <OpDropdown anchorRef={anchorRef} onSelect={onSelect} onClose={onClose} />
    </>
  );
}

/** Stubs the trigger's measured position for the layout-effect that positions
 *  (and, per HEL sweep F-040, height-clamps) the portalled menu. */
function mockAnchorRect(rect: Partial<DOMRect>) {
  jest.spyOn(HTMLButtonElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

describe("OpDropdown", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists every configured op type as a menu item", () => {
    mockAnchorRect({ bottom: 100, left: 40, width: 120 });
    render(<Harness onSelect={jest.fn()} onClose={jest.fn()} />);

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(OP_TYPES.length);
    expect(screen.getByRole("menuitem", { name: new RegExp(OP_TYPES[0].label) })).toBeVisible();
  });

  it("reports the selected op type and closes", () => {
    mockAnchorRect({ bottom: 100, left: 40, width: 120 });
    const onSelect = jest.fn();
    const onClose = jest.fn();
    render(<Harness onSelect={onSelect} onClose={onClose} />);

    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(OP_TYPES[2].label) }));

    expect(onSelect).toHaveBeenCalledWith(OP_TYPES[2]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the scrim behind the menu is clicked", () => {
    mockAnchorRect({ bottom: 100, left: 40, width: 120 });
    const onClose = jest.fn();
    render(<Harness onSelect={jest.fn()} onClose={onClose} />);

    fireEvent.click(document.querySelector(".popover__scrim")!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // HEL sweep F-040 regression: with 21 op types, a trigger near the bottom
  // of the viewport used to leave the menu's tail end past the viewport
  // edge — unclickable and overlapping the sticky footer. The menu must now
  // clamp its own max-height to the space actually left below the trigger.
  it("clamps max-height to the space left below the trigger near the bottom of the viewport", () => {
    Object.defineProperty(window, "innerHeight", { value: 500, configurable: true });
    mockAnchorRect({ bottom: 450, left: 40, width: 120 });

    render(<Harness onSelect={jest.fn()} onClose={jest.fn()} />);

    // top = 450 + 4 = 454; available = 500 - 454 - 16 = 30 -> clamped to the 120 floor.
    expect(screen.getByRole("menu")).toHaveStyle({ maxHeight: "120px" });
  });

  it("gives the menu its full requested height when there is ample room below the trigger", () => {
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    mockAnchorRect({ bottom: 100, left: 40, width: 120 });

    render(<Harness onSelect={jest.fn()} onClose={jest.fn()} />);

    // top = 100 + 4 = 104; available = 900 - 104 - 16 = 780.
    expect(screen.getByRole("menu")).toHaveStyle({ maxHeight: "780px" });
  });

  // F-189: opening the menu left focus on the trigger button, so a keyboard
  // user could never reach the ArrowDown/ArrowUp handling below without
  // first Tabbing all the way into the body-portalled menu. The menu now
  // moves focus to its first item as soon as it renders.
  it("moves focus to the first menu item as soon as the menu opens", () => {
    mockAnchorRect({ bottom: 100, left: 40, width: 120 });
    render(<Harness onSelect={jest.fn()} onClose={jest.fn()} />);

    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
  });

  // F-189: role="menu" had no arrow-key navigation.
  it("ArrowDown/ArrowUp move focus between menu items, wrapping at both ends", () => {
    mockAnchorRect({ bottom: 100, left: 40, width: 120 });
    render(<Harness onSelect={jest.fn()} onClose={jest.fn()} />);

    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("scrim stays hidden from the accessibility tree and out of the tab order", () => {
    mockAnchorRect({ bottom: 100, left: 40, width: 120 });
    render(<Harness onSelect={jest.fn()} onClose={jest.fn()} />);

    const scrim = document.querySelector(".popover__scrim");
    expect(scrim).toHaveAttribute("aria-hidden", "true");
    expect(scrim).toHaveAttribute("tabIndex", "-1");
  });
});
