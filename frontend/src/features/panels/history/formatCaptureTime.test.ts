import { formatCaptureTime, sameMinute } from "./formatCaptureTime";

describe("formatCaptureTime / sameMinute (HEL-1277)", () => {
  it("detects the same minute and only then differs by seconds", () => {
    expect(sameMinute("2026-10-05T14:02:05Z", "2026-10-05T14:02:55Z")).toBe(true);
    expect(sameMinute("2026-10-05T14:02:55Z", "2026-10-05T14:03:05Z")).toBe(false);
    expect(sameMinute("nope", "2026-10-05T14:03:05Z")).toBe(false);
  });

  it("renders seconds only on request", () => {
    const a = formatCaptureTime("2026-10-05T14:02:05Z", true);
    const b = formatCaptureTime("2026-10-05T14:02:55Z", true);
    expect(a).not.toBe(b);
    expect(formatCaptureTime("2026-10-05T14:02:05Z")).toBe(
      formatCaptureTime("2026-10-05T14:02:55Z"),
    );
  });
});
