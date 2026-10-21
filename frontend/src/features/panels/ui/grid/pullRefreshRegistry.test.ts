import { PULL_REFRESH_TIMEOUT_MS, PullRefreshRegistry } from "./pullRefreshRegistry";

// HEL-1656. The registry's busy rule is "every round panel was seen refreshing and then stopped". Each test holds a
// request open by hand (refresh() is called, isRefreshing has not flipped yet), never an instantly resolving mock: with
// React batching `pending` and `fulfilled` a child could otherwise never observe `true`. Recorded mutations are noted
// beside each test.

function entry(isRefreshing = false) {
  return { refresh: jest.fn(), isRefreshing };
}

describe("PullRefreshRegistry", () => {
  afterEach(() => jest.useRealTimers());

  // mutation: skip entries.size === 0 guard -> red
  it("starts no round when no output-bound panel is registered (no busy flash)", () => {
    const registry = new PullRefreshRegistry();
    const listener = jest.fn();
    registry.subscribe(listener);
    expect(registry.start()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  // mutation: call refresh twice per entry, or call it for unregistered panels -> red
  it("calls each registered refresh exactly once", () => {
    const registry = new PullRefreshRegistry();
    const a = entry();
    const b = entry();
    registry.register("a", a);
    registry.register("b", b);
    expect(registry.start()).toBe(true);
    expect(a.refresh).toHaveBeenCalledTimes(1);
    expect(b.refresh).toHaveBeenCalledTimes(1);
  });

  // mutation: end busy on the first `false` read (the seen-true rule AND the change-only early return removed) -> red
  it("stays busy while a request is held open and ends only after it settles", () => {
    const registry = new PullRefreshRegistry();
    registry.register("a", entry());
    const listener = jest.fn();
    registry.subscribe(listener);
    registry.start();
    // refresh() was called but the pending state has not been dispatched yet: a false read means "not started".
    registry.setRefreshing("a", false);
    expect(registry.busy).toBe(true);
    registry.setRefreshing("a", true);
    expect(registry.busy).toBe(true);
    registry.setRefreshing("a", false);
    expect(registry.busy).toBe(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);
  });

  // mutation: seed seen=false for an already-refreshing panel -> red (the round would wait for the ceiling)
  it("counts a panel already in flight as seen and waits for its running request", () => {
    const registry = new PullRefreshRegistry();
    const busyPanel = entry(true);
    registry.register("a", busyPanel);
    registry.start();
    expect(busyPanel.refresh).toHaveBeenCalledTimes(1);
    expect(registry.busy).toBe(true);
    registry.setRefreshing("a", false);
    expect(registry.busy).toBe(false);
  });

  // mutation: require every panel -> any one panel ending the round -> red
  it("waits for every panel in the round", () => {
    const registry = new PullRefreshRegistry();
    registry.register("a", entry());
    registry.register("b", entry());
    registry.start();
    registry.setRefreshing("a", true);
    registry.setRefreshing("b", true);
    registry.setRefreshing("a", false);
    expect(registry.busy).toBe(true);
    registry.setRefreshing("b", false);
    expect(registry.busy).toBe(false);
  });

  // mutation: do not drop an unregistered panel from the round -> red
  it("an unmounted panel no longer holds the round open", () => {
    const registry = new PullRefreshRegistry();
    registry.register("a", entry());
    const unregisterB = registry.register("b", entry());
    registry.start();
    registry.setRefreshing("a", true);
    registry.setRefreshing("a", false);
    expect(registry.busy).toBe(true);
    unregisterB();
    expect(registry.busy).toBe(false);
  });

  // mutation: remove the timeout -> red
  it("clears busy at the safety ceiling when a request never settles", () => {
    jest.useFakeTimers();
    const registry = new PullRefreshRegistry();
    registry.register("a", entry());
    registry.start();
    registry.setRefreshing("a", true);
    jest.advanceTimersByTime(PULL_REFRESH_TIMEOUT_MS - 1);
    expect(registry.busy).toBe(true);
    jest.advanceTimersByTime(1);
    expect(registry.busy).toBe(false);
  });

  // mutation: drop the `round !== null` guard in start -> red
  it("ignores a second pull while a round is running", () => {
    const registry = new PullRefreshRegistry();
    const a = entry();
    registry.register("a", a);
    registry.start();
    expect(registry.start()).toBe(false);
    expect(a.refresh).toHaveBeenCalledTimes(1);
  });

  // mutation: notify on every register/unregister, or never -> the call-count assertions go red
  it("notifies entry subscribers only when the registry flips between empty and non-empty", () => {
    const registry = new PullRefreshRegistry();
    const listener = jest.fn();
    registry.subscribeEntries(listener);
    expect(registry.hasEntries).toBe(false);
    const offA = registry.register("a", entry());
    expect(listener).toHaveBeenLastCalledWith(true);
    const offB = registry.register("b", entry());
    expect(listener).toHaveBeenCalledTimes(1);
    offA();
    expect(listener).toHaveBeenCalledTimes(1);
    offB();
    expect(listener).toHaveBeenLastCalledWith(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.hasEntries).toBe(false);
  });

  // mutation: never record the source, or leave it set after the round ends -> red
  it("records what started the round and clears it when the round ends", () => {
    const registry = new PullRefreshRegistry();
    registry.register("a", entry());
    const seen: Array<string | null> = [];
    registry.subscribe(() => seen.push(registry.source));
    expect(registry.source).toBeNull();
    expect(registry.start("button")).toBe(true);
    expect(registry.source).toBe("button");
    // a pull (or a second button press) during the round starts nothing and keeps the source
    expect(registry.start("pull")).toBe(false);
    expect(registry.source).toBe("button");
    registry.setRefreshing("a", true);
    registry.setRefreshing("a", false);
    expect(registry.source).toBeNull();
    expect(seen).toEqual(["button", null]);
  });

  it("defaults the source to a pull", () => {
    const registry = new PullRefreshRegistry();
    registry.register("a", entry());
    registry.start();
    expect(registry.source).toBe("pull");
  });
});
