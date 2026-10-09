// HEL-1442: guards the CI-identity invariant of the local jest caps (C4): under CI the helper contributes NO keys,
// so `jest --showConfig` is unchanged there; locally the caps apply; a bad override throws instead of uncapping.
const path = require("path");
const { localJestCaps, LOCAL_MAX_WORKERS } = require("./jest-local-caps.cjs");

describe("localJestCaps", () => {
  it("contributes no keys at all when CI is set", () => {
    expect(localJestCaps("/x", { CI: "true" })).toEqual({});
    expect(localJestCaps("/x", { CI: "true", HELIO_JEST_MAX_WORKERS: "abc" })).toEqual({});
  });

  it("caps workers at or below CI's 3 and moves the cache on disk when CI is unset", () => {
    const caps = localJestCaps("/repo", {});
    expect(caps.maxWorkers).toBe(LOCAL_MAX_WORKERS);
    expect(caps.maxWorkers).toBeLessThanOrEqual(3);
    expect(caps.workerIdleMemoryLimit).toBeDefined();
    expect(caps.cacheDirectory).toBe(path.join("/repo", ".jest-cache"));
  });

  it("honours HELIO_JEST_MAX_WORKERS for a one-off run", () => {
    expect(localJestCaps("/repo", { HELIO_JEST_MAX_WORKERS: "2" }).maxWorkers).toBe(2);
  });

  it.each(["abc", "0", "-1", "1.5", " 2"])("rejects the invalid override %p by name", (bad) => {
    expect(() => localJestCaps("/repo", { HELIO_JEST_MAX_WORKERS: bad })).toThrow(
      /HELIO_JEST_MAX_WORKERS/,
    );
  });
});
