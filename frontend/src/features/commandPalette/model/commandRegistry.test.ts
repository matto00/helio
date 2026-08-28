// The moduleNameMapper-driven envMock forces IS_DEV to false under Jest (F-002); the duplicate-id
// warning is a dev-only path, so override it just for this suite to exercise that branch.
jest.mock("../../../config/env", () => ({ IS_DEV: true }));

import { createCommandRegistry } from "./commandRegistry";
import type { CommandAction } from "./types";

function makeAction(id: string, overrides: Partial<CommandAction> = {}): CommandAction {
  return { id, title: id, run: jest.fn(), ...overrides };
}

describe("commandRegistry", () => {
  it("register makes actions visible via getActions", () => {
    const registry = createCommandRegistry();
    registry.register([makeAction("a"), makeAction("b")]);
    expect(
      registry
        .getActions()
        .map((a) => a.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("disposing removes only that registrant's actions, leaving others untouched", () => {
    const registry = createCommandRegistry();
    const disposeA = registry.register([makeAction("a")]);
    registry.register([makeAction("b")]);

    disposeA();

    expect(registry.getActions().map((a) => a.id)).toEqual(["b"]);
  });

  it("disposing twice is a safe no-op", () => {
    const registry = createCommandRegistry();
    const dispose = registry.register([makeAction("a")]);
    dispose();
    expect(() => dispose()).not.toThrow();
    expect(registry.getActions()).toEqual([]);
  });

  it("warns in dev on a duplicate id and keeps the first registrant's action", () => {
    const registry = createCommandRegistry();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const first = makeAction("dup", { title: "First" });
    const second = makeAction("dup", { title: "Second" });
    registry.register([first]);
    registry.register([second]);

    expect(warnSpy).toHaveBeenCalled();
    expect(registry.getActions()).toHaveLength(1);
    expect(registry.getActions()[0].title).toBe("First");

    warnSpy.mockRestore();
  });

  it("setQuery/getQuery round-trip and notify subscribers", () => {
    const registry = createCommandRegistry();
    const listener = jest.fn();
    registry.subscribe(listener);

    registry.setQuery("hello");

    expect(registry.getQuery()).toBe("hello");
    expect(listener).toHaveBeenCalled();
  });

  it("setQuery with the same value does not notify again", () => {
    const registry = createCommandRegistry();
    registry.setQuery("hello");
    const listener = jest.fn();
    registry.subscribe(listener);

    registry.setQuery("hello");

    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribe returns an unsubscribe function", () => {
    const registry = createCommandRegistry();
    const listener = jest.fn();
    const unsubscribe = registry.subscribe(listener);
    unsubscribe();

    registry.setQuery("hello");

    expect(listener).not.toHaveBeenCalled();
  });

  it("registering while another registrant is active does not disturb it", () => {
    const registry = createCommandRegistry();
    registry.register([makeAction("a")]);
    registry.register([makeAction("b")]);
    registry.register([makeAction("c")]);

    expect(
      registry
        .getActions()
        .map((a) => a.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });
});
