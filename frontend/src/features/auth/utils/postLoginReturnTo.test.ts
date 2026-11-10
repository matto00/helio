import {
  consumeReturnTo,
  rememberReturnTo,
  returnPathFromState,
  safeReturnPath,
} from "./postLoginReturnTo";

describe("postLoginReturnTo", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("consumeReturnTo returns the path stashed by rememberReturnTo", () => {
    rememberReturnTo("/pipelines/abc-123");
    expect(consumeReturnTo()).toBe("/pipelines/abc-123");
  });

  it("consumeReturnTo clears the stashed path after reading it", () => {
    rememberReturnTo("/pipelines/abc-123");
    consumeReturnTo();
    expect(consumeReturnTo()).toBeNull();
  });

  it("consumeReturnTo returns null when nothing was stashed", () => {
    expect(consumeReturnTo()).toBeNull();
  });

  it("rememberReturnTo skips storage for the root path", () => {
    rememberReturnTo("/home");
    expect(consumeReturnTo()).toBeNull();
  });

  it("rememberReturnTo skips storage for null/undefined", () => {
    rememberReturnTo(null);
    rememberReturnTo(undefined);
    expect(consumeReturnTo()).toBeNull();
  });

  it("rememberReturnTo clears a previously stashed path when passed the root path", () => {
    rememberReturnTo("/pipelines/abc-123");
    rememberReturnTo("/home");
    expect(consumeReturnTo()).toBeNull();
  });

  it("does not throw when sessionStorage access fails", () => {
    const original = window.sessionStorage.setItem;
    window.sessionStorage.setItem = () => {
      throw new Error("quota exceeded");
    };
    try {
      expect(() => rememberReturnTo("/pipelines/abc-123")).not.toThrow();
    } finally {
      window.sessionStorage.setItem = original;
    }
  });
});

describe("safeReturnPath / returnPathFromState (HEL-1709)", () => {
  it.each(["/connect/mcp?request=a.b.c", "/home", "/x#frag"])("accepts %s", (p) => {
    expect(safeReturnPath(p)).toBe(p);
  });

  it.each([
    "https://evil.example/x",
    "//evil.example",
    "/\\evil.example",
    "x",
    "/a\nb",
    "",
    5,
    null,
  ])("rejects %p", (p) => {
    expect(safeReturnPath(p)).toBeNull();
  });

  it("reads a Location or a string from state.from", () => {
    expect(
      returnPathFromState({ from: { pathname: "/connect/mcp", search: "?request=r", hash: "" } }),
    ).toBe("/connect/mcp?request=r");
    expect(returnPathFromState({ from: "/pipelines/1" })).toBe("/pipelines/1");
    expect(returnPathFromState({ from: "//evil" })).toBeNull();
    expect(returnPathFromState(null)).toBeNull();
    expect(returnPathFromState({})).toBeNull();
  });
});
