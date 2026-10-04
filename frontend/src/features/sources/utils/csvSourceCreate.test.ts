import {
  createCsvSource,
  createCsvSourceFromUrl,
  fetchCsvLimits,
  inferFromCsv,
} from "../services/dataSourceService";
import {
  CsvUnreadableError,
  createCsvFromFields,
  createCsvFromUrl,
  describeCsvTooLarge,
  forceStringFields,
  getCsvLimits,
  inferAndCreateCsv,
  resetCsvLimitsCache,
} from "./csvSourceCreate";

jest.mock("../services/dataSourceService", () => ({
  createCsvSource: jest.fn(),
  createCsvSourceFromUrl: jest.fn(),
  fetchCsvLimits: jest.fn(),
  inferFromCsv: jest.fn(),
}));

const field = { name: "n", displayName: "N", dataType: "float", nullable: false };
const file = new File(["n\n1\n"], "n.csv");

describe("csvSourceCreate (HEL-1209, shared with AddSourceModal)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCsvLimitsCache();
  });

  it("forces every field to string", () => {
    expect(
      forceStringFields([field, { ...field, name: "m", dataType: "integer" }]).map(
        (f) => f.dataType,
      ),
    ).toEqual(["string", "string"]);
  });

  it("createCsvFromFields uploads string-only overrides", async () => {
    await createCsvFromFields("n", file, [field]);
    expect(jest.mocked(createCsvSource)).toHaveBeenCalledWith("n", file, [
      { ...field, dataType: "string" },
    ]);
  });

  it("inferAndCreateCsv reports stages in order and creates after inferring", async () => {
    jest.mocked(inferFromCsv).mockResolvedValue([field]);
    const stages: string[] = [];
    await inferAndCreateCsv("n", file, (s) => stages.push(s));
    expect(stages).toEqual(["reading", "uploading"]);
    expect(jest.mocked(createCsvSource)).toHaveBeenCalledTimes(1);
  });

  it("inferAndCreateCsv throws CsvUnreadableError and uploads nothing when no columns are found", async () => {
    jest.mocked(inferFromCsv).mockResolvedValue([]);
    await expect(inferAndCreateCsv("n", file)).rejects.toBeInstanceOf(CsvUnreadableError);
    expect(jest.mocked(createCsvSource)).not.toHaveBeenCalled();
  });

  it("createCsvFromUrl delegates to the URL create", async () => {
    await createCsvFromUrl("n", "https://x.test/n.csv");
    expect(jest.mocked(createCsvSourceFromUrl)).toHaveBeenCalledWith("n", "https://x.test/n.csv");
  });

  it("getCsvLimits fetches once and caches the result", async () => {
    const limits = { maxBytes: 15728640, maxRows: 50000, maxCells: 300000 };
    jest.mocked(fetchCsvLimits).mockResolvedValue(limits);
    await expect(getCsvLimits()).resolves.toEqual(limits);
    await expect(getCsvLimits()).resolves.toEqual(limits);
    expect(jest.mocked(fetchCsvLimits)).toHaveBeenCalledTimes(1);
  });

  it("getCsvLimits resolves null on failure and tries again on the next call", async () => {
    const limits = { maxBytes: 1, maxRows: 1, maxCells: 1 };
    jest.mocked(fetchCsvLimits).mockRejectedValueOnce(new Error("offline"));
    await expect(getCsvLimits()).resolves.toBeNull();
    jest.mocked(fetchCsvLimits).mockResolvedValueOnce(limits);
    await expect(getCsvLimits()).resolves.toEqual(limits);
  });

  it("describeCsvTooLarge returns the server message for a 413 and null otherwise", () => {
    const axiosError = (status: number, data: unknown) => ({
      isAxiosError: true,
      response: { status, data },
    });
    expect(describeCsvTooLarge(axiosError(413, { message: "limited to 15 MiB" }))).toBe(
      "limited to 15 MiB",
    );
    expect(describeCsvTooLarge(axiosError(413, {}))).toMatch(/too large/);
    expect(describeCsvTooLarge(axiosError(500, { message: "x" }))).toBeNull();
    expect(describeCsvTooLarge(new Error("x"))).toBeNull();
  });
});
