import {
  getPublishedComparison,
  publishComparison,
  resetComparisonStore,
  unpublishComparison,
} from "./metricComparisonStore";

const A = { baselineAt: "2026-09-28T09:00:00Z", baselineText: "1,075" };
const B = { baselineAt: "2026-09-28T09:00:00Z", baselineText: "1,076" };

beforeEach(resetComparisonStore);

describe("metricComparisonStore", () => {
  it("publishes and removes on unmount", () => {
    const p = Symbol("card");
    publishComparison("authenticated:p1", p, A);
    expect(getPublishedComparison("authenticated:p1")).toBe(A);
    unpublishComparison("authenticated:p1", p);
    expect(getPublishedComparison("authenticated:p1")).toBeNull();
  });

  it("the most recent live publisher wins and survives another's cleanup", () => {
    const card = Symbol("card");
    const full = Symbol("fullscreen");
    publishComparison("authenticated:p1", card, A);
    publishComparison("authenticated:p1", full, B);
    expect(getPublishedComparison("authenticated:p1")).toBe(B);
    unpublishComparison("authenticated:p1", full);
    expect(getPublishedComparison("authenticated:p1")).toBe(A);
  });

  it("a null publication (delta hidden) reads as null and keys are per variant", () => {
    const p = Symbol("card");
    publishComparison("authenticated:p1", p, null);
    expect(getPublishedComparison("authenticated:p1")).toBeNull();
    publishComparison("public:p1", p, A);
    expect(getPublishedComparison("authenticated:p1")).toBeNull();
    expect(getPublishedComparison("public:p1")).toBe(A);
  });
});
