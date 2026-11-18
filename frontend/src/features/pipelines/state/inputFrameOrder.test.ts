// HEL-1732 (design.md D1/D6): input frames (roots and source secondaries) are re-keyed into the source's declared order.

import { decodeRow } from "../evaluator/wire";
import { evaluatePipeline, type Frame, type RootFrame, type SourceFrames } from "../evaluator";
import { createInputOrderer, reorderFrame } from "./inputFrameOrder";

const frame = (...rows: Array<Record<string, unknown>>): Frame => rows.map(decodeRow);
const keysOf = (f: Frame) => f.map((r) => Object.keys(r));

// A sample whose keys arrive in hash order, as /sample delivers them (declared: id, region, status, amount, total).
const HASHED = { total: 5, amount: 4, id: 1, status: "ok", region: "east" };
const DECLARED = ["id", "region", "status", "amount", "total"];

describe("reorderFrame", () => {
  it("re-keys every row into the declared order", () => {
    const out = reorderFrame(frame(HASHED, HASHED), DECLARED);
    expect(keysOf(out)).toEqual([DECLARED, DECLARED]);
  });

  it("puts keys the declared order does not name after it in ascending code-unit order", () => {
    const out = reorderFrame(frame({ zeta: 1, id: 2, alpha: 3 }), ["id"]);
    expect(keysOf(out)).toEqual([["id", "alpha", "zeta"]]);
  });

  it("with no declared order the keys are in code-unit order", () => {
    expect(keysOf(reorderFrame(frame(HASHED), []))).toEqual([[...DECLARED].sort()]);
  });

  it("keeps the values and does not add a key a row lacks", () => {
    const out = reorderFrame(frame({ b: 1 }, { a: 2, b: 3 }), ["a", "b"]);
    expect(keysOf(out)).toEqual([["b"], ["a", "b"]]);
    expect(out[1].b).toEqual(frame({ b: 3 })[0].b);
  });
});

describe("createInputOrderer", () => {
  const roots = (rows: Frame): RootFrame[] => [{ rootId: "r1", rows }];

  it("orders a root frame by its declared order", () => {
    const orderer = createInputOrderer();
    const [r] = orderer.rootFrames(roots(frame(HASHED)), () => DECLARED);
    expect(keysOf(r.rows)).toEqual([DECLARED]);
  });

  it("keeps each frame's identity and the array's identity while the order is unchanged", () => {
    const orderer = createInputOrderer();
    const sample = frame(HASHED);
    const first = orderer.rootFrames(roots(sample), () => DECLARED);
    // A re-delivered declared order (new array, same names) and a new RootFrame[] over the same sample object.
    const second = orderer.rootFrames(roots(sample), () => [...DECLARED]);
    expect(second[0].rows).toBe(first[0].rows);
    expect(second).toBe(first);
  });

  it("returns a new frame and array when the order changes", () => {
    const orderer = createInputOrderer();
    const sample = frame(HASHED);
    const first = orderer.rootFrames(roots(sample), () => DECLARED);
    const second = orderer.rootFrames(roots(sample), () => [...DECLARED].reverse());
    expect(second[0].rows).not.toBe(first[0].rows);
    expect(second).not.toBe(first);
    expect(keysOf(second[0].rows)).toEqual([[...DECLARED].reverse()]);
  });

  it("keeps a separate last result per slot, so the saved and draft walks do not evict each other", () => {
    const orderer = createInputOrderer();
    const sample = frame(HASHED);
    const draft = orderer.rootFrames(roots(sample), () => DECLARED, "draft");
    const saved = orderer.rootFrames(roots(sample), () => DECLARED, "saved");
    expect(orderer.rootFrames(roots(sample), () => DECLARED, "draft")).toBe(draft);
    expect(orderer.rootFrames(roots(sample), () => DECLARED, "saved")).toBe(saved);
  });

  it("orders a source secondary the same way and keeps the record's identity", () => {
    const orderer = createInputOrderer();
    const sample = frame({ b: 1, a: 2 });
    const sources: SourceFrames = { s1: { rows: sample, complete: true } };
    const first = orderer.sourceFrames(sources, () => ["a", "b"]);
    expect(keysOf(first.s1.rows)).toEqual([["a", "b"]]);
    const second = orderer.sourceFrames({ s1: { rows: sample, complete: true } }, () => ["a", "b"]);
    expect(second).toBe(first);
  });

  it("a name list is not confused by separators (['a,b'] vs ['a','b'])", () => {
    const orderer = createInputOrderer();
    const sample = frame({ "a,b": 1, a: 2, b: 3 });
    const one = orderer.rootFrames(roots(sample), () => ["a,b", "a", "b"]);
    const two = orderer.rootFrames(roots(sample), () => ["a", "b", "a,b"]);
    expect(keysOf(one[0].rows)).toEqual([["a,b", "a", "b"]]);
    expect(keysOf(two[0].rows)).toEqual([["a", "b", "a,b"]]);
  });
});

describe("a join with a source secondary (D1/D6)", () => {
  it("appends the secondary's columns in its declared order, though its sample rows arrive in hash order", () => {
    const orderer = createInputOrderer();
    const left = orderer.rootFrames([{ rootId: "r", rows: frame({ code: "e", id: 1 }) }], () => [
      "id",
      "code",
    ]);
    const secondary = frame({ size: 3, label: "East", code: "e", tier: "a" }); // hash order
    const sources = orderer.sourceFrames({ src: { rows: secondary, complete: true } }, () => [
      "code",
      "label",
      "size",
      "tier",
    ]);
    const walk = evaluatePipeline(
      [
        {
          id: "j",
          kind: "join",
          parentStepId: null,
          rootId: "r",
          position: 0,
          enabled: true,
          config: {
            joinKey: "code",
            joinType: "inner",
            secondaryInput: { kind: "source", dataSourceId: "src" },
          },
        },
      ],
      left,
      { sources },
    );
    const node = walk.nodes.get("j");
    expect(node?.status).toBe("ok");
    expect(node?.status === "ok" ? Object.keys(node.rows[0]) : []).toEqual([
      "id",
      "code",
      "label",
      "size",
      "tier",
    ]);
  });
});
