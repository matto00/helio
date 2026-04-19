import { httpClient, setupAuthInterceptor } from "./httpClient";

interface InterceptorEntry {
  rejected: (err: unknown) => Promise<never>;
}

interface InterceptorManager {
  handlers: InterceptorEntry[];
}

function getLastInterceptor(): InterceptorEntry {
  const mgr = httpClient.interceptors.response as unknown as InterceptorManager;
  return mgr.handlers[mgr.handlers.length - 1];
}

describe("setupAuthInterceptor", () => {
  const mockDispatch = jest.fn();
  const mockNavigate = jest.fn();

  beforeEach(() => {
    mockDispatch.mockClear();
    mockNavigate.mockClear();
    // Clear all response interceptors before each test
    const mgr = httpClient.interceptors.response as unknown as InterceptorManager;
    mgr.handlers = [];
    setupAuthInterceptor(mockDispatch, mockNavigate);
  });

  it("dispatches clearAuth and navigates to /login on a 401 response", async () => {
    const error = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { status: 401 },
      config: { url: "/api/dashboards" },
    });

    await expect(getLastInterceptor().rejected(error)).rejects.toThrow("Unauthorized");

    expect(mockDispatch).toHaveBeenCalledWith({ type: "auth/clearAuth" });
    expect(mockNavigate).toHaveBeenCalledWith("/login");
  });

  it("does NOT navigate to /login when the failing request is GET /api/auth/me", async () => {
    const error = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { status: 401 },
      config: { url: "/api/auth/me" },
    });

    await expect(getLastInterceptor().rejected(error)).rejects.toThrow("Unauthorized");

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("passes through non-401 errors without dispatching or navigating", async () => {
    const error = Object.assign(new Error("Internal Server Error"), {
      isAxiosError: true,
      response: { status: 500 },
      config: { url: "/api/dashboards" },
    });

    await expect(getLastInterceptor().rejected(error)).rejects.toThrow("Internal Server Error");

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
