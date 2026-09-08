import type { ResourceRef } from "./resourceNavigation";

// `hrefFor`/`useResourceNavigator`'s runtime behavior is covered in `resourceNavigation.test.tsx`
// (a real Router/Redux render is needed for the navigator). This file covers what a `.tsx` test
// cannot: a COMPILE-TIME guarantee.
describe("ResourceRef — HEL-503 design.md D1, task 1.1", () => {
  // The union makes an Output ref without `pipelineId` UNREPRESENTABLE. This line itself errors
  // (failing typecheck) if `ResourceRef`'s output arm ever became optional/flat instead of a
  // discriminated union — confirmed directly: flattening it to `{ kind, id, pipelineId?: string }`
  // turns this `@ts-expect-error` into a real TS2578 ("Unused '@ts-expect-error' directive"),
  // failing the suite. Restoring the union fixes it. Both runs observed, not inferred.
  it("an output ref without pipelineId does not compile", () => {
    // @ts-expect-error — pipelineId is required for kind "output"; this must NOT typecheck.
    const invalid: ResourceRef = { kind: "output", id: "o1" };
    expect(invalid).toBeDefined();
  });
});
