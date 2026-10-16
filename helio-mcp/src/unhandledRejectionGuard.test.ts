import { EventEmitter } from "node:events";
import { installUnhandledRejectionGuard } from "./unhandledRejectionGuard.js";

describe("installUnhandledRejectionGuard (HEL-1617)", () => {
  function setup() {
    const proc = new EventEmitter();
    const lines: string[] = [];
    installUnhandledRejectionGuard(proc, (l) => lines.push(l));
    return { proc, lines };
  }

  it("logs a stderr line for an Error rejection and does not throw or exit", () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const { proc, lines } = setup();
      expect(() => proc.emit("unhandledRejection", new Error("boom"))).not.toThrow();
      expect(lines).toEqual(["helio-mcp: unhandled rejection: boom\n"]);
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  it("stringifies non-Error reasons", () => {
    const { proc, lines } = setup();
    proc.emit("unhandledRejection", "plain");
    expect(lines).toEqual(["helio-mcp: unhandled rejection: plain\n"]);
  });

  it("bounds the logged message to 500 chars", () => {
    const { proc, lines } = setup();
    proc.emit("unhandledRejection", new Error("x".repeat(2000)));
    expect(lines[0]).toBe(`helio-mcp: unhandled rejection: ${"x".repeat(500)}... [truncated]\n`);
  });
});
