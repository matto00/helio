import { AccentStorageKey, DefaultAccentColor, getInitialAccentColor } from "./theme";

describe("getInitialAccentColor", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the default orange when localStorage is empty", () => {
    expect(getInitialAccentColor()).toBe(DefaultAccentColor);
  });

  it("returns the stored value when one is present in localStorage", () => {
    window.localStorage.setItem(AccentStorageKey, "#3b82f6");
    expect(getInitialAccentColor()).toBe("#3b82f6");
  });
});
