import { store } from "../../../store/store";
import { httpClient, setupAuthInterceptor } from "../../../services/httpClient";
import { clearAuth } from "../../auth/state/authSlice";
import { KEPT_DRAFT_PREFIX, writeKeptDraft } from "./keptDraft";

const kept = { overlay: { configs: {}, enabled: {}, deleted: [] }, base: "sig" };

interface InterceptorManager {
  handlers: { rejected: (err: unknown) => Promise<never> }[];
}

describe("kept drafts end with the session", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    writeKeptDraft("p1", kept);
  });

  it("clearAuth removes every kept draft through the real store", () => {
    expect(window.sessionStorage.getItem(`${KEPT_DRAFT_PREFIX}p1`)).not.toBeNull();
    store.dispatch(clearAuth());
    expect(window.sessionStorage.getItem(`${KEPT_DRAFT_PREFIX}p1`)).toBeNull();
  });

  it("a 401 on an ordinary API call removes kept drafts through the interceptor", async () => {
    const mgr = httpClient.interceptors.response as unknown as InterceptorManager;
    mgr.handlers = [];
    setupAuthInterceptor(store.dispatch, jest.fn());
    const error = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { status: 401 },
      config: { url: "/api/pipelines" },
    });

    await expect(mgr.handlers[mgr.handlers.length - 1].rejected(error)).rejects.toThrow(
      "Unauthorized",
    );

    expect(window.sessionStorage.getItem(`${KEPT_DRAFT_PREFIX}p1`)).toBeNull();
  });
});
