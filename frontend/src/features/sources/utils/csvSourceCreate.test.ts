import {
  createCsvSource,
  createCsvSourceFromUrl,
  inferFromCsv,
} from "../services/dataSourceService";
import {
  CsvUnreadableError,
  createCsvFromFields,
  createCsvFromUrl,
  forceStringFields,
  inferAndCreateCsv,
} from "./csvSourceCreate";

jest.mock("../services/dataSourceService", () => ({
  createCsvSource: jest.fn(),
  createCsvSourceFromUrl: jest.fn(),
  inferFromCsv: jest.fn(),
}));

const field = { name: "n", displayName: "N", dataType: "float", nullable: false };
const file = new File(["n\n1\n"], "n.csv");

describe("csvSourceCreate (HEL-1209, shared with AddSourceModal)", () => {
  beforeEach(() => jest.clearAllMocks());

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
});
