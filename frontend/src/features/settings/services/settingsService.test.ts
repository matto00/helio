// Regression coverage for the same wire-shape gap `pipelineService.test.ts`
// documents: spray-json's default `Option` formatter omits `None` fields
// entirely from the wire (does not serialize `null`). The backend's
// `defaultSeriesColors`/`defaultPanelStyle`/`namingConventions` (all
// `Option[...]`) and `lastUsedAt` (`Option[Instant]`) therefore arrive with
// the key **absent**, not `null`, when unset -- `settingsService.ts` must
// normalize both to `null` before the value reaches Redux/the UI.

import { httpClient } from "../../../services/httpClient";
import { getPreferences, listAgentMemory, putPreferences } from "./settingsService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

// No `defaultSeriesColors`/`defaultPanelStyle`/`namingConventions` keys at
// all -- exactly how a caller with no stored preferences arrives.
const wirePreferencesEmpty = {
  extras: {},
};

const wirePreferencesFull = {
  defaultSeriesColors: ["#ff0000", "#00ff00"],
  defaultPanelStyle: { background: "#111111" },
  namingConventions: { titleCase: true },
  extras: { favoriteChart: "bar" },
};

describe("settingsService preferences normalization", () => {
  it("getPreferences maps absent optional fields to null", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: wirePreferencesEmpty });

    const result = await getPreferences();

    expect(result.defaultSeriesColors).toBeNull();
    expect(result.defaultPanelStyle).toBeNull();
    expect(result.namingConventions).toBeNull();
    expect(result.extras).toEqual({});
    expect("defaultSeriesColors" in wirePreferencesEmpty).toBe(false);
  });

  it("getPreferences preserves present optional fields, including non-string namingConventions values", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({ data: wirePreferencesFull });

    const result = await getPreferences();

    expect(result.defaultSeriesColors).toEqual(["#ff0000", "#00ff00"]);
    expect(result.defaultPanelStyle).toEqual({ background: "#111111" });
    expect(result.namingConventions).toEqual({ titleCase: true });
    expect(result.extras).toEqual({ favoriteChart: "bar" });
  });

  it("putPreferences maps absent optional fields on the response to null", async () => {
    mockedHttpClient.put.mockResolvedValueOnce({ data: wirePreferencesEmpty });

    const result = await putPreferences({
      defaultSeriesColors: [],
      defaultPanelStyle: {},
      namingConventions: {},
      extras: {},
    });

    expect(result.defaultSeriesColors).toBeNull();
    expect(result.defaultPanelStyle).toBeNull();
    expect(result.namingConventions).toBeNull();
  });
});

describe("settingsService agent memory normalization", () => {
  it("listAgentMemory maps an absent lastUsedAt to null", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: [
        {
          id: "mem-1",
          kind: "fact",
          content: "Prefers dark mode.",
          createdAt: "2026-08-01T00:00:00Z",
        },
      ],
    });

    const result = await listAgentMemory();

    expect(result[0].lastUsedAt).toBeNull();
  });

  it("listAgentMemory preserves a present lastUsedAt", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: [
        {
          id: "mem-1",
          kind: "fact",
          content: "Prefers dark mode.",
          createdAt: "2026-08-01T00:00:00Z",
          lastUsedAt: "2026-08-10T00:00:00Z",
        },
      ],
    });

    const result = await listAgentMemory();

    expect(result[0].lastUsedAt).toBe("2026-08-10T00:00:00Z");
  });
});
