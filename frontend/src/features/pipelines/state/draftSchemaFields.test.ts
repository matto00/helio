// HEL-1777: the draft field list's type rules and the rename-origin fold it rests on.

import { decodeRow } from "../evaluator/wire";
import { renameOrigins } from "../evaluator/steps/rowOps";
import { draftSchemaFields } from "./draftSchemaFields";

const f = (name: string, type: string) => ({ name, type });
const frame = (...rows: Array<Record<string, unknown>>) => rows.map(decodeRow);

describe("renameOrigins", () => {
  it("a swap keeps each value's origin", () => {
    expect(
      renameOrigins(
        ["a", "b"],
        [
          ["a", "b"],
          ["b", "a"],
        ],
      ),
    ).toEqual([
      // a->b overwrites b (a survives at the earlier position as b); then b->a renames that survivor back
      { name: "a", originName: "a" },
    ]);
  });

  it("a rename onto an existing column overwrites it; the survivor keeps the earlier position", () => {
    expect(renameOrigins(["a", "b", "c"], [["c", "a"]])).toEqual([
      { name: "a", originName: "c" },
      { name: "b", originName: "b" },
    ]);
  });

  it("a chain follows the fold order, not insertion order", () => {
    expect(
      renameOrigins(
        ["a", "x"],
        [
          ["a", "b"],
          ["b", "c"],
        ],
      ),
    ).toEqual([
      { name: "c", originName: "a" },
      { name: "x", originName: "x" },
    ]);
    // the same two renames folded the other way round: b->c finds nothing, then a->b stops at b
    expect(
      renameOrigins(
        ["a", "x"],
        [
          ["b", "c"],
          ["a", "b"],
        ],
      ),
    ).toEqual([
      { name: "b", originName: "a" },
      { name: "x", originName: "x" },
    ]);
  });
});

describe("draftSchemaFields", () => {
  const input = [f("id", "integer"), f("region", "float")];

  it("a renamed column takes its origin's saved input type (rule 1)", () => {
    const rows = frame({ id: { $int: 1 }, zone: "a" });
    expect(
      draftSchemaFields({
        frame: rows,
        names: ["id", "zone"],
        savedOutput: input,
        savedInput: input,
        renames: [["region", "zone"]],
      }),
    ).toEqual([f("id", "integer"), f("zone", "float")]);
  });

  it("without the rename rule a renamed column falls to the inferred type (rule 3)", () => {
    const rows = frame({ id: { $int: 1 }, zone: "a" });
    expect(
      draftSchemaFields({
        frame: rows,
        names: ["id", "zone"],
        savedOutput: input,
        savedInput: input,
      }),
    ).toEqual([f("id", "integer"), f("zone", "string")]);
  });

  it("a name the saved output has keeps its saved type (rule 2)", () => {
    const rows = frame({ id: "x", region: "a" });
    expect(
      draftSchemaFields({
        frame: rows,
        names: ["region", "id"],
        savedOutput: input,
        savedInput: input,
      }),
    ).toEqual([f("region", "float"), f("id", "integer")]);
  });

  it("a swap types each name from the column its values came from", () => {
    const rows = frame({ a: 1.5, b: "t" });
    const typed = [f("a", "integer"), f("b", "string")];
    expect(
      draftSchemaFields({
        frame: rows,
        names: ["b", "a"],
        savedOutput: typed,
        savedInput: typed,
        renames: [
          ["a", "tmp"],
          ["b", "a"],
          ["tmp", "b"],
        ],
      }),
    ).toEqual([f("b", "integer"), f("a", "string")]);
  });
});
