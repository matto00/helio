import { outputPanel } from "../../../../test/warmFixtures";
import { currentGeneration, resetOutputFreshness } from "../../../panels/state/outputFreshness";
import { clearWarmState, retainTab, retainedTabIds, sweepWarm } from "./warmCache";

const panels = [outputPanel("p1", "a", "o1")];

beforeEach(async () => {
  await clearWarmState();
  resetOutputFreshness();
});

describe("sweepWarm (HEL-1575 D4)", () => {
  it("expires a tab that is no longer warm: its Outputs are invalidated (not only released) so the remount grace cannot serve its rows", () => {
    retainTab("a", panels);
    const before = currentGeneration("o1");
    sweepWarm(() => false, "other");
    expect(retainedTabIds()).toEqual([]);
    expect(currentGeneration("o1")).toBeGreaterThan(before);
  });

  it("leaves a warm tab's retention and generation alone", () => {
    retainTab("a", panels);
    const before = currentGeneration("o1");
    sweepWarm(() => true, "other");
    expect(retainedTabIds()).toEqual(["a"]);
    expect(currentGeneration("o1")).toBe(before);
  });

  it("releases the ACTIVE tab's tab-level retention without invalidating its rows (its cards hold their own)", () => {
    retainTab("a", panels);
    const before = currentGeneration("o1");
    sweepWarm(() => false, "a");
    expect(retainedTabIds()).toEqual([]);
    expect(currentGeneration("o1")).toBe(before);
  });
});
