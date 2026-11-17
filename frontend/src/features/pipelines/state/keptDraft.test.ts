import { KEPT_DRAFT_PREFIX, readKeptDraft, writeKeptDraft } from "./keptDraft";
import { EMPTY_OVERLAY } from "./pipelineDraft";

const key = KEPT_DRAFT_PREFIX + "p1";
const put = (value: unknown) => window.sessionStorage.setItem(key, JSON.stringify(value));

beforeEach(() => window.sessionStorage.clear());

describe("kept draft v2 (HEL-1684)", () => {
  it("round-trips every op kind", () => {
    const overlay = {
      ...EMPTY_OVERLAY,
      ops: [
        { kind: "delete", stepId: "a" },
        {
          kind: "insert",
          clientId: "draft-1",
          type: "limit",
          config: { count: 1 },
          anchor: { after: "b" },
        },
        { kind: "insert", clientId: "draft-2", type: "limit", config: {}, anchor: { head: "r1" } },
        {
          kind: "insert",
          clientId: "draft-3",
          type: "limit",
          config: {},
          anchor: { append: "r1" },
        },
        { kind: "lane", clientId: "draft-4", type: "limit", config: {}, parent: "b" },
        {
          kind: "duplicate",
          clientId: "draft-5",
          of: "b",
          type: "limit",
          config: {},
          enabled: false,
        },
        { kind: "reorder", rootId: "r1", trunk: ["b", "a"] },
      ],
      configs: { "draft-1": { count: 2 } },
      enabled: { b: false },
    } as const;
    writeKeptDraft("p1", { overlay: overlay as never, base: "sig" });
    expect(readKeptDraft("p1")).toEqual({ overlay, base: "sig" });
  });

  it("restores a draft kept in the earlier format as delete ops", () => {
    put({
      overlay: { configs: { a: { count: 4 } }, enabled: {}, deleted: ["b", "c"] },
      base: "sig",
    });
    expect(readKeptDraft("p1")).toEqual({
      base: "sig",
      overlay: {
        version: 2,
        ops: [
          { kind: "delete", stepId: "b" },
          { kind: "delete", stepId: "c" },
        ],
        configs: { a: { count: 4 } },
        enabled: {},
      },
    });
  });

  it.each([
    ["an unknown op kind", { kind: "teleport", stepId: "a" }],
    [
      "a duplicate missing its config",
      { kind: "duplicate", clientId: "draft-1", of: "b", type: "limit", enabled: true },
    ],
    [
      "a duplicate missing its enabled flag",
      { kind: "duplicate", clientId: "draft-1", of: "b", type: "limit", config: {} },
    ],
    [
      "an insert with no anchor",
      { kind: "insert", clientId: "draft-1", type: "limit", config: {} },
    ],
    [
      "a reorder whose trunk holds a non-string",
      { kind: "reorder", rootId: "r1", trunk: ["a", 2] },
    ],
  ])("rejects the whole kept draft for %s", (_name, op) => {
    put({
      overlay: { version: 2, ops: [{ kind: "delete", stepId: "a" }, op], configs: {}, enabled: {} },
      base: "sig",
    });
    expect(readKeptDraft("p1")).toBeNull();
  });

  it("reads malformed JSON, a future version and a missing base as absent", () => {
    window.sessionStorage.setItem(key, "{not json");
    expect(readKeptDraft("p1")).toBeNull();
    put({ overlay: { version: 3, ops: [], configs: {}, enabled: {} }, base: "sig" });
    expect(readKeptDraft("p1")).toBeNull();
    put({ overlay: { version: 2, ops: [], configs: {}, enabled: {} } });
    expect(readKeptDraft("p1")).toBeNull();
  });
});
