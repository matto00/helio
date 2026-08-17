// F-124 regression: the Background/Text color-input swatches must resolve
// their "no override set yet" fallback through the ACTIVE theme, not a
// frozen dark-theme constant. Before the fix, `PanelDetailModal` seeded
// `<AppearanceEditor>`'s fallback hex from `panelAppearanceEditorFallback` /
// `panelTextEditorFallback` (theme.ts's dark values, always), so a panel
// opened in light theme showed a near-black Background swatch and a
// near-white Text swatch — the exact opposite of what the panel actually
// renders in light theme.

import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeMarkdownPanel } from "../../../test/panelFixtures";
import { ThemeStorageKey } from "../../../theme/theme";
import { PanelDetailModal } from "./PanelDetailModal";

// `PanelDetailModal` pulls in `ChartPanel.tsx` (via `PanelContent` →
// `ChartRenderer`), which renders through `echarts-for-react/esm/core`
// (F-022) rather than the default `echarts-for-react` export. Mirrors the
// mock in the co-located `ChartPanel.test.tsx` — this project's CommonJS
// Jest transform can't handle `echarts`'s ESM-only subpath exports, so both
// the `/core` entry and the registration module (`echartsCore.ts`, a
// ship-time bundle-size concern only, irrelevant here) are stubbed. This
// suite never renders a chart panel itself, but the module graph still has
// to resolve.
jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

function setupDialog() {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
}

function makePanel() {
  return makeMarkdownPanel({
    id: "p1",
    title: "Notes",
    appearance: { background: "transparent", color: "inherit", transparency: 0 },
    config: { content: "# Hi" },
  });
}

describe("PanelDetailModal — theme-aware appearance-editor fallback (F-124)", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("shows the dark-theme panel surface/text fallback when the active theme is dark", () => {
    setupDialog();
    window.localStorage.setItem(ThemeStorageKey, "dark");
    renderWithStore(<PanelDetailModal panel={makePanel()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect((screen.getByLabelText("Notes background color") as HTMLInputElement).value).toBe(
      "#1a1816",
    );
    expect((screen.getByLabelText("Notes text color") as HTMLInputElement).value).toBe("#f2efe9");
  });

  it("shows the light-theme panel surface/text fallback when the active theme is light", () => {
    setupDialog();
    window.localStorage.setItem(ThemeStorageKey, "light");
    renderWithStore(<PanelDetailModal panel={makePanel()} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));

    expect((screen.getByLabelText("Notes background color") as HTMLInputElement).value).toBe(
      "#fdfcfa",
    );
    expect((screen.getByLabelText("Notes text color") as HTMLInputElement).value).toBe("#211d19");
  });
});
