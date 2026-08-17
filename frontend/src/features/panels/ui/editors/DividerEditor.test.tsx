// F-165 regression coverage: the divider color swatch's unset-state default
// (#cccccc) is only a picker placeholder — the actually-rendered default is
// the theme's subtle hairline border (`DividerPanel.tsx`'s
// `var(--app-border-subtle)` fallback), which a `<input type="color">` can't
// display. The editor should say so instead of letting #cccccc look like the
// real default.

import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { panelsReducer } from "../../state/panelsSlice";
import type { DividerPanel } from "../../types/panel";
import { DividerEditor } from "./DividerEditor";

function makeDividerPanel(color: string | null): DividerPanel {
  return {
    id: "panel-1",
    dashboardId: "d1",
    title: "Divider",
    meta: { createdBy: "u", createdAt: "", lastUpdated: "" },
    appearance: { background: "transparent", color: "inherit", transparency: 0 },
    type: "divider",
    config: { orientation: "horizontal", weight: 1, color },
  };
}

function makeStore() {
  return configureStore({ reducer: { panels: panelsReducer } as never });
}

function renderEditor(panel: DividerPanel) {
  const store = makeStore();
  render(
    createElement(
      Provider,
      { store } as never,
      createElement(DividerEditor, { panel, onDirtyChange: jest.fn() }),
    ),
  );
}

describe("DividerEditor color swatch hint (F-165)", () => {
  it("shows the preview-only hint when the divider has never had a color set", () => {
    renderEditor(makeDividerPanel(null));
    expect(screen.getByText(/preview only/i)).toBeInTheDocument();
  });

  it("does not show the hint once a real color has been stored", () => {
    renderEditor(makeDividerPanel("#ff0000"));
    expect(screen.queryByText(/preview only/i)).toBeNull();
  });
});
