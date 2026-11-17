import { KEPT_DRAFT_PREFIX, readKeptDraft, writeKeptDraft } from "./keptDraft";
import { EMPTY_OVERLAY } from "./pipelineDraft";

const key = KEPT_DRAFT_PREFIX + "p1";
const put = (value: unknown) => window.sessionStorage.setItem(key, JSON.stringify(value));

beforeEach(() => window.sessionStorage.clear());

describe("kept draft v3 (HEL-1684, HEL-1733)", () => {
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
        {
          kind: "outputCreate",
          clientId: "draft-6",
          node: { step: "draft-1" },
          outputKind: "table",
          name: "n",
          config: {},
        },
        {
          kind: "outputCreate",
          clientId: "draft-7",
          node: { root: "r1" },
          outputKind: "table",
          name: "m",
          config: {},
        },
        { kind: "outputDelete", outputId: "o1" },
      ],
      configs: { "draft-1": { count: 2 } },
      enabled: { b: false },
      outputEdits: { o2: { name: "x", config: { a: 1 } } },
    } as const;
    writeKeptDraft("p1", { overlay: overlay as never, base: "sig", outputsBase: "osig" });
    expect(readKeptDraft("p1")).toEqual({ overlay, base: "sig", outputsBase: "osig" });
  });

  it("restores a draft kept in the earlier format as delete ops", () => {
    put({
      overlay: { configs: { a: { count: 4 } }, enabled: {}, deleted: ["b", "c"] },
      base: "sig",
    });
    expect(readKeptDraft("p1")).toEqual({
      base: "sig",
      overlay: {
        version: 3,
        ops: [
          { kind: "delete", stepId: "b" },
          { kind: "delete", stepId: "c" },
        ],
        configs: { a: { count: 4 } },
        enabled: {},
        outputEdits: {},
      },
    });
  });

  it("restores a v2 draft as v3 with no Output edits and no outputsBase (compared on steps only)", () => {
    put({
      overlay: { version: 2, ops: [{ kind: "delete", stepId: "a" }], configs: {}, enabled: {} },
      base: "sig",
    });
    expect(readKeptDraft("p1")).toEqual({
      base: "sig",
      overlay: {
        version: 3,
        ops: [{ kind: "delete", stepId: "a" }],
        configs: {},
        enabled: {},
        outputEdits: {},
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
    [
      "an outputCreate missing its node",
      { kind: "outputCreate", clientId: "draft-1", outputKind: "table", name: "n", config: {} },
    ],
    [
      "an outputCreate missing its config",
      {
        kind: "outputCreate",
        clientId: "draft-1",
        node: { step: "a" },
        outputKind: "table",
        name: "n",
      },
    ],
    ["an outputDelete missing its id", { kind: "outputDelete" }],
  ])("rejects the whole kept draft for %s", (_name, op) => {
    put({
      overlay: {
        version: 3,
        ops: [{ kind: "delete", stepId: "a" }, op],
        configs: {},
        enabled: {},
        outputEdits: {},
      },
      base: "sig",
    });
    expect(readKeptDraft("p1")).toBeNull();
  });

  it("reads malformed JSON, a future version and a missing base as absent", () => {
    window.sessionStorage.setItem(key, "{not json");
    expect(readKeptDraft("p1")).toBeNull();
    put({
      overlay: { version: 4, ops: [], configs: {}, enabled: {}, outputEdits: {} },
      base: "sig",
    });
    expect(readKeptDraft("p1")).toBeNull();
    put({ overlay: { version: 3, ops: [], configs: {}, enabled: {}, outputEdits: {} } });
    expect(readKeptDraft("p1")).toBeNull();
  });

  it("rejects a malformed Output edit and an Output op inside a v2 draft", () => {
    put({
      overlay: { version: 3, ops: [], configs: {}, enabled: {}, outputEdits: { o1: { name: 1 } } },
      base: "sig",
    });
    expect(readKeptDraft("p1")).toBeNull();
    put({
      overlay: {
        version: 2,
        ops: [{ kind: "outputDelete", outputId: "o" }],
        configs: {},
        enabled: {},
      },
      base: "sig",
    });
    expect(readKeptDraft("p1")).toBeNull();
  });
});
