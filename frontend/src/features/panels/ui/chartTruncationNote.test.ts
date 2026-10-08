import { chartTruncationNote, chartTruncationNoteText } from "./chartTruncationNote";

const n = (v: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(v);

describe("chartTruncationNoteText (HEL-1358 D2)", () => {
  it("names both counts with 'rows' for an unnarrowed total", () => {
    expect(chartTruncationNoteText(200, 1234, false)).toBe(
      `Based on the first ${n(200)} of ${n(1234)} rows.`,
    );
  });
  it("says 'matching rows' when the total is server-narrowed", () => {
    expect(chartTruncationNoteText(200, 640, true)).toBe(
      `Based on the first ${n(200)} of ${n(640)} matching rows.`,
    );
  });
  it("groups digits through Intl.NumberFormat", () => {
    expect(chartTruncationNoteText(200, 1234567, false)).toContain(n(1234567));
  });
});

describe("chartTruncationNote (HEL-1358 D1)", () => {
  const base = { rowsTruncated: true, totalRowCount: 500, loadedCount: 200, narrowed: false };
  it("returns text when truncated and loaded < total", () => {
    expect(chartTruncationNote(base)).toBe(chartTruncationNoteText(200, 500, false));
  });
  it("fails closed on unknown truncation, unknown total, or complete data", () => {
    expect(chartTruncationNote({ ...base, rowsTruncated: undefined })).toBeNull();
    expect(chartTruncationNote({ ...base, rowsTruncated: false })).toBeNull();
    expect(chartTruncationNote({ ...base, totalRowCount: undefined })).toBeNull();
    expect(chartTruncationNote({ ...base, totalRowCount: NaN })).toBeNull();
    expect(chartTruncationNote({ ...base, totalRowCount: 200 })).toBeNull();
    expect(chartTruncationNote({ ...base, totalRowCount: 150 })).toBeNull();
  });
});
