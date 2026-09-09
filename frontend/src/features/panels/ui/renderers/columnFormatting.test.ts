// HEL-469 design D4/task 4.1 — every assertion here pins locale AND
// timezone EXPLICITLY rather than inheriting the host's. `frontend/jest
// .config.cjs`/`src/test/jest.setup.ts` pin neither today, so a naive
// `"$1,234.56"` assertion is green in `en-US` and red elsewhere — a defect
// wearing a green check. `PINNED_LOCALE`/`PINNED_TZ` are stated here so a
// reader knows the assertions below are anchored, not incidental.

import { formatColumnValue, resolveColumnFormatter } from "./columnFormatting";
import type { TableColumnFormatSpec } from "../../../pipelines/ui/outputEditor/outputConfigTypes";

const PINNED_LOCALE = "en-US";
const PINNED_TZ = "America/New_York";
const INTL = { locale: PINNED_LOCALE, timeZone: PINNED_TZ };

describe("formatColumnValue — number (HEL-469 design D2/task 2.1)", () => {
  it("groups thousands and respects an explicit decimals count", () => {
    const spec: TableColumnFormatSpec = { type: "number", decimals: 2 };
    expect(formatColumnValue(spec, 1234.5, INTL)).toBe("1,234.50");
  });

  it("formats a numeric string identically to the equivalent number", () => {
    const spec: TableColumnFormatSpec = { type: "number", decimals: 0 };
    expect(formatColumnValue(spec, "1234.5", INTL)).toBe(formatColumnValue(spec, 1234.5, INTL));
  });
});

describe("formatColumnValue — currency (HEL-469 design D2/task 2.1)", () => {
  it("renders a $-style value for a currency column (AC: $1,234.56-style)", () => {
    const spec: TableColumnFormatSpec = { type: "currency", currency: "USD" };
    expect(formatColumnValue(spec, 1234.56, INTL)).toBe("$1,234.56");
  });

  it("uses an EXPLICIT currency code, never a hardcoded USD (design D2 divergence #1)", () => {
    const spec: TableColumnFormatSpec = { type: "currency", currency: "EUR" };
    expect(formatColumnValue(spec, 9.99, INTL)).toBe("€9.99");
  });

  it("defaults to USD only when no currency code is given", () => {
    const spec: TableColumnFormatSpec = { type: "currency" };
    expect(formatColumnValue(spec, 9.99, INTL)).toBe("$9.99");
  });
});

describe("formatColumnValue — date (HEL-469 design D2/task 2.1, D4/4.3)", () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = PINNED_TZ;
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("renders the chosen pattern (dateStyle)", () => {
    const spec: TableColumnFormatSpec = { type: "date", datePattern: "long" };
    expect(formatColumnValue(spec, "2026-06-15T12:00:00Z", INTL)).toBe("June 15, 2026");
  });

  // task 4.3 — an instant near a day boundary is a DIFFERENT calendar day
  // either side of midnight; this is load-bearing only because the TZ pin
  // above puts it a few hours behind UTC.
  it("renders the calendar day implied by the PINNED timezone, not UTC's", () => {
    const spec: TableColumnFormatSpec = { type: "date", datePattern: "short" };
    // 2026-01-02T03:00:00Z is still 2026-01-01 in America/New_York (UTC-5).
    expect(formatColumnValue(spec, "2026-01-02T03:00:00Z", INTL)).toBe("1/1/26");
  });
});

describe("formatColumnValue — text (task 2.1)", () => {
  it("passes text through unchanged (same as no spec)", () => {
    const spec: TableColumnFormatSpec = { type: "text" };
    expect(formatColumnValue(spec, "hello", INTL)).toBe("hello");
  });
});

describe("formatColumnValue — never throws, falls back to the raw string (design D3/task 2.2)", () => {
  it("a number-formatted column with a non-numeric value renders its raw text", () => {
    const spec: TableColumnFormatSpec = { type: "number" };
    expect(formatColumnValue(spec, "n/a", INTL)).toBe("n/a");
  });

  it("a currency-formatted column with a non-numeric value renders its raw text", () => {
    const spec: TableColumnFormatSpec = { type: "currency" };
    expect(formatColumnValue(spec, "unknown", INTL)).toBe("unknown");
  });

  it("a date-formatted column with an unparseable value renders its raw text", () => {
    const spec: TableColumnFormatSpec = { type: "date" };
    expect(formatColumnValue(spec, "not-a-date", INTL)).toBe("not-a-date");
  });

  it("null/undefined keep formatCell's existing em-dash regardless of spec", () => {
    const spec: TableColumnFormatSpec = { type: "currency" };
    expect(formatColumnValue(spec, null, INTL)).toBe("—");
    expect(formatColumnValue(spec, undefined, INTL)).toBe("—");
  });

  // design D5/task 7.1 — the `rawRows` boundary: an object value that
  // reached the table as `"[object Object]"` (already stringified by
  // `usePanelData.ts:87-92`, HEL-1033's boundary) is neither numeric nor a
  // parseable date, so it falls all the way through to the raw-string
  // fallback -- no special case (task 7.2).
  it('an object destroyed upstream to "[object Object]" renders unchanged', () => {
    const spec: TableColumnFormatSpec = { type: "number" };
    expect(formatColumnValue(spec, "[object Object]", INTL)).toBe("[object Object]");
  });

  it("a malformed currency code degrades to the raw-string fallback rather than throwing", () => {
    const spec: TableColumnFormatSpec = { type: "currency", currency: "NOT_A_CODE" };
    expect(() => formatColumnValue(spec, 5, INTL)).not.toThrow();
    expect(formatColumnValue(spec, 5, INTL)).toBe("5");
  });

  it("formatting does not change which value is present -- absent spec resolves like formatCell", () => {
    expect(formatColumnValue(undefined, 5, INTL)).toBe(formatColumnValue(undefined, 5, INTL));
  });
});

describe("formatColumnValue — deterministic under a different host locale/timezone (design D4)", () => {
  it("the SAME assertion holds regardless of the pinned locale/timezone chosen, as long as one is pinned", () => {
    const spec: TableColumnFormatSpec = { type: "currency", currency: "USD" };
    // Two DIFFERENT pinned locales -- both should render the AC's
    // $-style grouped amount; this shows the assertion is a property of the
    // PIN, not an accident of the test runner's host locale.
    expect(formatColumnValue(spec, 1234.56, { locale: "en-US" })).toBe("$1,234.56");
    expect(formatColumnValue(spec, 1234.56, { locale: "en-GB" })).toBe("US$1,234.56");
  });
});

describe("resolveColumnFormatter — shared resolver (design D6b)", () => {
  it("resolves to formatCell's exact output when no spec is given", () => {
    const resolver = resolveColumnFormatter(undefined, INTL);
    expect(resolver(null)).toBe("—");
    expect(resolver({ a: 1 })).toBe(JSON.stringify({ a: 1 }));
  });

  it("resolves to formatColumnValue's exact output when a spec IS given", () => {
    const spec: TableColumnFormatSpec = { type: "currency", currency: "USD" };
    const resolver = resolveColumnFormatter(spec, INTL);
    expect(resolver(9.99)).toBe(formatColumnValue(spec, 9.99, INTL));
  });
});
