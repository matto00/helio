import { consumeReturnTo, rememberReturnTo } from "./postLoginReturnTo";

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
    rememberReturnTo("/");
    expect(consumeReturnTo()).toBeNull();
  });

  it("rememberReturnTo skips storage for null/undefined", () => {
    rememberReturnTo(null);
    rememberReturnTo(undefined);
    expect(consumeReturnTo()).toBeNull();
  });

  it("rememberReturnTo clears a previously stashed path when passed the root path", () => {
    rememberReturnTo("/pipelines/abc-123");
    rememberReturnTo("/");
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
