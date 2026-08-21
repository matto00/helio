import { readStoredDismissed, writeStoredDismissed } from "./onboardingStorage";

describe("onboardingStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("readStoredDismissed is false when nothing is stored", () => {
    expect(readStoredDismissed("user-1")).toBe(false);
  });

  it("round-trips a written value", () => {
    writeStoredDismissed("user-1", true);
    expect(readStoredDismissed("user-1")).toBe(true);

    writeStoredDismissed("user-1", false);
    expect(readStoredDismissed("user-1")).toBe(false);
  });

  it("keys are per-user — one user's dismissal does not leak into another's", () => {
    writeStoredDismissed("user-1", true);
    expect(readStoredDismissed("user-2")).toBe(false);
  });

  it("stores under the documented hyphen-family key", () => {
    writeStoredDismissed("user-42", true);
    expect(window.localStorage.getItem("helio-onboarding-dismissed-user-42")).toBe("true");
  });

  // design.md D7 / spec: "A failure to read or write the stored dismissal
  // SHALL NOT prevent the workspace from rendering."
  it("readStoredDismissed returns false (not throw) when storage raises", () => {
    const getItemSpy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => readStoredDismissed("user-1")).not.toThrow();
    expect(readStoredDismissed("user-1")).toBe(false);
    getItemSpy.mockRestore();
  });

  it("writeStoredDismissed does not throw when storage raises", () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => writeStoredDismissed("user-1", true)).not.toThrow();
    setItemSpy.mockRestore();
  });
});
