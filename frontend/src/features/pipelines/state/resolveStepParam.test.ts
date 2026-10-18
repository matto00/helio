// HEL-1668 D1: the `?step=` id-or-render-key resolver shared by the desktop selection and the phone deep link.
import { resolveStepParam } from "./resolveStepParam";
import { OP_TYPES, makeStep } from "./stepNarrowing";

const steps = [
  { ...makeStep(OP_TYPES[0]), id: "s1" },
  { ...makeStep(OP_TYPES[0]), id: "s2", renderKey: "temp-9" },
];

describe("resolveStepParam", () => {
  it("resolves a step id", () => {
    expect(resolveStepParam(steps, "s1")).toBe("s1");
  });

  it("resolves a created step's render key to its current id", () => {
    expect(resolveStepParam(steps, "temp-9")).toBe("s2");
  });

  it("returns null for null and for an unknown value", () => {
    expect(resolveStepParam(steps, null)).toBeNull();
    expect(resolveStepParam(steps, "nope")).toBeNull();
  });
});
