import { fireEvent, render, screen } from "@testing-library/react";

import { ContextListSeparator } from "./ContextListSeparator";
import type { ContextListLayout } from "./useContextListLayout";

function makeLayout(width = 248): ContextListLayout {
  return {
    width,
    collapsed: false,
    previewWidth: jest.fn(),
    commitWidth: jest.fn(),
    nudgeWidth: jest.fn(),
    setCollapsed: jest.fn(),
    toggleCollapsed: jest.fn(),
  };
}

function renderSeparator(layout: ContextListLayout) {
  render(
    <ContextListSeparator
      layout={layout}
      label="Resize dashboard list"
      controlsId="context-list"
    />,
  );
  return screen.getByRole("separator", { name: "Resize dashboard list" });
}

/** jsdom's `fireEvent.pointer*` drops clientX, so build the events explicitly. */
function pointer(type: string, clientX: number, extra: Record<string, unknown> = {}) {
  const event = new MouseEvent(type, { clientX, bubbles: true, button: 0, ...extra });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

describe("ContextListSeparator", () => {
  it("is an accessible, focusable vertical window splitter with the 200..400 contract", () => {
    const separator = renderSeparator(makeLayout(300));
    expect(separator).toHaveAttribute("aria-orientation", "vertical");
    expect(separator).toHaveAttribute("aria-valuemin", "200");
    expect(separator).toHaveAttribute("aria-valuemax", "400");
    expect(separator).toHaveAttribute("aria-valuenow", "300");
    expect(separator).toHaveAttribute("aria-controls", "context-list");
    expect(separator).toHaveAttribute("tabindex", "0");
  });

  it("steps 16px with the arrow keys and 64px with Shift", () => {
    const layout = makeLayout(300);
    const separator = renderSeparator(layout);
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(layout.nudgeWidth).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(layout.nudgeWidth).toHaveBeenLastCalledWith(284);
    fireEvent.keyDown(separator, { key: "ArrowRight", shiftKey: true });
    expect(layout.nudgeWidth).toHaveBeenLastCalledWith(364);
    fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
    expect(layout.nudgeWidth).toHaveBeenLastCalledWith(236);
  });

  it("clamps at the maximum and minimum", () => {
    const wide = makeLayout(396);
    fireEvent.keyDown(renderSeparator(wide), { key: "ArrowRight" });
    expect(wide.nudgeWidth).toHaveBeenLastCalledWith(400);
  });

  it("clamps at the minimum", () => {
    const narrow = makeLayout(205);
    fireEvent.keyDown(renderSeparator(narrow), { key: "ArrowLeft" });
    expect(narrow.nudgeWidth).toHaveBeenLastCalledWith(200);
  });

  it("jumps to the minimum on Home and the maximum on End", () => {
    const layout = makeLayout(300);
    const separator = renderSeparator(layout);
    fireEvent.keyDown(separator, { key: "Home" });
    expect(layout.nudgeWidth).toHaveBeenLastCalledWith(200);
    fireEvent.keyDown(separator, { key: "End" });
    expect(layout.nudgeWidth).toHaveBeenLastCalledWith(400);
  });

  it("toggles collapse on Enter and on double-click", () => {
    const layout = makeLayout();
    const separator = renderSeparator(layout);
    fireEvent.keyDown(separator, { key: "Enter" });
    expect(layout.toggleCollapsed).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(separator);
    expect(layout.toggleCollapsed).toHaveBeenCalledTimes(2);
  });

  it("ignores unrelated keys", () => {
    const layout = makeLayout();
    fireEvent.keyDown(renderSeparator(layout), { key: "a" });
    expect(layout.nudgeWidth).not.toHaveBeenCalled();
    expect(layout.toggleCollapsed).not.toHaveBeenCalled();
  });

  it("a drag previews per move and commits exactly once on release", () => {
    const layout = makeLayout(248);
    const separator = renderSeparator(layout);
    separator.dispatchEvent(pointer("pointerdown", 100));
    separator.dispatchEvent(pointer("pointermove", 130));
    separator.dispatchEvent(pointer("pointermove", 160));
    expect(layout.previewWidth).toHaveBeenLastCalledWith(308);
    expect(layout.commitWidth).not.toHaveBeenCalled();
    separator.dispatchEvent(pointer("pointerup", 160));
    expect(layout.commitWidth).toHaveBeenCalledTimes(1);
    expect(layout.commitWidth).toHaveBeenCalledWith(308);
  });

  it("dragging 500px left clamps to 200", () => {
    const layout = makeLayout(300);
    const separator = renderSeparator(layout);
    separator.dispatchEvent(pointer("pointerdown", 600));
    separator.dispatchEvent(pointer("pointermove", 100));
    separator.dispatchEvent(pointer("pointerup", 100));
    expect(layout.commitWidth).toHaveBeenCalledWith(200);
  });

  it("a cancelled drag restores the width and writes nothing", () => {
    const layout = makeLayout(300);
    const separator = renderSeparator(layout);
    separator.dispatchEvent(pointer("pointerdown", 100));
    separator.dispatchEvent(pointer("pointermove", 200));
    separator.dispatchEvent(pointer("pointercancel", 200));
    expect(layout.commitWidth).not.toHaveBeenCalled();
    expect(layout.previewWidth).toHaveBeenLastCalledWith(300);
  });

  it("a click without movement writes nothing", () => {
    const layout = makeLayout(300);
    const separator = renderSeparator(layout);
    separator.dispatchEvent(pointer("pointerdown", 100));
    separator.dispatchEvent(pointer("pointerup", 100));
    expect(layout.commitWidth).not.toHaveBeenCalled();
  });
});
