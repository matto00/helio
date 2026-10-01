import { CsvUnreadableError } from "../../sources/utils/csvSourceCreate";
import { describeFirstRunError } from "./firstRunErrors";
import { isHttpUrl, looksLikeCsv, sourceNameFromFile, sourceNameFromUrl } from "./firstRunNaming";

const http = (status: number | undefined, message?: string) => ({
  isAxiosError: true,
  response: status === undefined ? undefined : { status, data: message ? { message } : {} },
});

describe("describeFirstRunError (HEL-1209)", () => {
  it.each([
    [http(413), "reading", "upload limit"],
    [http(502), "uploading", "couldn't fetch that link"],
    [http(429), "building", "Too many requests"],
    [http(undefined), "uploading", "Couldn't reach Helio"],
    [http(400, "File must be UTF-8 encoded"), "uploading", "File must be UTF-8 encoded"],
    [http(422, "Run blocked"), "building", "Run blocked"],
    [http(500), "building", "couldn't build a dashboard"],
    [http(500), "reading", "couldn't read that as a CSV"],
    [new CsvUnreadableError(), "reading", "no readable columns"],
  ] as const)("maps %j at stage %s", (err, stage, expected) => {
    expect(describeFirstRunError(err, stage)).toContain(expected);
  });
});

describe("first-run naming", () => {
  it("names a source from its file or link", () => {
    expect(sourceNameFromFile(new File([""], "Q3 sales.CSV"))).toBe("Q3 sales");
    expect(sourceNameFromFile(new File([""], ".csv"))).toBe("My data");
    expect(sourceNameFromUrl("https://example.com/data/orders.csv?x=1")).toBe("orders");
    expect(sourceNameFromUrl("https://example.com/")).toBe("example.com");
    expect(sourceNameFromUrl("not a url")).toBe("My data");
  });

  it("recognises CSV files and http(s) links only", () => {
    expect(looksLikeCsv(new File([""], "a.csv"))).toBe(true);
    expect(looksLikeCsv(new File([""], "a", { type: "text/csv" }))).toBe(true);
    expect(looksLikeCsv(new File([""], "a.pdf", { type: "application/pdf" }))).toBe(false);
    expect(isHttpUrl("https://x.test/a.csv")).toBe(true);
    expect(isHttpUrl("ftp://x.test/a.csv")).toBe(false);
    expect(isHttpUrl("nope")).toBe(false);
  });
});
