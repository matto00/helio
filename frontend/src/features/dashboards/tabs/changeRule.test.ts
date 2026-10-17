import { hasChangedSince } from "./changeRule";

const T = (n: number) => new Date(Date.UTC(2026, 9, 15, 0, n)).toISOString();
const signal = (content: number | null, data: number | null) => ({
  contentUpdatedAt: content === null ? null : T(content),
  dataUpdatedAt: data === null ? null : T(data),
});

describe("hasChangedSince (HEL-1575 D7 rule, shared with Home)", () => {
  it("is false with no signal or a never-viewed dashboard", () => {
    expect(hasChangedSince(undefined, T(1), null)).toBe(false);
    expect(hasChangedSince(signal(5, 5), null, null)).toBe(false);
  });

  it("marks content changed after the last view", () => {
    expect(hasChangedSince(signal(5, null), T(1), null)).toBe(true);
    expect(hasChangedSince(signal(1, null), T(1), null)).toBe(false);
  });

  it("never marks the user's own write", () => {
    expect(hasChangedSince(signal(5, null), T(1), T(6))).toBe(false);
    expect(hasChangedSince(signal(7, null), T(1), T(6))).toBe(true);
  });

  it("marks new data after the last view even when the user also wrote", () => {
    expect(hasChangedSince(signal(5, 8), T(1), T(9))).toBe(true);
    expect(hasChangedSince(signal(null, 0), T(1), null)).toBe(false);
  });

  it("accepts epoch milliseconds for the stamps", () => {
    expect(hasChangedSince(signal(5, null), Date.parse(T(1)), Date.parse(T(2)))).toBe(true);
    expect(hasChangedSince(signal(5, null), Date.parse(T(1)), Date.parse(T(6)))).toBe(false);
  });
});
