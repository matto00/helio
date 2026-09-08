import { groupFieldsByNamespace, ROOT_GROUP_KEY } from "./groupFieldsByNamespace";

interface Field {
  name: string;
}

function field(name: string): Field {
  return { name };
}

const getName = (f: Field) => f.name;

describe("groupFieldsByNamespace", () => {
  it("returns an empty array for an empty input", () => {
    expect(groupFieldsByNamespace([], getName)).toEqual([]);
  });

  it("groups a dotless field under the ROOT_GROUP_KEY sentinel", () => {
    const groups = groupFieldsByNamespace([field("id"), field("name")], getName);
    expect(groups).toEqual([{ key: ROOT_GROUP_KEY, fields: [field("id"), field("name")] }]);
  });

  it("groups by the FULL prefix (everything before the last dot), not the first segment", () => {
    const fields = [
      field("player.metadata.injury_override_regular_2024_10"),
      field("player.metadata.injury_override_regular_2024_11"),
      field("player.bio.name"),
    ];
    const groups = groupFieldsByNamespace(fields, getName);
    // "player.metadata" and "player.bio" are SEPARATE groups -- proves this
    // is full-prefix grouping, not first-segment grouping (which would put
    // all three under a single "player" bucket).
    expect(groups.map((g) => g.key).sort()).toEqual(["player.bio", "player.metadata"]);
    const metadataGroup = groups.find((g) => g.key === "player.metadata");
    expect(metadataGroup?.fields).toHaveLength(2);
  });

  it("collapses ~140 same-prefix fields into a single group (the real-world case this exists for)", () => {
    const fields = Array.from({ length: 140 }, (_, i) =>
      field(`player.metadata.injury_override_regular_2024_${i}`),
    );
    const groups = groupFieldsByNamespace(fields, getName);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("player.metadata");
    expect(groups[0].fields).toHaveLength(140);
  });

  it("does not merge deeper levels together -- one level of prefix only", () => {
    // "a.b.c" and "a.b.d.e" share the segment "a.b" but NOT the same full
    // prefix ("a.b" vs "a.b.d") -- they land in different groups.
    const fields = [field("a.b.c"), field("a.b.d.e")];
    const groups = groupFieldsByNamespace(fields, getName);
    expect(groups.map((g) => g.key).sort()).toEqual(["a.b", "a.b.d"]);
  });

  it("orders groups with ROOT_GROUP_KEY first, then real namespaces alphabetically -- not insertion order", () => {
    const fields = [field("zeta.value"), field("id"), field("alpha.value"), field("name")];
    const groups = groupFieldsByNamespace(fields, getName);
    expect(groups.map((g) => g.key)).toEqual([ROOT_GROUP_KEY, "alpha", "zeta"]);
  });

  it("omits the ROOT_GROUP_KEY entry entirely when no field is dotless", () => {
    const groups = groupFieldsByNamespace([field("a.b"), field("c.d")], getName);
    expect(groups.map((g) => g.key)).toEqual(["a", "c"]);
  });

  it("preserves each field's original relative order within its group", () => {
    const fields = [field("a.x"), field("b.y"), field("a.z")];
    const groups = groupFieldsByNamespace(fields, getName);
    const aGroup = groups.find((g) => g.key === "a");
    expect(aGroup?.fields.map(getName)).toEqual(["a.x", "a.z"]);
  });
});
