import type { ResourceRef } from "./resourceNavigation";

// `hrefFor`/`useResourceNavigator`'s runtime behavior is covered in `resourceNavigation.test.tsx`
// (a real Router/Redux render is needed for the navigator). This file covers what a `.tsx` test
// cannot: a COMPILE-TIME guarantee.
//
// CI incident (cycle 5) — this file is DELIBERATELY named `resourceNavigation.types.test.ts`,
// NOT `resourceNavigation.test.ts`. It used to be `resourceNavigation.test.ts`, which shares its
// basename with `resourceNavigation.test.tsx` once the `.ts`/`.tsx` extension is stripped — two
// source files that both compile to the same `resourceNavigation.test.js`. ts-jest silently loses
// one of the two emits when that happens; which one is lost is NON-DETERMINISTIC (module-map
// ordering/transform-cache dependent), so it passed on every local run and every re-run
// (`npx jest --no-cache` included) but failed deterministically on a fresh CI checkout with a
// misleading `outDir` error and a suite that failed with ZERO failing tests (2936/2936 passed,
// 290/291 suites — the 291st simply never ran). Do NOT rename this back to
// `resourceNavigation.test.ts`, and do NOT merge it into the `.tsx` file (the whole point of this
// file is a compile-time guarantee a `.tsx` runtime test cannot express) — if a THIRD test file
// for this module is ever needed, give it a basename that does not collide with either existing
// one once its extension is stripped.
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
