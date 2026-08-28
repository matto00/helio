import { rankActions } from "./ranking";
import type { CommandAction } from "./types";

function makeAction(
  id: string,
  title: string,
  overrides: Partial<CommandAction> = {},
): CommandAction {
  return { id, title, run: jest.fn(), ...overrides };
}

describe("rankActions", () => {
  it("returns every action, unranked, for an empty query", () => {
    const actions = [makeAction("a", "Alpha"), makeAction("b", "Beta")];
    expect(rankActions(actions, "")).toEqual(actions);
  });

  it("title-prefix match ranks first", () => {
    const revenue = makeAction("a", "Revenue Pulse");
    const other = makeAction("b", "Q3 Revenue");
    const result = rankActions([other, revenue], "rev");
    expect(result.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("title match outranks a keywords-only match", () => {
    const titleMatch = makeAction("a", "Dashboards");
    const keywordMatch = makeAction("b", "Something else", { keywords: ["dashboards"] });
    const result = rankActions([keywordMatch, titleMatch], "dashboard");
    expect(result.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("title-substring outranks title-subsequence", () => {
    const substring = makeAction("a", "My Metrics Page");
    const subsequence = makeAction("b", "M e t r i c s spread across");
    const result = rankActions([subsequence, substring], "metrics");
    expect(result.map((a) => a.id)[0]).toBe("a");
  });

  it("keyword-only match is included", () => {
    const action = makeAction("a", "Settings", { keywords: ["preferences"] });
    expect(rankActions([action], "preferences").map((a) => a.id)).toEqual(["a"]);
  });

  it("subsequence query matches letters in order, non-contiguously", () => {
    const action = makeAction("a", "Data Sources");
    expect(rankActions([action], "dsrc").map((a) => a.id)).toEqual(["a"]);
  });

  it("does not match an action with no relation to the query", () => {
    const action = makeAction("a", "Pipelines");
    expect(rankActions([action], "xyz")).toEqual([]);
  });

  it("equal-strength results keep a stable order across calls", () => {
    const actions = [makeAction("a", "Report A"), makeAction("b", "Report B")];
    const first = rankActions(actions, "report").map((a) => a.id);
    const second = rankActions(actions, "report").map((a) => a.id);
    expect(first).toEqual(second);
    expect(first).toEqual(["a", "b"]);
  });

  it("an opted-out (matchesQuery) action is unscored, kept in registrant order, after scored ones", () => {
    const scored = makeAction("scored", "Dashboards");
    const optedOutFirst = makeAction("recent-1", "Zzz result", { matchesQuery: true });
    const optedOutSecond = makeAction("recent-2", "Aaa result", { matchesQuery: true });

    const result = rankActions([optedOutFirst, optedOutSecond, scored], "dash");

    expect(result.map((a) => a.id)).toEqual(["scored", "recent-1", "recent-2"]);
  });

  it("is case-insensitive", () => {
    const action = makeAction("a", "Data Sources");
    expect(rankActions([action], "DATA").map((a) => a.id)).toEqual(["a"]);
  });
});
