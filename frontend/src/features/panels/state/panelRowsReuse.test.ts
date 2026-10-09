import type { PanelPaginationState } from "../types/panel";
import { invalidateOutput, retain } from "./outputFreshness";
import { currentGeneration } from "./outputFreshness";
import { isPendingFor, isReusable, normalizeQuery } from "./panelRowsReuse";
import { hasRunBaseline } from "../services/pipelineRunFanout";
import * as metaCache from "./outputMetaCache";

jest.mock("../services/pipelineRunFanout", () => ({ hasRunBaseline: jest.fn() }));
jest.mock("./outputMetaCache", () => ({ getOutputMetaCached: jest.fn() }));

const q = { outputId: "o1", crossFilterEq: null };

function entry(over: Partial<PanelPaginationState> = {}): PanelPaginationState {
  return {
    currentPage: 0,
    hasMore: false,
    isLoadingMore: false,
    rows: [],
    materialized: true,
    total: 0,
    lastQuery: q,
    lastFetchOk: true,
    generation: currentGeneration("o1"),
    ...over,
  };
}

beforeEach(() => {
  jest.mocked(hasRunBaseline).mockReturnValue(true);
  jest.mocked(metaCache.getOutputMetaCached).mockReturnValue({ pipelineId: "p1" } as never);
  retain("o1");
});

describe("normalizeQuery", () => {
  it("treats absent and undefined keys as equal, ignores key order, and treats an inactive filter as none", () => {
    const a = normalizeQuery({ outputId: "o1", crossFilterEq: null });
    expect(
      normalizeQuery({ outputId: "o1", sort: undefined, filter: undefined, crossFilterEq: null }),
    ).toBe(a);
    expect(
      normalizeQuery({
        outputId: "o1",
        filter: { quick: undefined, columns: undefined, ops: undefined },
        crossFilterEq: null,
      }),
    ).toBe(a);
    expect(normalizeQuery({ outputId: "o1", filter: { quick: " " }, crossFilterEq: null })).toBe(a);
    expect(
      normalizeQuery({
        outputId: "o1",
        filter: { quick: "x", columns: { b: "1", a: "2" } },
        crossFilterEq: null,
      }),
    ).toBe(
      normalizeQuery({
        outputId: "o1",
        filter: { columns: { a: "2", b: "1" }, quick: "x" },
        crossFilterEq: null,
      }),
    );
  });

  it("tells genuinely different queries apart", () => {
    const base = normalizeQuery(q);
    expect(normalizeQuery({ ...q, sort: { column: "a", direction: "asc" } })).not.toBe(base);
    expect(normalizeQuery({ ...q, filter: { quick: "x" } })).not.toBe(base);
    expect(normalizeQuery({ ...q, crossFilterEq: { column: "a", value: "b" } })).not.toBe(base);
    expect(normalizeQuery({ ...q, outputId: "o2" })).not.toBe(base);
  });
});

describe("isReusable", () => {
  it("accepts a settled, successful, current, retained, baselined window for the same query", () => {
    expect(isReusable(entry(), q)).toBe(true);
  });

  it.each([
    ["no entry", undefined, q],
    ["a pending request", entry({ isLoadingMore: true }), q],
    ["a failed last request", entry({ lastFetchOk: false }), q],
    ["an unknown outcome", entry({ lastFetchOk: undefined }), q],
    ["a different query", entry(), { ...q, sort: { column: "a", direction: "asc" as const } }],
  ])("rejects %s", (_name, e, query) => {
    expect(isReusable(e, query)).toBe(false);
  });

  it("rejects a window older than an invalidation", () => {
    const e = entry();
    invalidateOutput("o1");
    expect(isReusable(e, q)).toBe(false);
  });

  it("rejects without a run baseline, without held metadata, or for an Output not retained", () => {
    jest.mocked(hasRunBaseline).mockReturnValue(false);
    expect(isReusable(entry(), q)).toBe(false);
    jest.mocked(hasRunBaseline).mockReturnValue(true);
    jest.mocked(metaCache.getOutputMetaCached).mockReturnValue(undefined);
    expect(isReusable(entry(), q)).toBe(false);
    jest.mocked(metaCache.getOutputMetaCached).mockReturnValue({ pipelineId: "p1" } as never);
    const unretained = { outputId: "never-retained", crossFilterEq: null };
    expect(
      isReusable(
        entry({ lastQuery: unretained, generation: currentGeneration("never-retained") }),
        unretained,
      ),
    ).toBe(false);
  });
});

describe("isPendingFor", () => {
  it("matches only an in-flight request for the same query", () => {
    expect(isPendingFor(entry({ isLoadingMore: true }), q)).toBe(true);
    expect(isPendingFor(entry({ isLoadingMore: false }), q)).toBe(false);
    expect(isPendingFor(entry({ isLoadingMore: true }), { ...q, filter: { quick: "x" } })).toBe(
      false,
    );
    expect(isPendingFor(undefined, q)).toBe(false);
  });
});
