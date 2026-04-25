import { fireEvent, render, screen } from "@testing-library/react";
import { AccentPicker } from "./AccentPicker";
import { ACCENT_PRESETS } from "../theme/theme";

function renderPicker(accentColor = "#f97316") {
  const setAccentColor = jest.fn();
  const utils = render(<AccentPicker accentColor={accentColor} setAccentColor={setAccentColor} />);
  return { ...utils, setAccentColor };
}

describe("AccentPicker", () => {
  it("renders all preset swatches", () => {
    renderPicker();
    ACCENT_PRESETS.forEach((preset) => {
      expect(screen.getByRole("button", { name: preset.label })).toBeInTheDocument();
    });
  });

  it("selected swatch has aria-pressed=true", () => {
    renderPicker("#f97316");
    const orangeBtn = screen.getByRole("button", { name: "Orange" });
    expect(orangeBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("non-selected swatches have aria-pressed=false", () => {
    renderPicker("#f97316");
    const blueBtn = screen.getByRole("button", { name: "Blue" });
    expect(blueBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a swatch calls setAccentColor with its hex value", () => {
    const { setAccentColor } = renderPicker("#f97316");
    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    expect(setAccentColor).toHaveBeenCalledWith("#3b82f6");
  });

  it("renders 8 swatch buttons in total", () => {
    renderPicker();
    expect(screen.getAllByRole("button")).toHaveLength(ACCENT_PRESETS.length);
  });
});
