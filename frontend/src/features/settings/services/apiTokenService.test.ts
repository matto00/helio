// Regression coverage for the same wire-shape gap `settingsService.test.ts`
// documents: spray-json's default `Option` formatter omits `None` fields
// entirely from the wire (does not serialize `null`). The backend's
// `lastUsedAt`/`expiresAt` (both `Option[Instant]`) therefore arrive with the
// key **absent**, not `null`, for a never-used / non-expiring token --
// `apiTokenService.ts` must normalize both to `null` before the value
// reaches Redux/the UI. Also covers request/response shape for list/create/
// revoke (tasks.md 4.1).

import { httpClient } from "../../../services/httpClient";
import { createApiToken, listApiTokens, revokeApiToken } from "./apiTokenService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

describe("apiTokenService.listApiTokens", () => {
  it("calls GET /api/tokens and maps absent lastUsedAt/expiresAt to null", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: [{ id: "tok-1", name: "helio-mcp", createdAt: "2026-08-01T00:00:00Z" }],
    });

    const result = await listApiTokens();

    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/tokens");
    expect(result[0].lastUsedAt).toBeNull();
    expect(result[0].expiresAt).toBeNull();
  });

  it("preserves present lastUsedAt/expiresAt values", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: [
        {
          id: "tok-1",
          name: "helio-mcp",
          createdAt: "2026-08-01T00:00:00Z",
          lastUsedAt: "2026-08-10T00:00:00Z",
          expiresAt: "2027-08-01T00:00:00Z",
        },
      ],
    });

    const result = await listApiTokens();

    expect(result[0].lastUsedAt).toBe("2026-08-10T00:00:00Z");
    expect(result[0].expiresAt).toBe("2027-08-01T00:00:00Z");
  });
});

describe("apiTokenService.createApiToken", () => {
  it("calls POST /api/tokens with the given name and returns the raw token", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({
      data: {
        id: "tok-1",
        name: "helio-mcp",
        token: "helio_pat_abc123",
        createdAt: "2026-08-01T00:00:00Z",
      },
    });

    const result = await createApiToken({ name: "helio-mcp" });

    expect(mockedHttpClient.post).toHaveBeenCalledWith("/api/tokens", { name: "helio-mcp" });
    expect(result.token).toBe("helio_pat_abc123");
    expect(result.expiresAt).toBeNull();
  });
});

describe("apiTokenService.revokeApiToken", () => {
  it("calls DELETE /api/tokens/:id", async () => {
    mockedHttpClient.delete.mockResolvedValueOnce({ data: undefined });

    await revokeApiToken("tok-1");

    expect(mockedHttpClient.delete).toHaveBeenCalledWith("/api/tokens/tok-1");
  });
});
