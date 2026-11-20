import { bumpSessionEpoch, dispatchIfSameSession, getSessionEpoch } from "./sessionEpoch";
import {
  declareSessionResetCoverage,
  listDeclaredCoverage,
  listSessionResets,
  registerSessionReset,
  runSessionResets,
} from "./sessionReset";

describe("sessionReset registry", () => {
  test("runs every registered hook", () => {
    const a = jest.fn();
    const b = jest.fn();
    registerSessionReset("test-a", { covers: ["x.ts#a"], reset: a });
    registerSessionReset("test-b", { covers: ["x.ts#b"], reset: b });
    runSessionResets();
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  test("a hook that throws does not stop the others", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const after = jest.fn();
    registerSessionReset("test-throws", {
      covers: [],
      reset: () => {
        throw new Error("boom");
      },
    });
    registerSessionReset("test-after", { covers: [], reset: after });
    runSessionResets();
    expect(after).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("registration is idempotent by name", () => {
    const first = jest.fn();
    const second = jest.fn();
    registerSessionReset("test-idem", { covers: ["a.ts#one"], reset: first });
    registerSessionReset("test-idem", { covers: ["a.ts#two"], reset: second });
    expect(listSessionResets().filter((h) => h.name === "test-idem")).toEqual([
      { name: "test-idem", covers: ["a.ts#two"] },
    ]);
    runSessionResets();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  test("declared coverage is listed and replaced per file and mechanism", () => {
    declareSessionResetCoverage("f.ts", ["a"], "clearWarm");
    declareSessionResetCoverage("f.ts", ["a", "b"], "clearWarm");
    expect(listDeclaredCoverage().filter((c) => c.file === "f.ts")).toEqual([
      { file: "f.ts", identifiers: ["a", "b"], via: "clearWarm" },
    ]);
  });
});

describe("session epoch", () => {
  test("dispatchIfSameSession dispatches in the same session and drops after a bump", () => {
    const dispatch = jest.fn();
    const start = getSessionEpoch();
    expect(dispatchIfSameSession(dispatch, start, { type: "x" })).toBe(true);
    bumpSessionEpoch();
    expect(dispatchIfSameSession(dispatch, start, { type: "y" })).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
