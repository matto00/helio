import { buildNodeCapabilities, canonicalFieldType } from "./nodeCapabilities";
import parity from "./__fixtures__/nodeCapabilitiesParity.json";

// A GUARD, not a proof: the Scala side asserts the same file (`NodeCapabilitiesParitySpec`). Recorded mutations: changing one
// slot eligibility in `nodeCapabilities.ts` reds this suite; changing one expected value in the fixture reds the Scala spec.
describe("buildNodeCapabilities against the server's parity fixture (HEL-1733 D7)", () => {
  it.each(parity.capabilities)("$name", (c) => {
    const built = buildNodeCapabilities(c.schema);
    expect(built.columns.map(({ name, dataType }) => ({ name, dataType }))).toEqual(c.columns);
    for (const [kind, expected] of Object.entries(c.capabilities)) {
      const got = built.capabilities[kind];
      expect(got).toBeDefined();
      expect(got.bindable).toBe(expected.bindable);
      expect(got.requiredSlots).toEqual(expected.requiredSlots);
      expect(got.optionalSlots).toEqual(expected.optionalSlots);
      expect(got.eligibleColumns).toEqual(expected.eligibleColumns);
      expect(got.reason ?? null).toBe(expected.reason);
      expect(got.message ?? null).toBe(expected.message);
    }
    expect(Object.keys(built.capabilities).sort()).toEqual(Object.keys(c.capabilities).sort());
  });
});

describe("a wire type the server never sends (defensive port)", () => {
  it("normalises the synonyms and drops an unknown type", () => {
    expect(
      ["number", "double", "long", "date", "string-body", "nonsense"].map(canonicalFieldType),
    ).toEqual(["float", "float", "integer", "timestamp", "string-body", null]);
    const built = buildNodeCapabilities([
      { name: "a", type: "nonsense" },
      { name: "d", type: "date" },
    ]);
    expect(built.columns).toEqual([{ name: "d", dataType: "timestamp", nullable: false }]);
    expect(built.capabilities.timeline.eligibleColumns.time).toEqual(["d"]);
  });
});
