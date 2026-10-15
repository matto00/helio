import { formatRelativeTime } from "./formatRelativeTime";

describe("formatRelativeTime with an explicit now", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");

  it("uses the supplied now, not the clock", () => {
    expect(formatRelativeTime("2026-01-01T11:59:55Z", now)).toBe("5 seconds ago");
    expect(formatRelativeTime("2026-01-01T11:59:55Z", now + 60_000)).toBe("1 minute ago");
  });

  it("reads 'just now' for a future timestamp", () => {
    expect(formatRelativeTime("2026-01-01T12:00:10Z", now)).toBe("just now");
  });

  it("defaults to the current time", () => {
    expect(formatRelativeTime(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe(
      "3 hours ago",
    );
  });
});
